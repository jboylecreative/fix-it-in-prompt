'use strict';

const HELPER        = 'http://127.0.0.1:47832';
const POLL_INTERVAL = 2000;
const COUNT_VALUES  = [1, 2, 3, 4, 5, 6, 8, 10];

const GENERATE_MODELS = {
    'Nano Banana 2':   'nano-banana-gen',
    'GPT Image 2':     'gpt-image-2',
    'FLUX 2 Pro':      'flux-2-pro',
    'Grok Imagine':    'grok-image',
    'Seedream 5 Lite': 'seedream-5',
    'Qwen Image Max':  'qwen-image-max'
};

const VIDEO_MODELS = {
    'Seedance 2.0': 'seedance',
    'Kling 3.0':    'kling',
    'Veo 3.1':      'veo',
    'Grok Video':   'grok-video',
    'Hailuo 2.3':   'hailuo',
    'Happy Horse':  'happy-horse'
};

// Models with resolution dropdowns (lowest → highest; UI defaults to last/highest)
const VIDEO_MODEL_RESOLUTIONS = {
    'seedance':     ['480p', '720p', '1080p'],
    'veo':          ['720p', '1080p', '4k'],
    'grok-video':   ['480p', '720p'],
    'hailuo':       ['512p', '768p'],
    'happy-horse':  ['720p', '1080p'],
    // 'kling' intentionally absent — no resolution param
};

const V2V_MODEL_RESOLUTIONS = {
    'happy-horse-v2v': ['720p', '1080p'],
    // Kling O3 models have no resolution param
};

function modelLabel(key) {
    const all = {
        'nano-banana': 'Nano Banana 2', 'nano-banana-gen': 'Nano Banana 2',
        'gpt-image-2': 'GPT Image 2',   'flux-2-pro':      'FLUX 2 Pro',
        'grok-image':  'Grok Imagine',  'seedream-5':      'Seedream 5 Lite',
        'qwen-image-max': 'Qwen Image Max',
        'seedance': 'Seedance 2.0', 'kling': 'Kling 3.0',  'veo': 'Veo 3.1',
        'grok-video': 'Grok Video', 'hailuo': 'Hailuo 2.3',
        'kling-v2v-edit':      'Kling O3 Edit',
        'kling-v2v-reference': 'Kling O3 Reference',
        'happy-horse':         'Happy Horse',
        'happy-horse-v2v':     'Happy Horse',
    };
    return all[key] || key;
}

const state = {
    activeJobs:          {},
    jobCounter:          { running: 0, complete: 0, failed: 0 },
    lastError:           '',
    lastCompletedName:   '',
    lastGeneratedPath:   null,
    pollTimer:           null,
    settings:            {},
    selectedHistoryIdx:  -1
};
let historyData = [];

const v2v = {
    source:   null,     // { path, name, duration, inPoint, outPoint }
    images:   [],       // [{ path, name }]  max 3
    elements: [],       // [{ views: [{ path, name }] }]  max 3, 4 views each
};

const cs = new CSInterface();

// ─── CSInterface wrapper ──────────────────────────────────────────────────────

function callJsx(script) {
    return new Promise(resolve => {
        cs.evalScript(script, result => resolve(result === 'undefined' ? null : result));
    });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchHelper(path, options = {}) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6000);
    try {
        const resp = await fetch(HELPER + path, { ...options, signal: controller.signal });
        return resp;
    } finally {
        clearTimeout(tid);
    }
}

function aspectValue(label) {
    const map = { 'Auto': 'auto', '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:3': '4:3', '3:4': '3:4', '21:9': '21:9' };
    return map[label] || 'auto';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getMediaDimensions(filePath, isVideo) {
    return new Promise(resolve => {
        const url = 'file:///' + filePath.replace(/\\/g, '/');
        if (isVideo) {
            const vid = document.createElement('video');
            const done = (w, h) => resolve({ width: w, height: h });
            vid.onloadedmetadata = () => done(vid.videoWidth, vid.videoHeight);
            vid.onerror = () => done(0, 0);
            setTimeout(() => done(0, 0), 4000);
            vid.src = url;
        } else {
            const img = new Image();
            img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ width: 0, height: 0 });
            img.src = url;
        }
    });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettings() {
    return {
        outputFolder:   localStorage.getItem('prem_outputFolder')   || '',
        sequenceName:   localStorage.getItem('prem_sequenceName')   || 'AI Generations',
        stillDuration:  parseInt(localStorage.getItem('prem_stillDuration'), 10) || 5,
        namingTemplate: localStorage.getItem('prem_namingTemplate') || '{date}_{model}_{prompt}',
        jumpToNewClip:  localStorage.getItem('prem_jumpToNewClip') !== 'false'
    };
}

