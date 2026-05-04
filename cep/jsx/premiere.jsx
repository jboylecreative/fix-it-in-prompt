// premiere.jsx — ExtendScript called via CSInterface.evalScript() from main.js
// All public functions return JSON strings.

// JSON shim for safety
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

var SUPPORTED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
var SUPPORTED_VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mxf', 'avi', 'mkv'];

function _isImageFile(filePath) {
    if (!filePath) return false;
    var ext = filePath.split('.').pop().toLowerCase();
    for (var i = 0; i < SUPPORTED_IMAGE_EXTS.length; i++) {
        if (SUPPORTED_IMAGE_EXTS[i] === ext) return true;
    }
    return false;
}

function _isVideoFile(filePath) {
    if (!filePath) return false;
    var ext = filePath.split('.').pop().toLowerCase();
    for (var i = 0; i < SUPPORTED_VIDEO_EXTS.length; i++) {
        if (SUPPORTED_VIDEO_EXTS[i] === ext) return true;
    }
    return false;
}

// ─── Project info ─────────────────────────────────────────────────────────────

function getProjectInfo() {
    var info = { projectPath: '', projectName: 'Unsaved' };
    try {
        if (app.project.path) {
            info.projectPath = app.project.path;
            info.projectName = app.project.name.replace(/\.prproj$/i, '');
        }
    } catch (e) {}
    return JSON.stringify(info);
}

// ─── Selection ────────────────────────────────────────────────────────────────

