'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Resolve the AI_Generated output directory relative to the project, or fall
// back to ~/Documents/AE_AI_Generated/<projectName>/ when the project is unsaved.
// If projectContext.customOutputDir is set, it takes priority.
function resolveOutputDir(projectContext) {
  const { projectPath, projectName, customOutputDir } = projectContext || {};

  if (customOutputDir) {
    return customOutputDir;
  }

  if (projectPath && fs.existsSync(path.dirname(projectPath))) {
    return path.join(path.dirname(projectPath), 'AI_Generated', 'outputs');
  }

  const safeName = (projectName || 'Unsaved').replace(/[^a-zA-Z0-9_\-. ]/g, '_');
  return path.join(os.homedir(), 'Documents', 'AE_AI_Generated', safeName, 'outputs');
}

function resolveMetadataDir(projectContext) {
  const outputDir = resolveOutputDir(projectContext);
  return path.join(path.dirname(outputDir), 'metadata');
}

// Sanitize a string for use as a filename component
function sanitize(str) {
  return (str || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 40);
}

// Build a unique output filename, bumping the numeric suffix if needed
function buildOutputFilename(dir, layerName, model, suffix, ext) {
  const base = `${sanitize(layerName)}__${sanitize(model)}_${sanitize(suffix)}`;
  let n = 1;
  let candidate;
  do {
    candidate = path.join(dir, `${base}_${String(n).padStart(3, '0')}.${ext}`);
    n++;
  } while (fs.existsSync(candidate) && n < 9999);
  return candidate;
}

// Build a unique filename from a pre-formatted base name (no model/suffix appended)
function buildOutputFilenameFromBase(dir, base, ext) {
  const sanitizedBase = base.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 80);
  let n = 1;
  let candidate;
  do {
    candidate = path.join(dir, `${sanitizedBase}_${String(n).padStart(3, '0')}.${ext}`);
    n++;
  } while (fs.existsSync(candidate) && n < 9999);
  return candidate;
}

function resolveOutputPath(sourceFilePath, projectContext, model, suffix, ext) {
  const dir = resolveOutputDir(projectContext);
  fs.mkdirSync(dir, { recursive: true });

  // Premiere panel (and any caller) can pass a pre-formatted fileNameBase to bypass
  // the default layerName__model_suffix_NNN pattern.
  if (projectContext && projectContext.fileNameBase) {
    return buildOutputFilenameFromBase(dir, projectContext.fileNameBase, ext);
  }

  const layerName = (projectContext && projectContext.layerName) ||
    (sourceFilePath ? path.basename(sourceFilePath, path.extname(sourceFilePath)) : 'generated');
  return buildOutputFilename(dir, layerName, model, suffix, ext);
}

function resolveHistoryPath(projectContext) {
  const outputDir = resolveOutputDir(projectContext);
  return path.join(path.dirname(outputDir), 'history.json');
}

function readProjectHistory(projectContext) {
  const filePath = resolveHistoryPath(projectContext);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function appendProjectHistory(entry, projectContext) {
  const filePath = resolveHistoryPath(projectContext);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const history = readProjectHistory(projectContext);
  history.unshift(entry);
  if (history.length > 200) history.splice(200);
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
}

async function writeMetadata(meta, outputFilePath) {
  const dir = path.join(path.dirname(path.dirname(outputFilePath)), 'metadata');
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(outputFilePath, path.extname(outputFilePath)) + '.json';
  const metaPath = path.join(dir, name);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return metaPath;
}

const fileUtils = {
  resolveOutputDir,
  resolveMetadataDir,
  resolveOutputPath,
  resolveHistoryPath,
  readProjectHistory,
  appendProjectHistory,
  writeMetadata,
  sanitize,
};

module.exports = { fileUtils };