function applySettingsToUI() {
    document.getElementById('output-folder').value    = state.settings.outputFolder;
    document.getElementById('sequence-name').value    = state.settings.sequenceName;
    document.getElementById('still-duration').value   = String(state.settings.stillDuration);
    document.getElementById('naming-template').value  = state.settings.namingTemplate;
    document.getElementById('jump-to-new-clip').checked = state.settings.jumpToNewClip;
}

function saveOutputSettings() {
    state.settings.outputFolder   = document.getElementById('output-folder').value.trim();
    state.settings.sequenceName   = document.getElementById('sequence-name').value.trim()  || 'AI Generations';
    state.settings.stillDuration  = parseInt(document.getElementById('still-duration').value, 10) || 5;
    state.settings.namingTemplate = document.getElementById('naming-template').value.trim() || '{date}_{model}_{prompt}';
    state.settings.jumpToNewClip  = document.getElementById('jump-to-new-clip').checked;
    localStorage.setItem('prem_outputFolder',   state.settings.outputFolder);
    localStorage.setItem('prem_sequenceName',   state.settings.sequenceName);
    localStorage.setItem('prem_stillDuration',  String(state.settings.stillDuration));
    localStorage.setItem('prem_namingTemplate', state.settings.namingTemplate);
    localStorage.setItem('prem_jumpToNewClip',  String(state.settings.jumpToNewClip));
    showStatus('Settings saved.');
}

// ─── Naming convention ────────────────────────────────────────────────────────

function buildFileNameBase(modelKey, prompt) {
    const now  = new Date();
    const yy   = String(now.getFullYear()).slice(2);
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const dd   = String(now.getDate()).padStart(2, '0');
    const date = yy + mm + dd;
    const modelSlug  = modelKey.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 20);
    const promptSlug = (prompt || '')
        .replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase()
        .split(/\s+/).filter(Boolean).slice(0, 6).join('_').slice(0, 40) || 'generated';
    return (state.settings.namingTemplate || '{date}_{model}_{prompt}')
        .replace(/\{date\}/g,   date)
        .replace(/\{model\}/g,  modelSlug)
        .replace(/\{prompt\}/g, promptSlug);
}

// ─── Project context ──────────────────────────────────────────────────────────

async function getProjectContext(modelKey, prompt) {
    let info = { projectPath: '', projectName: 'Unsaved' };
    try { info = JSON.parse(await callJsx('getProjectInfo()')); } catch (e) {}

    const ctx = { projectPath: info.projectPath, projectName: info.projectName };
    if (state.settings.outputFolder) ctx.customOutputDir = state.settings.outputFolder;
    if (modelKey && prompt) {
        const base     = buildFileNameBase(modelKey, prompt);
        ctx.fileNameBase = base;
        ctx.layerName    = base;
    }
    return ctx;
}

// ─── Helper management ────────────────────────────────────────────────────────

async function checkHealth() {
    try {
        const resp = await fetchHelper('/health');
        const data = await resp.json();
        return data.status === 'ok';
    } catch (e) { return false; }
}