function _getSelectedProjectItems() {
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

function getSelectedClip() {
    // Priority 1: timeline selection
    try {
        var seq = app.project.activeSequence;
        if (seq) {
            var sel = seq.getSelection();
            if (sel && sel.length > 0) {
                if (sel.length > 1) return JSON.stringify({ error: 'Multiple clips selected. Select exactly one image.' });
                var pi       = sel[0].projectItem;
                var mediaPath = pi.getMediaPath();
                if (!_isImageFile(mediaPath)) {
                    return JSON.stringify({ error: 'Selected clip is not a still image. Select a PNG, JPG, or WebP.' });
                }
                return JSON.stringify({ path: mediaPath, name: pi.name, source: 'timeline' });
            }
        }
    } catch (e) {}

    // Priority 2: project panel selection
    try {
        var items = _getSelectedProjectItems();
        if (items.length > 1) return JSON.stringify({ error: 'Multiple items selected. Select exactly one image.' });
        if (items.length === 1) {
            var mediaPath = items[0].getMediaPath();
            if (!_isImageFile(mediaPath)) {
                return JSON.stringify({ error: 'Selected item is not a still image. Select a PNG, JPG, or WebP.' });
            }
            return JSON.stringify({ path: mediaPath, name: items[0].name, source: 'project panel' });
        }
    } catch (e) {}

    return JSON.stringify({ error: 'No image selected. Select a still image in the timeline or project panel.' });
}

// ─── Import and append to AI sequence ────────────────────────────────────────

function _normPath(p) {
    return p ? String(p).replace(/\\/g, '/').toLowerCase() : '';
}

function _findItemByPath(item, mediaPath) {
    try {
        if (item.type !== ProjectItemType.BIN && _normPath(item.getMediaPath()) === _normPath(mediaPath)) return item;
    } catch (e) {}
    try {
        if (item.children) {
            for (var i = 0; i < item.children.numItems; i++) {
                var found = _findItemByPath(item.children[i], mediaPath);
                if (found) return found;
            }
        }
    } catch (e) {}
    return null;
}

function _getOrCreateBin(binName) {
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

function _findPresetPath() {
    try {
        var root = new Folder(String(app.path).replace(/\\/g, '/') + 'Settings/SequencePresets');
        function first(folder) {
            var files = folder.getFiles('*.sqpreset');
            if (files && files.length > 0) return files[0].fsName;
            var subs = folder.getFiles(function(f) { return f instanceof Folder; });
            for (var i = 0; i < subs.length; i++) {
                var r = first(subs[i]);
                if (r) return r;
            }
            return '';
        }
        return root.exists ? first(root) : '';
    } catch (e) { return ''; }
}

function _findOrCreateSequence(seqName) {
    try {
        for (var i = 0; i < app.project.sequences.numSequences; i++) {
            if (app.project.sequences[i].name === seqName) return app.project.sequences[i];
        }
    } catch (e) {}
    try {
        var preset = _findPresetPath();
        var newSeq = app.project.createNewSequence(seqName, preset);
        if (newSeq) return newSeq;
    } catch (e) {}
    return null;
}

function ensureAISequence(seqName) {
    try {
        var seq = _findOrCreateSequence(seqName);
        if (!seq) return JSON.stringify({ ok: false });
        try { app.project.openSequence(seq.sequenceID); } catch (e) {}
        return JSON.stringify({ ok: true });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function importAndAppend(paramsJson) {
    var params        = JSON.parse(paramsJson);
    var filePath      = params.filePath;
    var seqName       = params.sequenceName  || 'AI Generations';
    var stillDuration = params.stillDuration || 5;
    var isVideo       = params.isVideo       || false;
    var clipWidth     = params.clipWidth     || 0;
    var clipHeight    = params.clipHeight    || 0;
    var jumpToNew     = params.jumpToNew     || false;

    try {
        var dbg = [];

        // Import into AI Generated bin
        var bin = _getOrCreateBin('AI Generated');
        app.project.importFiles([filePath], true, bin, false);
        dbg.push('imported');

        var projectItem = _findItemByPath(app.project.rootItem, filePath);
        dbg.push('item:' + (projectItem ? projectItem.name : 'NOT FOUND path=' + filePath));
        if (!projectItem) return JSON.stringify({ ok: false, error: 'Could not find imported item.', dbg: dbg });

        // Find or silently create the sequence (no dialog)
        var seq = _findOrCreateSequence(seqName);
        dbg.push('seq:' + (seq ? seq.name : 'NULL'));
        if (!seq) return JSON.stringify({ ok: false, error: 'Could not create AI sequence.', dbg: dbg });

        // Open the sequence in the timeline
        try { app.project.openSequence(seq.sequenceID); dbg.push('opened'); } catch (e) { dbg.push('open-err:' + e); }

        // Find the end of the last clip on video track 0
        var endSeconds = 0;
        try {
            var track = seq.videoTracks[0];
            dbg.push('trackClips:' + track.clips.numItems);
            for (var i = 0; i < track.clips.numItems; i++) {
                var t = track.clips[i].end.seconds;
                if (t > endSeconds) endSeconds = t;
            }
        } catch (e) { dbg.push('track-err:' + e); }
        dbg.push('insertAt:' + endSeconds);

        var insertTime = new Time();
        insertTime.seconds = endSeconds;

        // Try track.insertClip first (most reliable in PP 2022+)
        var inserted = false;
        try {
            seq.videoTracks[0].insertClip(projectItem, insertTime);
            dbg.push('track.insertClip:ok');
            inserted = true;
        } catch (e) { dbg.push('track.insertClip-err:' + e); }

        // Fall back to seq.insertClip
        if (!inserted) {
            try {
                seq.insertClip(projectItem, endSeconds, 0, -1);
                dbg.push('seq.insertClip:ok');
                inserted = true;
            } catch (e) { dbg.push('seq.insertClip-err:' + e); }
        }

        // Stretch still images to the desired duration
        if (!isVideo && inserted) {
            try {
                var track2 = seq.videoTracks[0];
                for (var j = 0; j < track2.clips.numItems; j++) {
                    var c = track2.clips[j];
                    if (Math.abs(c.start.seconds - endSeconds) < 0.5) {
                        var newEnd    = new Time();
                        newEnd.seconds = endSeconds + stillDuration;
                        c.end = newEnd;
                        break;
                    }
                }
            } catch (e) { dbg.push('duration-err:' + e); }
        }

        // Scale to fit if clip is larger than the sequence frame
        if (inserted && clipWidth > 0 && clipHeight > 0) {
            try {
                var seqW = seq.frameSizeHorizontal;
                var seqH = seq.frameSizeVertical;
                if (clipWidth > seqW || clipHeight > seqH) {
                    var scaleX   = (seqW / clipWidth)  * 100;
                    var scaleY   = (seqH / clipHeight) * 100;
                    var scalePct = Math.min(scaleX, scaleY);
                    var track3   = seq.videoTracks[0];
                    for (var k = 0; k < track3.clips.numItems; k++) {
                        var clip3 = track3.clips[k];
                        if (Math.abs(clip3.start.seconds - endSeconds) < 0.5) {
                            for (var m = 0; m < clip3.components.numItems; m++) {
                                if (clip3.components[m].displayName === 'Motion') {
                                    var motionComp = clip3.components[m];
                                    for (var p = 0; p < motionComp.properties.numItems; p++) {
                                        if (motionComp.properties[p].displayName === 'Scale') {
                                            motionComp.properties[p].setValue(scalePct, true);
                                            dbg.push('scale:' + Math.round(scalePct) + '%');
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }
            } catch (e) { dbg.push('scale-err:' + e); }
        }

        // Jump playhead to the start of the newly inserted clip (offset 1 frame to
        // avoid landing on the cut point, which Premiere renders as the outgoing frame)
        if (jumpToNew && inserted) {
            try {
                var oneFrame  = parseInt(seq.timebase, 10);
                var jumpTicks = parseInt(insertTime.ticks, 10) + oneFrame;
                seq.setPlayerPosition(String(jumpTicks));
                dbg.push('jumped');
            } catch (e) { dbg.push('jump-err:' + e); }
        }

        return JSON.stringify({ ok: inserted, dbg: dbg });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

// ─── Helper launcher ──────────────────────────────────────────────────────────

function launchHelper() {
    var homeDir = Folder('~').absoluteURI;
    var helperDir, launchCmd;

    if ($.os.toLowerCase().indexOf('mac') !== -1) {
        helperDir = homeDir + '/Library/Application Support/AEImageGen/helper';
        var logDir    = homeDir + '/Library/Logs/AEImageGen';
        var nodePath  = system.callSystem('which node 2>/dev/null || ls /opt/homebrew/bin/node 2>/dev/null || echo /usr/local/bin/node').replace(/[\r\n]/g, '');
        if (!nodePath) nodePath = '/usr/local/bin/node';
        launchCmd = '/bin/sh -c \'mkdir -p "' + logDir + '" && cd "' + helperDir + '" && nohup "' + nodePath + '" src/server.js >> "' + logDir + '/helper.log" 2>&1 &\'';
    } else {
        var appData = System.getenv('APPDATA') || (homeDir + '/AppData/Roaming');
        helperDir = appData + '/AEImageGen/helper';
        var vbsPath = helperDir.replace(/\//g, '\\') + '\\launch-hidden.vbs';
        launchCmd = 'wscript.exe "' + vbsPath + '"';
    }

    try {
        system.callSystem(launchCmd);
        return JSON.stringify({ ok: true });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function browseFolder() {
    var folder = Folder.selectDialog('Select output folder for AI generated media');
    return folder ? JSON.stringify(folder.fsName) : 'null';
}

function revealFile(filePath) {
    try {
        if ($.os.toLowerCase().indexOf('mac') !== -1) {
            system.callSystem('open -R "' + filePath + '"');
        } else {
            system.callSystem('explorer /select,"' + filePath.replace(/\//g, '\\') + '"');
        }
        return 'ok';
    } catch (e) {
        return 'error: ' + e.message;
    }
}

// ─── V2V: video clip selection ────────────────────────────────────────────────

function getSelectedVideoClip() {
    // Priority 1: timeline selection (preferred — gives us in/out trim points)
    try {
        var seq = app.project.activeSequence;
        if (seq) {
            var sel = seq.getSelection();
            if (sel && sel.length > 0) {
                // Linked clips (video + audio) both appear in getSelection() but share
                // the same projectItem. Deduplicate so one linked clip counts as one.
                var seenIds = {};
                var uniqueSel = [];
                for (var s = 0; s < sel.length; s++) {
                    try {
                        var pid = sel[s].projectItem.nodeId || sel[s].projectItem.name;
                        if (!seenIds[pid]) { seenIds[pid] = true; uniqueSel.push(sel[s]); }
                    } catch (e) { uniqueSel.push(sel[s]); }
                }

                if (uniqueSel.length > 1) return JSON.stringify({ error: 'Multiple clips selected. Select exactly one video clip.' });
                var trackItem = uniqueSel[0];
                var pi        = trackItem.projectItem;
                var mediaPath = pi.getMediaPath();
                if (!_isVideoFile(mediaPath)) {
                    return JSON.stringify({ error: 'Not a video file (' + mediaPath.split('.').pop() + '). Select an MP4, MOV, or WebM clip.' });
                }
                var inPt  = 0;
                var outPt = 0;
                try { inPt  = trackItem.inPoint.seconds;  } catch (e) {}
                try { outPt = trackItem.outPoint.seconds; } catch (e) {
                    outPt = inPt + (trackItem.end.seconds - trackItem.start.seconds);
                }
                var dur = outPt - inPt;
                return JSON.stringify({ path: mediaPath, name: pi.name, source: 'timeline',
                                        duration: dur, inPoint: inPt, outPoint: outPt });
            }
        }
    } catch (e) {}

    // Priority 2: project panel selection (no trim info — uses full file)
    try {
        var items = _getSelectedProjectItems();
        if (items.length > 1) return JSON.stringify({ error: 'Multiple items selected. Select exactly one video clip.' });
        if (items.length === 1) {
            var mediaPath2 = items[0].getMediaPath();
            if (!_isVideoFile(mediaPath2)) {
                return JSON.stringify({ error: 'Selected item is not a video. Select an MP4, MOV, or WebM file.' });
            }
            var dur2 = 0;
            try { dur2 = items[0].getOutPoint().seconds - items[0].getInPoint().seconds; } catch (e) {}
            return JSON.stringify({ path: mediaPath2, name: items[0].name, source: 'project panel',
                                    duration: dur2, inPoint: 0, outPoint: dur2 });
        }
    } catch (e) {}

    return JSON.stringify({ error: 'No video selected. Select a video clip in the timeline or project panel.' });
}

// ─── V2V: single-file image browser ──────────────────────────────────────────

function browseImageFile() {
    try {
        var f = File.openDialog('Select an image', 'Image Files:*.png;*.jpg;*.jpeg;*.webp', false);
        if (f) return JSON.stringify(f.fsName);
    } catch (e) {}
    return 'null';
}
