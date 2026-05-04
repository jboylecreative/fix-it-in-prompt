// PremImageGen.jsx — Premiere Pro Dockable Panel for AI Image Generation & Animation
// Run via File → Scripts → Run Script File, or install in the ScriptUI Panels folder.
// Requires the AEImageGen helper service running on port 47832.

(function (thisObj) {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────
    var HELPER_HOST              = '127.0.0.1';
    var HELPER_PORT              = 47832;
    var POLL_INTERVAL_MS         = 2000;
    var HEALTH_RETRIES           = 10;
    var HEALTH_RETRY_MS          = 1000;
    var SUPPORTED_IMAGE_EXTS     = ['png', 'jpg', 'jpeg', 'webp'];
    var DEFAULT_NAMING_TEMPLATE  = '{date}_{model}_{prompt}';
    var DEFAULT_SEQUENCE_NAME    = 'AI Generations';
    var DEFAULT_STILL_DURATION   = 5;

    // ─── Model maps ───────────────────────────────────────────────────────────
    function modelLabelFromKey(key) {
        var all = {
            'nano-banana':     'Nano Banana 2',
            'nano-banana-gen': 'Nano Banana 2',
            'gpt-image-2':     'GPT Image 2',
            'flux-2-pro':      'FLUX 2 Pro',
            'grok-image':      'Grok Imagine',
            'seedream-5':      'Seedream 5 Lite',
            'qwen-image-max':  'Qwen Image Max',
            'seedance':        'Seedance 2.0',
            'kling':           'Kling 3.0',
            'veo':             'Veo 3.1',
            'grok-video':      'Grok Video',
            'hailuo':          'Hailuo 2.3'
        };
        return all[key] || key;
    }

    var GENERATE_MODEL_MAP = {
        'Nano Banana 2':   'nano-banana-gen',
        'GPT Image 2':     'gpt-image-2',
        'FLUX 2 Pro':      'flux-2-pro',
        'Grok Imagine':    'grok-image',
        'Seedream 5 Lite': 'seedream-5',
        'Qwen Image Max':  'qwen-image-max'
    };
    var VIDEO_MODEL_MAP = {
        'Seedance 2.0': 'seedance',
        'Kling 3.0':    'kling',
        'Veo 3.1':      'veo',
        'Grok Video':   'grok-video',
        'Hailuo 2.3':   'hailuo'
    };
    var COUNT_VALUES = [1, 2, 3, 4, 5, 6, 8, 10];

    // ─── Global state ─────────────────────────────────────────────────────────
    $.global.PremImageGen = {
        activeJobs:        {},
        historyData:       [],
        lastError:         '',
        jobCounter:        { running: 0, complete: 0, failed: 0 },
        pollScheduled:     false,
        lastCompletedName: '',
        lastGeneratedPath: null,
        helperRunning:     false,
        settings:          {},
        ui:                {}
    };
    var G = $.global.PremImageGen;

    // ─── JSON shim ────────────────────────────────────────────────────────────
    if (typeof JSON === 'undefined') {
        JSON = {
            stringify: function (v) {
                if (v === null)             return 'null';
                if (typeof v === 'boolean') return v ? 'true' : 'false';
                if (typeof v === 'number')  return isFinite(v) ? String(v) : 'null';
                if (typeof v === 'string')  return '"' + v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t') + '"';
                if (v instanceof Array) {
                    var a = [];
                    for (var i = 0; i < v.length; i++) a.push(JSON.stringify(v[i]));
                    return '[' + a.join(',') + ']';
                }
                if (typeof v === 'object') {
                    var p = [];
                    for (var k in v) { if (v.hasOwnProperty(k)) p.push(JSON.stringify(k) + ':' + JSON.stringify(v[k])); }
                    return '{' + p.join(',') + '}';
                }
                return 'null';
            },
            parse: function (s) { return eval('(' + s + ')'); }
        };
    }

    // ─── HTTP via ExtendScript Socket ─────────────────────────────────────────
    function httpRequest(method, urlPath, bodyObj) {
        var socket = new Socket();
        socket.timeout = 15;
        socket.encoding = 'binary';
        var bodyStr = (bodyObj !== undefined && bodyObj !== null) ? JSON.stringify(bodyObj) : '';
        var req = method + ' ' + urlPath + ' HTTP/1.0\r\n' +
                  'Host: ' + HELPER_HOST + '\r\n' +
                  'Content-Type: application/json\r\n' +
                  'Content-Length: ' + bodyStr.length + '\r\n' +
                  'Connection: close\r\n\r\n' +
                  bodyStr;
        try {
            if (!socket.open(HELPER_HOST + ':' + HELPER_PORT, 'binary')) {
                return { ok: false, error: 'Cannot connect to helper service' };
            }
            socket.write(req);
            var response = '';
            var chunk;
            var limit = 1000;
            while (socket.connected && limit-- > 0) {
                chunk = socket.read(65535);
                if (chunk) response += chunk;
                else $.sleep(5);
            }
            socket.close();
            if (!response) return { ok: false, error: 'Empty response from helper' };
            var sep = response.indexOf('\r\n\r\n');
            if (sep === -1) sep = response.indexOf('\n\n');
            if (sep === -1) return { ok: false, error: 'Malformed HTTP response' };
            var statusLine = response.split('\n')[0];
            var code = parseInt(statusLine.split(' ')[1], 10);
            var body = response.substring(sep + (response.charAt(sep + 2) === '\n' ? 2 : 4));
            if (!body) return { ok: code >= 200 && code < 300, data: null, code: code };
            try {
                var data = JSON.parse(body);
                return { ok: code >= 200 && code < 300, data: data, code: code };
            } catch (e) {
                return { ok: false, error: 'Invalid JSON: ' + body.substring(0, 120) };
            }
        } catch (e) {
            try { socket.close(); } catch (_) {}
            return { ok: false, error: 'Socket error: ' + e.message };
        }
    }
    function httpGet(urlPath)       { return httpRequest('GET',  urlPath, null); }
    function httpPost(urlPath, obj) { return httpRequest('POST', urlPath, obj);  }

    // ─── Helper management (shared with AE plugin) ────────────────────────────
    function getHelperDir() {
        var homeDir = Folder('~').absoluteURI;
        if ($.os.toLowerCase().indexOf('mac') !== -1) {
            return homeDir + '/Library/Application Support/AEImageGen/helper';
        }
        var appData = System.getenv('APPDATA') || (homeDir + '/AppData/Roaming');
        return appData + '/AEImageGen/helper';
    }

    function checkHealth() {
        var resp = httpGet('/health');
        return resp.ok && resp.data && resp.data.status === 'ok';
    }

    function launchHelper() {
        var helperDir = getHelperDir();
        var launchCmd;
        if ($.os.toLowerCase().indexOf('mac') !== -1) {
            var homeDir = Folder('~').absoluteURI;
            var logDir = homeDir + '/Library/Logs/AEImageGen';
            var nodePath = system.callSystem('which node 2>/dev/null || echo /usr/local/bin/node').replace(/[\r\n]/g, '');
            if (!nodePath || nodePath === '') nodePath = '/usr/local/bin/node';
            launchCmd = '/bin/sh -c \'mkdir -p "' + logDir + '" && cd "' + helperDir + '" && nohup "' + nodePath + '" src/server.js >> "' + logDir + '/helper.log" 2>&1 &\'';
        } else {
            var vbsPath = helperDir.replace(/\//g, '\\') + '\\launch-hidden.vbs';
            launchCmd = 'wscript.exe "' + vbsPath + '"';
        }
        try { system.callSystem(launchCmd); } catch (e) { return false; }
        return true;
    }

    function ensureHelper(onReady, onFail) {
        if (checkHealth()) { G.helperRunning = true; onReady(); return; }
        launchHelper();
        var tries = 0;
        function retry() {
            tries++;
            if (checkHealth()) { G.helperRunning = true; onReady(); return; }
            if (tries >= HEALTH_RETRIES) { onFail(); return; }
            app.scheduleTask('$.global.PremImageGen._helperRetry()', HEALTH_RETRY_MS, false);
        }
        G._helperRetry = retry;
        app.scheduleTask('$.global.PremImageGen._helperRetry()', HEALTH_RETRY_MS, false);
    }

    // ─── Panel settings persistence ───────────────────────────────────────────
    function getSettingsPath() {
        var homeDir = Folder('~').absoluteURI;
        if ($.os.toLowerCase().indexOf('mac') !== -1) {
            return homeDir + '/Library/Application Support/PremImageGen/settings.json';
        }
        var appData = System.getenv('APPDATA') || (homeDir + '/AppData/Roaming');
        return appData + '/PremImageGen/settings.json';
    }

    function loadPanelSettings() {
        try {
            var f = new File(getSettingsPath());
            if (!f.exists) return {};
            f.open('r');
            var content = f.read();
            f.close();
            return JSON.parse(content) || {};
        } catch (e) { return {}; }
    }

    function savePanelSettings(settings) {
        try {
            var f = new File(getSettingsPath());
            var dir = f.parent;
            if (!dir.exists) dir.create();
            f.open('w');
            f.write(JSON.stringify(settings));
            f.close();
            return true;
        } catch (e) { return false; }
    }

    // ─── Naming convention ────────────────────────────────────────────────────
    function formatDate() {
        var d  = new Date();
        var yy = String(d.getFullYear()).slice(2);
        var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
        var dd = String(d.getDate());      if (dd.length < 2) dd = '0' + dd;
        return yy + mm + dd;
    }

    function buildFileNameBase(modelKey, prompt) {
        var template   = G.settings.namingTemplate || DEFAULT_NAMING_TEMPLATE;
        var date       = formatDate();
        var modelSlug  = modelKey.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').substring(0, 20);
        var promptSlug = (prompt || '')
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .toLowerCase()
            .split(/\s+/)
            .slice(0, 6)
            .join('_')
            .substring(0, 40) || 'generated';
        return template
            .replace(/\{date\}/g,   date)
            .replace(/\{model\}/g,  modelSlug)
            .replace(/\{prompt\}/g, promptSlug);
    }

    // ─── Premiere project utilities ───────────────────────────────────────────
    function isImageFile(filePath) {
        if (!filePath) return false;
        var ext = filePath.split('.').pop().toLowerCase();
        for (var i = 0; i < SUPPORTED_IMAGE_EXTS.length; i++) {
            if (SUPPORTED_IMAGE_EXTS[i] === ext) return true;
        }
        return false;
    }

    function getSelectedProjectItems() {
        var found = [];
        function traverse(item) {
            try {
                if (item.type !== ProjectItemType.BIN && item.isSelected && item.isSelected()) {
                    found.push(item);
                }
            } catch (e) {}
            try {
                if (item.children) {
                    for (var i = 0; i < item.children.numItems; i++) traverse(item.children[i]);
                }
            } catch (e) {}
        }
        try { traverse(app.project.rootItem); } catch (e) {}
        return found;
    }

    // Returns { path, name, source } or { error }
    // Priority: timeline selection, then project panel selection
    function getSelectedClip() {
        // 1. Timeline selection
        try {
            var seq = app.project.activeSequence;
            if (seq) {
                var sel = seq.getSelection();
                if (sel && sel.length > 0) {
                    if (sel.length > 1) return { error: 'Multiple clips selected. Select exactly one image.' };
                    var mediaPath = sel[0].projectItem.getMediaPath();
                    if (!isImageFile(mediaPath)) {
                        return { error: 'Selected clip is not a still image. Select a PNG, JPG, or WebP.' };
                    }
                    return { path: mediaPath, name: sel[0].projectItem.name, source: 'timeline' };
                }
            }
        } catch (e) {}

        // 2. Project panel selection
        try {
            var projSel = getSelectedProjectItems();
            if (projSel.length > 1) return { error: 'Multiple items selected. Select exactly one image.' };
            if (projSel.length === 1) {
                var mediaPath = projSel[0].getMediaPath();
                if (!isImageFile(mediaPath)) {
                    return { error: 'Selected item is not a still image. Select a PNG, JPG, or WebP.' };
                }
                return { path: mediaPath, name: projSel[0].name, source: 'project panel' };
            }
        } catch (e) {}

        return { error: 'No image selected. Select a still image in the timeline or project panel.' };
    }

    function findProjectItemByPath(item, mediaPath) {
        try {
            if (item.type !== ProjectItemType.BIN && item.getMediaPath() === mediaPath) return item;
        } catch (e) {}
        try {
            if (item.children) {
                for (var i = 0; i < item.children.numItems; i++) {
                    var found = findProjectItemByPath(item.children[i], mediaPath);
                    if (found) return found;
                }
            }
        } catch (e) {}
        return null;
    }

    function getOrCreateAIBin() {
        var binName = 'AI Generated';
        try {
            var root = app.project.rootItem;
            for (var i = 0; i < root.children.numItems; i++) {
                var child = root.children[i];
                if (child.type === ProjectItemType.BIN && child.name === binName) return child;
            }
            return root.createBin(binName);
        } catch (e) {
            return app.project.rootItem;
        }
    }

    function importFileToProject(filePath) {
        var bin = getOrCreateAIBin();
        app.project.importFiles([filePath], true, bin, false);
        return findProjectItemByPath(app.project.rootItem, filePath);
    }

    function getOrCreateAISequence(firstProjectItem) {
        var seqName = G.settings.sequenceName || DEFAULT_SEQUENCE_NAME;
        try {
            for (var i = 0; i < app.project.sequences.numSequences; i++) {
                if (app.project.sequences[i].name === seqName) return app.project.sequences[i];
            }
        } catch (e) {}
        // Create a new sequence matching the clip's media settings
        try {
            var newSeq = app.project.createNewSequenceFromMedia(firstProjectItem, seqName);
            if (newSeq) return newSeq;
        } catch (e) {}
        // Fallback: use the currently active sequence
        return app.project.activeSequence;
    }

    function appendClipToSequence(seq, projectItem, isVideo) {
        var track = seq.videoTracks[0];

        // Find out-point of last clip on the track
        var endSeconds = 0;
        try {
            for (var i = 0; i < track.clips.numItems; i++) {
                var t = track.clips[i].end.seconds;
                if (t > endSeconds) endSeconds = t;
            }
        } catch (e) {}

        seq.insertClip(projectItem, endSeconds, 0, -1);

        // For stills, set duration to the configured value
        if (!isVideo) {
            var stillDuration = parseInt(G.settings.stillDuration, 10) || DEFAULT_STILL_DURATION;
            try {
                for (var j = 0; j < track.clips.numItems; j++) {
                    var c = track.clips[j];
                    if (Math.abs(c.start.seconds - endSeconds) < 0.1) {
                        var endTime    = new Time();
                        endTime.seconds = endSeconds + stillDuration;
                        c.end = endTime;
                        break;
                    }
                }
            } catch (e) {} // Non-fatal if clip duration adjustment fails
        }
    }

    function getProjectContext(modelKey, prompt) {
        var ctx = { projectPath: '', projectName: '', layerName: '', fileNameBase: '' };
        try {
            if (app.project.path) {
                ctx.projectPath = app.project.path;
                ctx.projectName = app.project.name.replace(/\.prproj$/i, '');
            } else {
                ctx.projectName = 'Unsaved';
            }
        } catch (e) {}

        if (G.settings.outputFolder) ctx.customOutputDir = G.settings.outputFolder;

        if (modelKey && prompt) {
            var base = buildFileNameBase(modelKey, prompt);
            ctx.fileNameBase = base;
            ctx.layerName    = base;
        }
        return ctx;
    }

    // ─── Concurrent job tracking ──────────────────────────────────────────────
    function activeJobCount() {
        var n = 0;
        for (var id in G.activeJobs) { if (G.activeJobs.hasOwnProperty(id)) n++; }
        return n;
    }

    function registerJob(jobId, type, modelKey) {
        G.activeJobs[jobId] = { type: type, modelKey: modelKey, progress: 0 };
        G.jobCounter.running++;
    }

    function schedulePollIfNeeded() {
        if (!G.pollScheduled && activeJobCount() > 0) {
            G.pollScheduled = true;
            app.scheduleTask('$.global.PremImageGen._poll()', POLL_INTERVAL_MS, false);
        }
    }

    // ─── Polling ──────────────────────────────────────────────────────────────
    G._poll = function () {
        G.pollScheduled = false;
        var jobIds = [];
        for (var id in G.activeJobs) { if (G.activeJobs.hasOwnProperty(id)) jobIds.push(id); }
        if (jobIds.length === 0) { updateStatusDisplay(); return; }

        for (var i = 0; i < jobIds.length; i++) {
            var jobId   = jobIds[i];
            var jobInfo = G.activeJobs[jobId];
            if (!jobInfo) continue;

            var resp = httpGet('/jobs/' + jobId);
            if (!resp.ok || !resp.data) continue;

            var job = resp.data;
            if (job.status === 'complete') {
                delete G.activeJobs[jobId];
                G.jobCounter.running  = Math.max(0, G.jobCounter.running - 1);
                G.jobCounter.complete++;
                handleJobComplete(jobInfo, job);
            } else if (job.status === 'failed') {
                delete G.activeJobs[jobId];
                G.jobCounter.running  = Math.max(0, G.jobCounter.running - 1);
                G.jobCounter.failed++;
                G.lastError = (job.error || 'Job failed') + ' [' + modelLabelFromKey(jobInfo.modelKey) + ']';
            } else {
                jobInfo.progress = job.progress || 0;
            }
        }

        updateStatusDisplay();
        if (activeJobCount() > 0) {
            G.pollScheduled = true;
            app.scheduleTask('$.global.PremImageGen._poll()', POLL_INTERVAL_MS, false);
        }
    };

    function handleJobComplete(jobInfo, job) {
        try {
            var projectItem = importFileToProject(job.outputFilePath);
            if (!projectItem) throw new Error('Imported file not found in project bin.');

            var seq = getOrCreateAISequence(projectItem);
            if (!seq) throw new Error('Could not find or create AI sequence.');

            var isVideo = (jobInfo.type === 'video');
            appendClipToSequence(seq, projectItem, isVideo);

            G.lastGeneratedPath = job.outputFilePath;
            var parts = job.outputFilePath.split('/');
            G.lastCompletedName = parts[parts.length - 1];
        } catch (e) {
            G.jobCounter.failed++;
            G.jobCounter.complete = Math.max(0, G.jobCounter.complete - 1);
            G.lastError = e.message;
        }
    }

    // ─── Status display ───────────────────────────────────────────────────────
    function updateStatusDisplay() {
        try {
            var lb = G.ui.progressList;
            lb.removeAll();
            for (var pid in G.activeJobs) {
                if (G.activeJobs.hasOwnProperty(pid)) {
                    var info = G.activeJobs[pid];
                    lb.add('item', modelLabelFromKey(info.modelKey) + ' — ' + (info.progress || 0) + '%');
                }
            }
            var hasJobs = lb.items.length > 0;
            if (lb.visible !== hasJobs) lb.visible = hasJobs;

            var r = G.jobCounter.running, c = G.jobCounter.complete, f = G.jobCounter.failed;
            var lines = ['Running: ' + r + '   Complete: ' + c + '   Failed: ' + f];
            if (G.lastCompletedName) lines.push('Last: ' + G.lastCompletedName);
            if (f > 0 && G.lastError)  lines.push('Error: ' + G.lastError);
            G.ui.statusText.text = lines.join('\n');
            G.ui.panel.layout.layout(true);
        } catch (e) {}
    }

    function showStatus(msg) {
        try { G.ui.statusText.text = msg; G.ui.panel.layout.layout(true); } catch (e) {}
    }

    G._reenableFreeFireBtns = function () {
        try {
            G.ui.generateBtn.enabled   = true;
            G.ui.animateBtn.enabled    = true;
            G.ui.animateLastBtn.enabled = true;
            G.ui.panel.layout.layout(true);
        } catch (e) {}
    };

    function briefDisableFreeFireBtns() {
        try {
            G.ui.generateBtn.enabled   = false;
            G.ui.animateBtn.enabled    = false;
            G.ui.animateLastBtn.enabled = false;
        } catch (e) {}
        app.scheduleTask('$.global.PremImageGen._reenableFreeFireBtns()', 1000, false);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function modelKeyFromLabel(label, map) {
        return map[label] || label.toLowerCase().replace(/\s+/g, '-');
    }

    function aspectRatioValue(label) {
        var map = { 'Auto':'auto', '16:9':'16:9', '9:16':'9:16', '1:1':'1:1', '4:3':'4:3', '3:4':'3:4', '21:9':'21:9' };
        return map[label] || 'auto';
    }

    function getCountFromDropdown(dd) {
        if (!dd || !dd.selection) return 1;
        return COUNT_VALUES[dd.selection.index] || 1;
    }

    // ─── Job submission ───────────────────────────────────────────────────────
    function submitEditJob() {
        var clip = getSelectedClip();
        if (clip.error) { showStatus(clip.error); return; }

        var prompt = G.ui.editPrompt.text;
        if (!prompt || prompt === PLACEHOLDER_EDIT) { showStatus('Please enter a prompt.'); return; }

        var modelKey  = 'nano-banana';
        var aspectRaw = G.ui.editAspect.selection ? G.ui.editAspect.selection.text : 'Auto';
        var ctx = getProjectContext(modelKey, prompt);

        var resp = httpPost('/jobs/edit-image', {
            provider:       'fal',
            model:          modelKey,
            prompt:         prompt,
            aspectRatio:    aspectRatioValue(aspectRaw),
            sourceFilePath: clip.path,
            projectContext: ctx
        });

        if (!resp.ok || !resp.data || !resp.data.jobId) {
            showStatus((resp.data && resp.data.error) || resp.error || 'Failed to submit job.');
            return;
        }
        registerJob(resp.data.jobId, 'edit', modelKey);
        updateStatusDisplay();
        schedulePollIfNeeded();
    }

    function submitGenerateJobs() {
        var prompt = G.ui.genPrompt.text;
        if (!prompt || prompt === PLACEHOLDER_GEN) { showStatus('Please enter a prompt.'); return; }

        var modelLabel = G.ui.genModel.selection ? G.ui.genModel.selection.text : 'Nano Banana 2';
        var modelKey   = modelKeyFromLabel(modelLabel, GENERATE_MODEL_MAP);
        var aspectRaw  = G.ui.genAspect.selection ? G.ui.genAspect.selection.text : '16:9';
        var count      = getCountFromDropdown(G.ui.genCount);
        var ctx        = getProjectContext(modelKey, prompt);

        briefDisableFreeFireBtns();

        var anyOk = false;
        for (var i = 0; i < count; i++) {
            var resp = httpPost('/jobs/edit-image', {
                provider:       'fal',
                model:          modelKey,
                prompt:         prompt,
                aspectRatio:    aspectRatioValue(aspectRaw),
                sourceFilePath: null,
                projectContext: ctx
            });
            if (!resp.ok || !resp.data || !resp.data.jobId) {
                G.jobCounter.failed++;
            } else {
                registerJob(resp.data.jobId, 'generate', modelKey);
                anyOk = true;
            }
        }
        updateStatusDisplay();
        if (anyOk) schedulePollIfNeeded();
    }

    function submitVideoJobs(useLastGenerated) {
        var filePath;
        if (useLastGenerated && G.lastGeneratedPath) {
            filePath = G.lastGeneratedPath;
        } else {
            var clip = getSelectedClip();
            if (clip.error) { showStatus(clip.error); return; }
            filePath = clip.path;
        }

        var prompt = G.ui.vidPrompt.text;
        if (!prompt || prompt === PLACEHOLDER_VID) { showStatus('Please enter a prompt.'); return; }

        var modelLabel  = G.ui.vidModel.selection ? G.ui.vidModel.selection.text : 'Seedance 2.0';
        var modelKey    = modelKeyFromLabel(modelLabel, VIDEO_MODEL_MAP);
        var durationRaw = G.ui.vidDuration.selection ? G.ui.vidDuration.selection.text : '5s';
        var aspectRaw   = G.ui.vidAspect.selection ? G.ui.vidAspect.selection.text : '16:9';
        var count       = getCountFromDropdown(G.ui.vidCount);
        var ctx         = getProjectContext(modelKey, prompt);

        briefDisableFreeFireBtns();

        var anyOk = false;
        for (var i = 0; i < count; i++) {
            var resp = httpPost('/jobs/image-to-video', {
                provider:       'fal',
                model:          modelKey,
                prompt:         prompt,
                duration:       durationRaw.replace('s', ''),
                aspectRatio:    aspectRatioValue(aspectRaw),
                sourceFilePath: filePath,
                projectContext: ctx
            });
            if (!resp.ok || !resp.data || !resp.data.jobId) {
                G.jobCounter.failed++;
            } else {
                registerJob(resp.data.jobId, 'video', modelKey);
                anyOk = true;
            }
        }
        updateStatusDisplay();
        if (anyOk) schedulePollIfNeeded();
    }

    // ─── Settings ─────────────────────────────────────────────────────────────
    function saveApiKey() {
        var key = G.ui.apiKeyInput.text;
        if (!key || key.length < 5) { showStatus('Enter a valid fal.ai API key.'); return; }
        var resp = httpPost('/config/api-key', { provider: 'fal', apiKey: key });
        if (resp.ok) {
            G.ui.apiKeyInput.text = '';
            showStatus('API key saved.');
        } else {
            showStatus((resp.data && resp.data.error) || 'Could not save key.');
        }
    }

    function saveOutputSettings() {
        G.settings.outputFolder   = G.ui.outputFolderInput.text   || '';
        G.settings.sequenceName   = G.ui.sequenceNameInput.text   || DEFAULT_SEQUENCE_NAME;
        G.settings.stillDuration  = parseInt(G.ui.stillDurationInput.text, 10) || DEFAULT_STILL_DURATION;
        G.settings.namingTemplate = G.ui.namingTemplateInput.text || DEFAULT_NAMING_TEMPLATE;
        if (savePanelSettings(G.settings)) {
            showStatus('Settings saved.');
        } else {
            showStatus('Could not save settings to disk.');
        }
    }

    function browseOutputFolder() {
        var folder = Folder.selectDialog('Select output folder for AI generated media');
        if (folder) G.ui.outputFolderInput.text = folder.fsName;
    }

    // ─── History ──────────────────────────────────────────────────────────────
    function loadHistory() {
        var resp = httpPost('/history', getProjectContext());
        if (!resp.ok) {
            showStatus('Could not load history: ' + (resp.error || 'helper error'));
            return;
        }
        if (!resp.data || !(resp.data instanceof Array)) {
            showStatus('Could not load history: unexpected response');
            return;
        }
        G.historyData = resp.data;
        var lb = G.ui.historyList;
        lb.removeAll();
        for (var i = 0; i < G.historyData.length; i++) {
            var entry = G.historyData[i];
            var dt    = entry.completedAt ? entry.completedAt.replace('T', ' ').substring(0, 16) : '';
            var label = modelLabelFromKey(entry.model);
            var ar    = entry.aspectRatio || '—';
            lb.add('item', dt + '  |  ' + label + '  |  ' + ar);
        }
        if (G.historyData.length === 0) {
            G.ui.historyPrompt.text = 'No history yet.';
            G.ui.historyInfo.text   = '';
        }
    }

    function revealInFinder() {
        var lb  = G.ui.historyList;
        var idx = lb.selection ? lb.selection.index : -1;
        if (idx < 0 || idx >= G.historyData.length) { showStatus('Select a history entry first.'); return; }
        var fp = G.historyData[idx].outputFilePath;
        if (!fp) { showStatus('No output file recorded.'); return; }
        try {
            if ($.os.toLowerCase().indexOf('mac') !== -1) {
                system.callSystem('open -R "' + fp + '"');
            } else {
                system.callSystem('explorer /select,"' + fp.replace(/\//g, '\\') + '"');
            }
        } catch (e) { showStatus('Could not open Finder: ' + e.message); }
    }

    function applyHistoryToGenerate() {
        var lb  = G.ui.historyList;
        var idx = lb.selection ? lb.selection.index : -1;
        if (idx < 0 || idx >= G.historyData.length) { showStatus('Select a history entry first.'); return; }
        var entry = G.historyData[idx];
        G.ui.tabPanel.selection = G.ui.genTab;
        G.ui.genPrompt.text = G.ui.historyPrompt.text || entry.prompt || '';
        var label = modelLabelFromKey(entry.model);
        for (var i = 0; i < G.ui.genModel.items.length; i++) {
            if (G.ui.genModel.items[i].text === label) { G.ui.genModel.selection = i; break; }
        }
        if (entry.aspectRatio) {
            var arLabel = entry.aspectRatio === 'auto' ? 'Auto' : entry.aspectRatio;
            for (var j = 0; j < G.ui.genAspect.items.length; j++) {
                if (G.ui.genAspect.items[j].text === arLabel) { G.ui.genAspect.selection = j; break; }
            }
        }
    }

    function applyHistoryToEdit() {
        var lb  = G.ui.historyList;
        var idx = lb.selection ? lb.selection.index : -1;
        if (idx < 0 || idx >= G.historyData.length) { showStatus('Select a history entry first.'); return; }
        var entry = G.historyData[idx];
        G.ui.tabPanel.selection = G.ui.editTab;
        G.ui.editPrompt.text = G.ui.historyPrompt.text || entry.prompt || '';
    }

    function applyHistoryToAnimate() {
        var lb  = G.ui.historyList;
        var idx = lb.selection ? lb.selection.index : -1;
        if (idx < 0 || idx >= G.historyData.length) { showStatus('Select a history entry first.'); return; }
        var entry = G.historyData[idx];
        G.ui.tabPanel.selection = G.ui.vidTab;
        G.ui.vidPrompt.text = G.ui.historyPrompt.text || entry.prompt || '';
        var label = modelLabelFromKey(entry.model);
        for (var i = 0; i < G.ui.vidModel.items.length; i++) {
            if (G.ui.vidModel.items[i].text === label) { G.ui.vidModel.selection = i; break; }
        }
    }

    // ─── Placeholder text ─────────────────────────────────────────────────────
    var PLACEHOLDER_EDIT = 'Describe how to edit the selected image…';
    var PLACEHOLDER_GEN  = 'Describe the image you want to generate…';
    var PLACEHOLDER_VID  = 'Describe how to animate the image…';

    function addPlaceholder(textArea, placeholder) {
        if (!textArea.text) textArea.text = placeholder;
        textArea.addEventListener('focus', function () {
            if (this.text === placeholder) this.text = '';
        });
        textArea.addEventListener('blur', function () {
            if (!this.text) this.text = placeholder;
        });
    }

    // ─── Build UI ─────────────────────────────────────────────────────────────
    function buildUI(container) {
        var panel = (container instanceof Panel)
            ? container
            : new Window('palette', 'Prem Image Gen', undefined, { resizeable: true });

        panel.orientation   = 'column';
        panel.alignChildren = ['fill', 'fill'];
        panel.spacing = 6;
        panel.margins = 10;
        G.ui.panel = panel;

        // ── Source info row ───────────────────────────────────────────────────
        var srcRow = panel.add('group');
        srcRow.orientation   = 'row';
        srcRow.alignment     = ['fill', 'top'];
        srcRow.alignChildren = ['left', 'center'];
        var selLabel = srcRow.add('statictext', undefined, '— no image selected —');
        selLabel.alignment = ['fill', 'center'];
        G.ui.selectionLabel = selLabel;
        var refreshBtn = srcRow.add('button', undefined, '↺');
        refreshBtn.preferredSize = [26, 22];
        refreshBtn.helpTip = 'Refresh selected item info';
        refreshBtn.onClick = refreshSelectionDisplay;

        // ── Tab bar ───────────────────────────────────────────────────────────
        var tabPanel = panel.add('tabbedpanel');
        tabPanel.alignment     = ['fill', 'fill'];
        tabPanel.alignChildren = ['fill', 'fill'];

        var genTab      = tabPanel.add('tab', undefined, 'Generate Image');
        var editTab     = tabPanel.add('tab', undefined, 'Edit Image');
        var vidTab      = tabPanel.add('tab', undefined, 'Generate Video');
        var histTab     = tabPanel.add('tab', undefined, 'History');
        var settingsTab = tabPanel.add('tab', undefined, 'Settings');

        G.ui.tabPanel = tabPanel;
        G.ui.genTab   = genTab;
        G.ui.editTab  = editTab;
        G.ui.vidTab   = vidTab;

        genTab.orientation      = 'column'; genTab.alignment      = ['fill','fill']; genTab.alignChildren      = ['fill','top']; genTab.spacing      = 6; genTab.margins      = 8;
        editTab.orientation     = 'column'; editTab.alignment     = ['fill','fill']; editTab.alignChildren     = ['fill','top']; editTab.spacing     = 6; editTab.margins     = 8;
        vidTab.orientation      = 'column'; vidTab.alignment      = ['fill','fill']; vidTab.alignChildren      = ['fill','top']; vidTab.spacing      = 6; vidTab.margins      = 8;
        histTab.orientation     = 'column'; histTab.alignment     = ['fill','fill']; histTab.alignChildren     = ['fill','top']; histTab.spacing     = 6; histTab.margins     = 8;
        settingsTab.orientation = 'column'; settingsTab.alignment = ['fill','fill']; settingsTab.alignChildren = ['fill','top']; settingsTab.spacing = 8; settingsTab.margins = 8;

        // ── GENERATE IMAGE tab ────────────────────────────────────────────────
        genTab.add('statictext', undefined, 'Prompt:');
        var genPrompt = genTab.add('edittext', undefined, '', { multiline: true });
        genPrompt.preferredSize.height = 68;
        genPrompt.alignment = ['fill', 'fill'];
        G.ui.genPrompt = genPrompt;
        addPlaceholder(genPrompt, PLACEHOLDER_GEN);

        var genModelRow = genTab.add('group');
        genModelRow.orientation = 'row'; genModelRow.alignChildren = ['left', 'center'];
        genModelRow.add('statictext', undefined, 'Model:');
        var genModel = genModelRow.add('dropdownlist', undefined, [
            'Nano Banana 2', 'GPT Image 2', 'FLUX 2 Pro', 'Grok Imagine', 'Seedream 5 Lite', 'Qwen Image Max'
        ]);
        genModel.selection = 0; genModel.preferredSize.width = 130;
        G.ui.genModel = genModel;

        var genAspectRow = genTab.add('group');
        genAspectRow.orientation = 'row'; genAspectRow.alignChildren = ['left', 'center'];
        genAspectRow.add('statictext', undefined, 'Aspect:');
        var genAspect = genAspectRow.add('dropdownlist', undefined, ['Auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
        genAspect.selection = 1; genAspect.preferredSize.width = 90; // default 16:9
        G.ui.genAspect = genAspect;

        var genCountRow = genTab.add('group');
        genCountRow.orientation = 'row'; genCountRow.alignChildren = ['left', 'center'];
        genCountRow.add('statictext', undefined, 'Count:');
        var genCount = genCountRow.add('dropdownlist', undefined, ['1','2','3','4','5','6','8','10']);
        genCount.selection = 0; genCount.preferredSize.width = 60;
        G.ui.genCount = genCount;

        var generateBtn = genTab.add('button', undefined, 'Generate Image');
        generateBtn.alignment = ['fill', 'top'];
        G.ui.generateBtn = generateBtn;
        generateBtn.onClick = function () {
            ensureHelper(submitGenerateJobs, function () { showStatus('Helper could not start. Check install.'); });
        };

        // ── EDIT IMAGE tab ────────────────────────────────────────────────────
        var editSrcNote = editTab.add('statictext', undefined, 'Uses selected image from timeline or project panel.');
        editSrcNote.alignment = ['fill', 'top'];

        editTab.add('statictext', undefined, 'Prompt:');
        var editPrompt = editTab.add('edittext', undefined, '', { multiline: true });
        editPrompt.preferredSize.height = 68;
        editPrompt.alignment = ['fill', 'fill'];
        G.ui.editPrompt = editPrompt;
        addPlaceholder(editPrompt, PLACEHOLDER_EDIT);

        editTab.add('statictext', undefined, 'Model: Nano Banana 2');

        var editAspectRow = editTab.add('group');
        editAspectRow.orientation = 'row'; editAspectRow.alignChildren = ['left', 'center'];
        editAspectRow.add('statictext', undefined, 'Aspect:');
        var editAspect = editAspectRow.add('dropdownlist', undefined, ['Auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
        editAspect.selection = 0; editAspect.preferredSize.width = 90;
        G.ui.editAspect = editAspect;

        var editBtn = editTab.add('button', undefined, 'Edit Selected Image');
        editBtn.alignment = ['fill', 'top'];
        G.ui.editBtn = editBtn;
        editBtn.onClick = function () {
            ensureHelper(submitEditJob, function () { showStatus('Helper could not start. Check install.'); });
        };

        // ── GENERATE VIDEO tab ────────────────────────────────────────────────
        var vidSrcNote = vidTab.add('statictext', undefined, 'Uses selected image from timeline or project panel.');
        vidSrcNote.alignment = ['fill', 'top'];

        vidTab.add('statictext', undefined, 'Prompt:');
        var vidPrompt = vidTab.add('edittext', undefined, '', { multiline: true });
        vidPrompt.preferredSize.height = 68;
        vidPrompt.alignment = ['fill', 'fill'];
        G.ui.vidPrompt = vidPrompt;
        addPlaceholder(vidPrompt, PLACEHOLDER_VID);

        var vidModelRow = vidTab.add('group');
        vidModelRow.orientation = 'row'; vidModelRow.alignChildren = ['left', 'center'];
        vidModelRow.add('statictext', undefined, 'Model:');
        var vidModel = vidModelRow.add('dropdownlist', undefined, ['Seedance 2.0', 'Kling 3.0', 'Veo 3.1', 'Grok Video', 'Hailuo 2.3']);
        vidModel.selection = 0; vidModel.preferredSize.width = 110;
        G.ui.vidModel = vidModel;

        var vidDurRow = vidTab.add('group');
        vidDurRow.orientation = 'row'; vidDurRow.alignChildren = ['left', 'center'];
        vidDurRow.add('statictext', undefined, 'Duration:');
        var vidDuration = vidDurRow.add('dropdownlist', undefined, ['5s', '6s', '8s', '10s']);
        vidDuration.selection = 0; vidDuration.preferredSize.width = 70;
        G.ui.vidDuration = vidDuration;

        var vidAspectRow = vidTab.add('group');
        vidAspectRow.orientation = 'row'; vidAspectRow.alignChildren = ['left', 'center'];
        vidAspectRow.add('statictext', undefined, 'Aspect:');
        var vidAspect = vidAspectRow.add('dropdownlist', undefined, ['16:9', '9:16', '1:1', '4:3', '3:4']);
        vidAspect.selection = 0; vidAspect.preferredSize.width = 90;
        G.ui.vidAspect = vidAspect;

        var vidCountRow = vidTab.add('group');
        vidCountRow.orientation = 'row'; vidCountRow.alignChildren = ['left', 'center'];
        vidCountRow.add('statictext', undefined, 'Count:');
        var vidCount = vidCountRow.add('dropdownlist', undefined, ['1','2','3','4','5','6','8','10']);
        vidCount.selection = 0; vidCount.preferredSize.width = 60;
        G.ui.vidCount = vidCount;

        var animateBtn = vidTab.add('button', undefined, 'Generate Video from Selected');
        animateBtn.alignment = ['fill', 'top'];
        G.ui.animateBtn = animateBtn;
        animateBtn.onClick = function () {
            ensureHelper(function () { submitVideoJobs(false); }, function () { showStatus('Helper could not start. Check install.'); });
        };

        var animateLastBtn = vidTab.add('button', undefined, 'Generate Video from Last Image');
        animateLastBtn.alignment = ['fill', 'top'];
        G.ui.animateLastBtn = animateLastBtn;
        animateLastBtn.onClick = function () {
            if (!G.lastGeneratedPath) { showStatus('No generated image yet. Run Generate or Edit first.'); return; }
            ensureHelper(function () { submitVideoJobs(true); }, function () { showStatus('Helper could not start. Check install.'); });
        };

        // ── HISTORY tab ───────────────────────────────────────────────────────
        var histRefreshRow = histTab.add('group');
        histRefreshRow.orientation = 'row'; histRefreshRow.alignChildren = ['left', 'center'];
        var histRefreshBtn = histRefreshRow.add('button', undefined, 'Refresh');
        histRefreshBtn.preferredSize.width = 70;
        histRefreshBtn.onClick = loadHistory;
        histRefreshRow.add('statictext', undefined, 'Click a row to see full prompt');

        var histList = histTab.add('listbox', undefined, [], { multiselect: false });
        histList.preferredSize.height = 160;
        histList.alignment = ['fill', 'fill'];
        G.ui.historyList = histList;

        histTab.add('statictext', undefined, 'Prompt (editable before reuse):');
        var histPrompt = histTab.add('edittext', undefined, '', { multiline: true });
        histPrompt.preferredSize.height = 72;
        histPrompt.alignment = ['fill', 'top'];
        G.ui.historyPrompt = histPrompt;

        var histInfo = histTab.add('statictext', undefined, '', { multiline: true });
        histInfo.preferredSize.height = 28;
        G.ui.historyInfo = histInfo;

        histList.onChange = function () {
            var idx = histList.selection ? histList.selection.index : -1;
            if (idx < 0 || idx >= G.historyData.length) return;
            var entry = G.historyData[idx];
            G.ui.historyPrompt.text = entry.prompt || '';
            var info = modelLabelFromKey(entry.model);
            if (entry.aspectRatio) info += '  |  ' + entry.aspectRatio;
            if (entry.duration)    info += '  |  ' + entry.duration + 's';
            info += '  |  ' + (entry.type === 'image-to-video' ? 'video' : 'image');
            G.ui.historyInfo.text = info;
            G.ui.panel.layout.layout(true);
        };

        var histBtnRow1 = histTab.add('group');
        histBtnRow1.orientation = 'row'; histBtnRow1.alignChildren = ['fill', 'center'];
        var histToGenBtn = histBtnRow1.add('button', undefined, 'Use in Generate');
        histToGenBtn.preferredSize.width = 102; histToGenBtn.onClick = applyHistoryToGenerate;
        var histToEditBtn = histBtnRow1.add('button', undefined, 'Use in Edit');
        histToEditBtn.preferredSize.width = 102; histToEditBtn.onClick = applyHistoryToEdit;

        var histBtnRow2 = histTab.add('group');
        histBtnRow2.orientation = 'row'; histBtnRow2.alignChildren = ['fill', 'center'];
        var histToVidBtn = histBtnRow2.add('button', undefined, 'Use in Video');
        histToVidBtn.preferredSize.width = 102; histToVidBtn.onClick = applyHistoryToAnimate;
        var histRevealBtn = histBtnRow2.add('button', undefined, 'Reveal in Finder');
        histRevealBtn.preferredSize.width = 102; histRevealBtn.onClick = revealInFinder;

        // ── SETTINGS tab ──────────────────────────────────────────────────────
        settingsTab.add('statictext', undefined, 'fal.ai API Key:');
        var apiKeyInput = settingsTab.add('edittext', undefined, '');
        apiKeyInput.preferredSize.height = 22;
        G.ui.apiKeyInput = apiKeyInput;
        var saveKeyBtn = settingsTab.add('button', undefined, 'Save API Key');
        saveKeyBtn.alignment = ['fill', 'top'];
        saveKeyBtn.onClick = function () {
            ensureHelper(saveApiKey, function () { showStatus('Helper could not start. Check install.'); });
        };

        settingsTab.add('panel', undefined, '').preferredSize.height = 2;

        settingsTab.add('statictext', undefined, 'Output Folder (leave blank for project folder):');
        var folderRow = settingsTab.add('group');
        folderRow.orientation = 'row'; folderRow.alignChildren = ['left', 'center'];
        var outputFolderInput = folderRow.add('edittext', undefined, '');
        outputFolderInput.preferredSize.height = 22;
        outputFolderInput.alignment = ['fill', 'center'];
        G.ui.outputFolderInput = outputFolderInput;
        var browseBtn = folderRow.add('button', undefined, 'Browse…');
        browseBtn.preferredSize.width = 60;
        browseBtn.onClick = browseOutputFolder;

        settingsTab.add('statictext', undefined, 'AI Sequence Name:');
        var sequenceNameInput = settingsTab.add('edittext', undefined, DEFAULT_SEQUENCE_NAME);
        sequenceNameInput.preferredSize.height = 22;
        G.ui.sequenceNameInput = sequenceNameInput;

        settingsTab.add('statictext', undefined, 'Still Image Duration (seconds):');
        var stillDurationInput = settingsTab.add('edittext', undefined, String(DEFAULT_STILL_DURATION));
        stillDurationInput.preferredSize.height = 22;
        G.ui.stillDurationInput = stillDurationInput;

        settingsTab.add('statictext', undefined, 'File Naming Template:');
        settingsTab.add('statictext', undefined, 'Tokens: {date}  {model}  {prompt}');
        var namingTemplateInput = settingsTab.add('edittext', undefined, DEFAULT_NAMING_TEMPLATE);
        namingTemplateInput.preferredSize.height = 22;
        G.ui.namingTemplateInput = namingTemplateInput;

        var saveSettingsBtn = settingsTab.add('button', undefined, 'Save Settings');
        saveSettingsBtn.alignment = ['fill', 'top'];
        saveSettingsBtn.onClick = saveOutputSettings;

        // ── Status area ───────────────────────────────────────────────────────
        var statusGroup = panel.add('panel', undefined, '');
        statusGroup.orientation   = 'column';
        statusGroup.alignment     = ['fill', 'top'];
        statusGroup.alignChildren = ['fill', 'top'];
        statusGroup.margins = 6;

        var progressList = statusGroup.add('listbox', undefined, [], { multiselect: false });
        progressList.preferredSize.height = 80;
        progressList.alignment = ['fill', 'top'];
        progressList.visible = false;
        G.ui.progressList = progressList;

        var statusText = statusGroup.add('statictext', undefined, 'Running: 0   Complete: 0   Failed: 0', { multiline: true });
        statusText.preferredSize.height = 32;
        G.ui.statusText = statusText;

        // ── Initial layout ────────────────────────────────────────────────────
        tabPanel.selection = genTab;
        panel.layout.layout(true);

        if (panel instanceof Window) {
            panel.onResize = panel.onResizing = function () { this.layout.resize(); };
        }

        app.scheduleTask('$.global.PremImageGen._startupCheck()', 500, false);
        return panel;
    }

    function refreshSelectionDisplay() {
        try {
            var clip = getSelectedClip();
            if (clip.error) {
                G.ui.selectionLabel.text = clip.error;
            } else {
                G.ui.selectionLabel.text = clip.name + ' (' + clip.source + ')';
            }
        } catch (e) {
            G.ui.selectionLabel.text = 'Could not read selection';
        }
    }

    // ─── Startup ──────────────────────────────────────────────────────────────
    G._startupCheck = function () {
        G.settings = loadPanelSettings();
        try {
            if (G.settings.outputFolder)   G.ui.outputFolderInput.text   = G.settings.outputFolder;
            if (G.settings.sequenceName)   G.ui.sequenceNameInput.text   = G.settings.sequenceName;
            if (G.settings.stillDuration)  G.ui.stillDurationInput.text  = String(G.settings.stillDuration);
            if (G.settings.namingTemplate) G.ui.namingTemplateInput.text = G.settings.namingTemplate;
        } catch (e) {}

        if (checkHealth()) {
            G.helperRunning = true;
            showStatus('Ready — Running: 0   Complete: 0   Failed: 0');
        } else {
            showStatus('Starting helper service…');
            launchHelper();
            app.scheduleTask('$.global.PremImageGen._startupPoll(0)', HEALTH_RETRY_MS, false);
        }
        refreshSelectionDisplay();
    };

    G._startupPoll = function (attempt) {
        if (checkHealth()) {
            G.helperRunning = true;
            showStatus('Ready — Running: 0   Complete: 0   Failed: 0');
            return;
        }
        if (attempt >= HEALTH_RETRIES) {
            showStatus('Helper could not start. Run: node src/server.js in the helper folder.');
            return;
        }
        app.scheduleTask('$.global.PremImageGen._startupPoll(' + (attempt + 1) + ')', HEALTH_RETRY_MS, false);
    };

    // ─── Entry point ─────────────────────────────────────────────────────────
    var panel = buildUI(thisObj);
    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }

})(this);