function launchHelperNode() {
    try {
        const path = require('path');
        const os   = require('os');
        const fs   = require('fs');
        const { spawn } = require('child_process');

        const helperDir = process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'AEImageGen', 'helper')
            : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AEImageGen', 'helper');

        const serverJs = path.join(helperDir, 'src', 'server.js');

        // On Mac, Premiere's PATH may not include /usr/local/bin — probe common locations
        let nodeBin = 'node';
        if (process.platform === 'darwin') {
            const candidates = ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node'];
            for (const c of candidates) {
                try { fs.accessSync(c, fs.constants.X_OK); nodeBin = c; break; } catch (_) {}
            }
        }

        const child = spawn(nodeBin, [serverJs], {
            cwd: helperDir,
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    } catch (e) {
        // fall back to JSX launch if Node.js APIs unavailable
        callJsx('launchHelper()');
    }
}

async function ensureHelper(fn) {
    if (await checkHealth()) { await fn(); return; }
    showStatus('Starting helper service…');
    launchHelperNode();
    for (let i = 0; i < 10; i++) {
        await sleep(1000);
        if (await checkHealth()) { await fn(); return; }
    }
    showStatus('Helper could not start. Check install.');
}

// ─── Selection display ────────────────────────────────────────────────────────

async function refreshSelection() {
    let label = '— no image selected —';
    try {
        const result = await callJsx('getSelectedClip()');
        const clip   = JSON.parse(result);
        if (!clip.error) label = `${clip.name} (${clip.source})`;
    } catch (e) {}
    document.getElementById('source-label').textContent = label;
}

// ─── Job tracking and polling ─────────────────────────────────────────────────

function registerJob(jobId, type, modelKey) {
    state.activeJobs[jobId] = { type, modelKey, progress: 0, startedAt: Date.now() };
    state.jobCounter.running++;
}

function startPoll() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopPoll() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

async function poll() {
    const jobIds = Object.keys(state.activeJobs);
    if (jobIds.length === 0) { stopPoll(); updateStatus(); return; }

    for (const jobId of jobIds) {
        const jobInfo = state.activeJobs[jobId];
        if (!jobInfo) continue;
        try {
            const resp = await fetchHelper(`/jobs/${jobId}`);
            const job  = await resp.json();
            if (job.status === 'complete') {
                delete state.activeJobs[jobId];
                state.jobCounter.running  = Math.max(0, state.jobCounter.running - 1);
                state.jobCounter.complete++;
                await handleJobComplete(jobInfo, job);
            } else if (job.status === 'failed') {
                delete state.activeJobs[jobId];
                state.jobCounter.running  = Math.max(0, state.jobCounter.running - 1);
                state.jobCounter.failed++;
                state.lastError = (job.error || 'Job failed') + ` [${modelLabel(jobInfo.modelKey)}]`;
            } else {
                jobInfo.progress = job.progress || 0;
            }
        } catch (e) {} // transient network error — retry next tick
    }
    updateStatus();
}

async function handleJobComplete(jobInfo, job) {
    const isVideo = jobInfo.type === 'video' || jobInfo.type === 'v2v';
    let clipWidth = 0, clipHeight = 0;
    try {
        const dims = await getMediaDimensions(job.outputFilePath, isVideo);
        clipWidth  = dims.width;
        clipHeight = dims.height;
    } catch (e) {}

    const params = JSON.stringify({
        filePath:      job.outputFilePath,
        sequenceName:  state.settings.sequenceName  || 'AI Generations',
        stillDuration: state.settings.stillDuration || 5,
        isVideo,
        clipWidth,
        clipHeight,
        jumpToNew: state.settings.jumpToNewClip || false
    });
    try {
        const result = await callJsx(`importAndAppend(${JSON.stringify(params)})`);
        const parsed = JSON.parse(result);
        if (!parsed.ok) {
            state.lastError = (parsed.error || 'Import failed') + ' [' + (parsed.dbg || []).join(',') + ']';
            state.jobCounter.failed++;
            state.jobCounter.complete = Math.max(0, state.jobCounter.complete - 1);
            return;
        }
    } catch (e) {}
    state.lastGeneratedPath = job.outputFilePath;
    state.lastCompletedName = job.outputFilePath.split(/[\\/]/).pop();
}

// ─── Job submission ───────────────────────────────────────────────────────────

async function submitGenerateJobs() {
    const prompt = document.getElementById('gen-prompt').value.trim();
    if (!prompt) { showStatus('Please enter a prompt.'); return; }
    await callJsx(`ensureAISequence(${JSON.stringify(state.settings.sequenceName || 'AI Generations')})`);

    const modelKey    = GENERATE_MODELS[document.getElementById('gen-model').value];
    const aspectRatio = aspectValue(document.getElementById('gen-aspect').value);
    const count       = COUNT_VALUES[document.getElementById('gen-count').selectedIndex];
    const seedVal     = document.getElementById('gen-seed').value.trim();
    const seed        = seedVal ? parseInt(seedVal, 10) : null;
    const ctx         = await getProjectContext(modelKey, prompt);

    briefDisable('generate-btn');
    let anyOk = false;

    for (let i = 0; i < count; i++) {
        try {
            const resp = await fetchHelper('/jobs/edit-image', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ provider: 'fal', model: modelKey, prompt, aspectRatio, seed, sourceFilePath: null, projectContext: ctx })
            });
            const data = await resp.json();
            if (data.jobId) { registerJob(data.jobId, 'generate', modelKey); anyOk = true; }
            else state.jobCounter.failed++;
        } catch (e) { state.jobCounter.failed++; }
    }
    updateStatus();
    if (anyOk) startPoll();
}

async function submitEditJob() {
    await callJsx(`ensureAISequence(${JSON.stringify(state.settings.sequenceName || 'AI Generations')})`);
    let clip;
    try { clip = JSON.parse(await callJsx('getSelectedClip()')); }
    catch (e) { showStatus('Could not read selection.'); return; }
    if (clip.error) { showStatus(clip.error); return; }

    const prompt = document.getElementById('edit-prompt').value.trim();
    if (!prompt) { showStatus('Please enter a prompt.'); return; }

    const modelKey    = 'nano-banana';
    const aspectRatio = aspectValue(document.getElementById('edit-aspect').value);
    const seedVal     = document.getElementById('edit-seed').value.trim();
    const seed        = seedVal ? parseInt(seedVal, 10) : null;
    const ctx         = await getProjectContext(modelKey, prompt);

    try {
        const resp = await fetchHelper('/jobs/edit-image', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ provider: 'fal', model: modelKey, prompt, aspectRatio, seed, sourceFilePath: clip.path, projectContext: ctx })
        });
        const data = await resp.json();
        if (data.jobId) { registerJob(data.jobId, 'edit', modelKey); updateStatus(); startPoll(); }
        else showStatus(data.error || 'Failed to submit job.');
    } catch (e) { showStatus('Could not submit: ' + e.message); }
}

async function submitVideoJobs(useLastGenerated) {
    await callJsx(`ensureAISequence(${JSON.stringify(state.settings.sequenceName || 'AI Generations')})`);

    const modelKey = VIDEO_MODELS[document.getElementById('vid-model').value];

    let filePath = null;
    if (useLastGenerated) {
        if (!state.lastGeneratedPath) { showStatus('No generated image yet. Run Generate or Edit first.'); return; }
        filePath = state.lastGeneratedPath;
    } else {
        let clip;
        try { clip = JSON.parse(await callJsx('getSelectedClip()')); } catch (e) {}
        if (clip && !clip.error) {
            filePath = clip.path;
        } else {
            showStatus(clip ? clip.error : 'Select an image from the timeline first.');
            return;
        }
    }

    const prompt = document.getElementById('vid-prompt').value.trim();
    if (!prompt) { showStatus('Please enter a prompt.'); return; }

    const duration    = document.getElementById('vid-duration').value.replace('s', '');
    const aspectRatio = aspectValue(document.getElementById('vid-aspect').value);
    const count       = COUNT_VALUES[document.getElementById('vid-count').selectedIndex];
    const resRow      = document.getElementById('vid-res-row');
    const resolution  = resRow.style.display !== 'none' ? document.getElementById('vid-resolution').value : null;
    const seedVal     = document.getElementById('vid-seed').value.trim();
    const seed        = seedVal ? parseInt(seedVal, 10) : null;
    const ctx         = await getProjectContext(modelKey, prompt);

    briefDisable('animate-btn');
    briefDisable('animate-last-btn');
    let anyOk = false;

    for (let i = 0; i < count; i++) {
        try {
            const resp = await fetchHelper('/jobs/image-to-video', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ provider: 'fal', model: modelKey, prompt, duration, aspectRatio,
                                          resolution, seed, sourceFilePath: filePath, projectContext: ctx })
            });
            const data = await resp.json();
            if (data.jobId) { registerJob(data.jobId, 'video', modelKey); anyOk = true; }
            else state.jobCounter.failed++;
        } catch (e) { state.jobCounter.failed++; }
    }
    updateStatus();
    if (anyOk) startPoll();
}

// ─── Settings actions ─────────────────────────────────────────────────────────

async function saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key || key.length < 5) { showStatus('Enter a valid fal.ai API key.'); return; }
    try {
        const resp = await fetchHelper('/config/api-key', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ provider: 'fal', apiKey: key })
        });
        const data = await resp.json();
        if (data.success) { document.getElementById('api-key-input').value = ''; showStatus('API key saved.'); }
        else showStatus(data.error || 'Could not save key.');
    } catch (e) { showStatus('Could not save key: ' + e.message); }
}

async function browseOutputFolder() {
    const result = await callJsx('browseFolder()');
    if (result && result !== 'null') {
        try { document.getElementById('output-folder').value = JSON.parse(result); } catch (e) {}
    }
}

// ─── History ──────────────────────────────────────────────────────────────────

async function loadHistory() {
    try {
        const ctx  = await getProjectContext();
        const resp = await fetchHelper('/history', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(ctx)
        });
        historyData = await resp.json();
        if (!Array.isArray(historyData)) historyData = [];
        renderHistoryList();
    } catch (e) { showStatus('Could not load history: ' + e.message); }
}

function renderHistoryList() {
    const container = document.getElementById('history-list');
    container.innerHTML = '';
    if (!historyData.length) {
        container.innerHTML = '<div class="dim" style="padding:8px">No history yet.</div>';
        return;
    }
    historyData.forEach((entry, idx) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const dt = entry.completedAt ? entry.completedAt.replace('T', ' ').slice(0, 16) : '';
        div.textContent = `${dt}  |  ${modelLabel(entry.model)}  |  ${entry.aspectRatio || '—'}`;
        div.addEventListener('click', () => selectHistoryItem(idx));
        container.appendChild(div);
    });
}

function selectHistoryItem(idx) {
    document.querySelectorAll('.history-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
    const entry = historyData[idx];
    document.getElementById('history-prompt').value = entry.prompt || '';
    let info = modelLabel(entry.model);
    if (entry.aspectRatio) info += '  |  ' + entry.aspectRatio;
    if (entry.duration)    info += '  |  ' + entry.duration + 's';
    info += '  |  ' + (entry.type === 'image-to-video' ? 'video' : 'image');
    document.getElementById('history-info').textContent = info;
    state.selectedHistoryIdx = idx;
}

function getSelectedHistory() {
    const idx = state.selectedHistoryIdx;
    if (idx < 0 || idx >= historyData.length) { showStatus('Select a history entry first.'); return null; }
    return historyData[idx];
}

function applyHistoryToGenerate() {
    const entry = getSelectedHistory(); if (!entry) return;
    switchTab('generate');
    document.getElementById('gen-prompt').value = document.getElementById('history-prompt').value || entry.prompt || '';
    const label = modelLabel(entry.model);
    const sel   = document.getElementById('gen-model');
    for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].text === label) { sel.selectedIndex = i; break; } }
    if (entry.aspectRatio) {
        const arLabel = entry.aspectRatio === 'auto' ? 'Auto' : entry.aspectRatio;
        const arSel   = document.getElementById('gen-aspect');
        for (let i = 0; i < arSel.options.length; i++) { if (arSel.options[i].text === arLabel) { arSel.selectedIndex = i; break; } }
    }
}

function applyHistoryToEdit() {
    const entry = getSelectedHistory(); if (!entry) return;
    switchTab('edit');
    document.getElementById('edit-prompt').value = document.getElementById('history-prompt').value || entry.prompt || '';
}

function applyHistoryToAnimate() {
    const entry = getSelectedHistory(); if (!entry) return;
    switchTab('video');
    document.getElementById('vid-prompt').value = document.getElementById('history-prompt').value || entry.prompt || '';
    const label = modelLabel(entry.model);
    const sel   = document.getElementById('vid-model');
    for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].text === label) { sel.selectedIndex = i; break; } }
}

async function revealInFinder() {
    const entry = getSelectedHistory(); if (!entry) return;
    if (!entry.outputFilePath) { showStatus('No output file recorded.'); return; }
    await callJsx(`revealFile(${JSON.stringify(entry.outputFilePath)})`);
}

// ─── V2V ──────────────────────────────────────────────────────────────────────

function v2vInsertTag(tag) {
    const ta = document.getElementById('v2v-prompt');
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    ta.setRangeText(tag, start, end, 'end');
    ta.focus();
}

function renderV2VSource() {
    const nameEl  = document.getElementById('v2v-source-name');
    const durEl   = document.getElementById('v2v-dur-line');
    const clearBtn = document.getElementById('v2v-clear-src-btn');
    if (!v2v.source) {
        nameEl.textContent  = '— none —';
        durEl.style.display = 'none';
        clearBtn.style.display = 'none';
        return;
    }
    nameEl.textContent     = v2v.source.name;
    clearBtn.style.display = '';
    const dur = v2v.source.duration;
    if (dur > 10.05) {
        durEl.textContent  = `${dur.toFixed(1)}s — trim to ≤10s in Premiere first`;
        durEl.className    = 'dur-warn';
    } else {
        durEl.textContent  = `${dur.toFixed(1)}s ✓`;
        durEl.className    = 'dur-ok';
    }
    durEl.style.display = '';
}

function renderV2VImages() {
    const container = document.getElementById('v2v-images-list');
    container.innerHTML = '';
    v2v.images.forEach((img, i) => {
        const row = document.createElement('div');
        row.className = 'v2v-asset-row';
        row.innerHTML =
            `<button class="tag-btn" data-tag="@image${i+1}">@image${i+1}</button>` +
            `<span class="asset-name">${img.name}</span>` +
            `<button class="asset-x" data-remove-image="${i}" title="Remove">×</button>`;
        container.appendChild(row);
    });
    const addBtn = document.getElementById('v2v-add-image-btn');
    if (addBtn) addBtn.disabled = v2v.images.length >= 3;
}

function renderV2VElements() {
    const container = document.getElementById('v2v-elements-list');
    container.innerHTML = '';
    v2v.elements.forEach((el, ei) => {
        const block = document.createElement('div');
        block.className = 'v2v-el-block';
        const canAddView = el.views.length < 4;
        const viewsHtml = el.views.map((v, vi) =>
            `<div class="v2v-view-row">` +
            `<span class="asset-name">${v.name}</span>` +
            `<button class="asset-x" data-remove-view="${ei}-${vi}" title="Remove">×</button>` +
            `</div>`
        ).join('');
        block.innerHTML =
            `<div class="v2v-el-hdr">` +
            `<button class="tag-btn" data-tag="@element${ei+1}">@element${ei+1}</button>` +
            `<span class="dim" style="flex:1;font-size:10px;margin-left:4px">${el.views.length} view${el.views.length !== 1 ? 's' : ''}</span>` +
            `<button class="v2v-add-view-btn" data-add-view="${ei}" ${canAddView ? '' : 'disabled'}>+ view</button>` +
            `<button class="asset-x" data-remove-el="${ei}" title="Remove element">×</button>` +
            `</div>` +
            (el.views.length ? `<div class="v2v-el-views">${viewsHtml}</div>` : '');
        container.appendChild(block);
    });
    const addBtn = document.getElementById('v2v-add-el-btn');
    if (addBtn) addBtn.disabled = v2v.elements.length >= 3;
}

async function v2vUseSelected() {
    let raw, clip;
    try {
        raw  = await callJsx('getSelectedVideoClip()');
        clip = JSON.parse(raw);
    } catch (e) {
        document.getElementById('v2v-source-name').textContent = 'Error reading selection';
        return;
    }
    if (clip.error) {
        // Show error inside the panel where it's immediately visible
        document.getElementById('v2v-source-name').textContent = clip.error;
        const durEl = document.getElementById('v2v-dur-line');
        durEl.style.display = 'none';
        document.getElementById('v2v-clear-src-btn').style.display = 'none';
        return;
    }
    v2v.source = clip;
    renderV2VSource();
}

async function v2vAddImage() {
    if (v2v.images.length >= 3) return;
    const result = await callJsx('browseImageFile()');
    if (!result || result === 'null') return;
    const filePath = JSON.parse(result);
    v2v.images.push({ path: filePath, name: filePath.split(/[\\/]/).pop() });
    renderV2VImages();
}

async function v2vAddElement() {
    if (v2v.elements.length >= 3) return;
    v2v.elements.push({ views: [] });
    renderV2VElements();
}

async function submitV2VJob() {
    if (!v2v.source) { showStatus('Select a source video first (Use Selected).'); return; }
    if (v2v.source.duration > 10.05) {
        showStatus(`Clip is ${v2v.source.duration.toFixed(1)}s — trim it to ≤10s in Premiere first.`);
        return;
    }
    const prompt = document.getElementById('v2v-prompt').value.trim();
    if (!prompt) { showStatus('Please enter a prompt.'); return; }

    await callJsx(`ensureAISequence(${JSON.stringify(state.settings.sequenceName || 'AI Generations')})`);

    const modelKey   = document.getElementById('v2v-model').value;
    const resRow     = document.getElementById('v2v-res-row');
    const resolution = resRow.style.display !== 'none' ? document.getElementById('v2v-resolution').value : null;
    const seedVal    = document.getElementById('v2v-seed').value.trim();
    const seed       = seedVal ? parseInt(seedVal, 10) : null;
    const ctx        = await getProjectContext(modelKey, prompt);

    try {
        const resp = await fetchHelper('/jobs/v2v', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider:      'fal',
                v2vModel:      modelKey,
                prompt,
                sourceFilePath: v2v.source.path,
                inPoint:       v2v.source.inPoint,
                outPoint:      v2v.source.outPoint,
                duration:      v2v.source.duration,
                images:        v2v.images.map(img => img.path),
                elements:      v2v.elements.map(el => el.views.map(v => v.path)),
                resolution,
                seed,
                projectContext: ctx,
            }),
        });
        const data = await resp.json();
        if (data.jobId) {
            registerJob(data.jobId, 'v2v', modelKey);
            updateStatus();
            startPoll();
        } else {
            showStatus(data.error || 'Failed to submit V2V job.');
        }
    } catch (e) {
        showStatus('Could not submit: ' + e.message);
    }
}

// ─── Model-dependent UI updates ──────────────────────────────────────────────

function updateVideoModelUI() {
    const modelKey    = VIDEO_MODELS[document.getElementById('vid-model').value];
    const resRow      = document.getElementById('vid-res-row');
    const resolutions = VIDEO_MODEL_RESOLUTIONS[modelKey];
    if (resolutions) {
        const sel = document.getElementById('vid-resolution');
        sel.innerHTML = resolutions.map(r => `<option>${r}</option>`).join('');
        sel.value = resolutions[resolutions.length - 1]; // default to highest
        resRow.style.display = '';
    } else {
        resRow.style.display = 'none';
    }
}

function updateV2VModelUI() {
    const modelKey   = document.getElementById('v2v-model').value;
    const isKling    = modelKey.startsWith('kling');
    const refSection = document.getElementById('v2v-ref-section');
    const resRow     = document.getElementById('v2v-res-row');
    refSection.style.display = isKling ? '' : 'none';
    const resolutions = V2V_MODEL_RESOLUTIONS[modelKey];
    if (resolutions) {
        const sel = document.getElementById('v2v-resolution');
        sel.innerHTML = resolutions.map(r => `<option>${r}</option>`).join('');
        sel.value = resolutions[resolutions.length - 1]; // default to highest
        resRow.style.display = '';
    } else {
        resRow.style.display = 'none';
    }
}

// ─── Status and UI utilities ──────────────────────────────────────────────────

function updateStatus() {
    const { running, complete, failed } = state.jobCounter;
    const jobList = document.getElementById('job-list');
    jobList.innerHTML = '';
    const jobs = Object.values(state.activeJobs);
    jobs.forEach(info => {
        const div = document.createElement('div');
        div.className = 'job-item';
        const elapsed = info.startedAt
            ? Math.floor((Date.now() - info.startedAt) / 1000) + 's'
            : '';
        div.textContent = `${modelLabel(info.modelKey)} — ${info.progress || 0}%  ${elapsed}`;
        jobList.appendChild(div);
    });
    jobList.style.display = jobs.length > 0 ? 'block' : 'none';

    const lines = [`Running: ${running}   Complete: ${complete}   Failed: ${failed}`];
    if (state.lastCompletedName) lines.push(`Last: ${state.lastCompletedName}`);
    if (failed > 0 && state.lastError) lines.push(`Error: ${state.lastError}`);
    document.getElementById('status-text').textContent = lines.join('\n');
}

function showStatus(msg) {
    document.getElementById('status-text').textContent = msg;
}

function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabId}`));
}

function briefDisable(btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 1000);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function startupCheck() {
    showStatus('Checking helper service…');
    if (await checkHealth()) {
        showStatus('Ready — Running: 0   Complete: 0   Failed: 0');
        return;
    }
    showStatus('Starting helper service…');
    launchHelperNode();
    for (let i = 0; i < 10; i++) {
        await sleep(1000);
        if (await checkHealth()) {
            showStatus('Ready — Running: 0   Complete: 0   Failed: 0');
            return;
        }
    }
    showStatus('Helper could not start. Run: node src/server.js in the helper folder.');
}

function setupEventListeners() {
    document.querySelectorAll('.tab').forEach(btn =>
        btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    document.getElementById('refresh-btn').addEventListener('click', refreshSelection);

    document.getElementById('generate-btn').addEventListener('click',
        () => ensureHelper(submitGenerateJobs));
    document.getElementById('edit-btn').addEventListener('click',
        () => ensureHelper(submitEditJob));
    document.getElementById('animate-btn').addEventListener('click',
        () => ensureHelper(() => submitVideoJobs(false)));
    document.getElementById('animate-last-btn').addEventListener('click', () => {
        if (!state.lastGeneratedPath) { showStatus('No generated image yet. Run Generate or Edit first.'); return; }
        ensureHelper(() => submitVideoJobs(true));
    });

    document.getElementById('history-refresh-btn').addEventListener('click', loadHistory);
    document.getElementById('hist-to-gen-btn').addEventListener('click',  applyHistoryToGenerate);
    document.getElementById('hist-to-edit-btn').addEventListener('click', applyHistoryToEdit);
    document.getElementById('hist-to-vid-btn').addEventListener('click',  applyHistoryToAnimate);
    document.getElementById('hist-reveal-btn').addEventListener('click',  revealInFinder);

    document.getElementById('save-key-btn').addEventListener('click',      () => ensureHelper(saveApiKey));
    document.getElementById('browse-btn').addEventListener('click',        browseOutputFolder);
    document.getElementById('save-settings-btn').addEventListener('click', saveOutputSettings);

    // Video — model change updates resolution row + note
    document.getElementById('vid-model').addEventListener('change', updateVideoModelUI);

    // V2V — model change updates ref section + resolution row
    document.getElementById('v2v-model').addEventListener('change', updateV2VModelUI);

    // V2V — source video
    document.getElementById('v2v-use-sel-btn').addEventListener('click', v2vUseSelected);
    document.getElementById('v2v-clear-src-btn').addEventListener('click', () => {
        v2v.source = null; renderV2VSource();
    });

    // V2V — add image / element
    document.getElementById('v2v-add-image-btn').addEventListener('click', () => ensureHelper(v2vAddImage));
    document.getElementById('v2v-add-el-btn').addEventListener('click',    v2vAddElement);

    // V2V — event delegation for images list
    document.getElementById('v2v-images-list').addEventListener('click', e => {
        const removeBtn = e.target.closest('[data-remove-image]');
        const tagBtn    = e.target.closest('[data-tag]');
        if (removeBtn) {
            v2v.images.splice(parseInt(removeBtn.dataset.removeImage), 1);
            renderV2VImages();
        } else if (tagBtn) {
            v2vInsertTag(tagBtn.dataset.tag);
        }
    });

    // V2V — event delegation for elements list
    document.getElementById('v2v-elements-list').addEventListener('click', async e => {
        const removeEl   = e.target.closest('[data-remove-el]');
        const addView    = e.target.closest('[data-add-view]');
        const removeView = e.target.closest('[data-remove-view]');
        const tagBtn     = e.target.closest('[data-tag]');

        if (removeEl) {
            v2v.elements.splice(parseInt(removeEl.dataset.removeEl), 1);
            renderV2VElements();
        } else if (addView) {
            const ei = parseInt(addView.dataset.addView);
            if (v2v.elements[ei] && v2v.elements[ei].views.length < 4) {
                const result = await callJsx('browseImageFile()');
                if (result && result !== 'null') {
                    const fp = JSON.parse(result);
                    v2v.elements[ei].views.push({ path: fp, name: fp.split(/[\\/]/).pop() });
                    renderV2VElements();
                }
            }
        } else if (removeView) {
            const [ei, vi] = removeView.dataset.removeView.split('-').map(Number);
            v2v.elements[ei].views.splice(vi, 1);
            renderV2VElements();
        } else if (tagBtn) {
            v2vInsertTag(tagBtn.dataset.tag);
        }
    });

    // V2V — submit
    document.getElementById('v2v-generate-btn').addEventListener('click',
        () => ensureHelper(submitV2VJob));
}

document.addEventListener('DOMContentLoaded', async () => {
    state.settings = loadSettings();
    applySettingsToUI();
    setupEventListeners();
    updateVideoModelUI();
    updateV2VModelUI();
    await startupCheck();
    await refreshSelection();
});
