'use strict';

const express = require('express');
const { jobManager } = require('./jobManager');
const { configManager } = require('./config/configManager');
const { logger } = require('./utils/logger');

const PORT = 47832;
const HOST = '127.0.0.1';

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS headers for CEP panel fetch() calls
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Bind only to localhost — never expose to network
app.listen(PORT, HOST, () => {
  logger.info(`AEImageGen helper running at http://${HOST}:${PORT}`);
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.post('/jobs/edit-image', async (req, res) => {
  const { provider, model, prompt, aspectRatio, seed, sourceFilePath, projectContext } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const apiKey = configManager.getApiKey(provider || 'fal');
  if (!apiKey) {
    return res.status(401).json({ error: 'API key not configured. Set it in the panel Settings.' });
  }

  try {
    const job = await jobManager.createJob({
      type: 'edit-image',
      provider: provider || 'fal',
      model: model || 'nano-banana',
      prompt,
      aspectRatio: aspectRatio || 'auto',
      seed: seed != null ? seed : null,
      sourceFilePath,
      projectContext: projectContext || {},
      apiKey,
    });
    res.json({ jobId: job.id, status: job.status });
  } catch (err) {
    logger.error('Failed to create edit-image job', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/image-to-video', async (req, res) => {
  const { provider, model, prompt, duration, aspectRatio, resolution, seed, sourceFilePath, projectContext } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const apiKey = configManager.getApiKey(provider || 'fal');
  if (!apiKey) {
    return res.status(401).json({ error: 'API key not configured. Set it in the panel Settings.' });
  }

  try {
    const job = await jobManager.createJob({
      type: 'image-to-video',
      provider: provider || 'fal',
      model: model || 'seedance',
      prompt,
      duration: duration || '5',
      aspectRatio: aspectRatio || '16:9',
      resolution: resolution || null,
      seed: seed != null ? seed : null,
      sourceFilePath: sourceFilePath || null,
      projectContext: projectContext || {},
      apiKey,
    });
    res.json({ jobId: job.id, status: job.status });
  } catch (err) {
    logger.error('Failed to create image-to-video job', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/v2v', async (req, res) => {
  const { provider, v2vModel, mode, prompt, sourceFilePath, inPoint, outPoint,
          images, elements, resolution, seed, projectContext } = req.body;

  if (!prompt || !sourceFilePath) {
    return res.status(400).json({ error: 'prompt and sourceFilePath are required' });
  }

  const apiKey = configManager.getApiKey(provider || 'fal');
  if (!apiKey) {
    return res.status(401).json({ error: 'API key not configured. Set it in the panel Settings.' });
  }

  try {
    const job = await jobManager.createJob({
      type:          'v2v',
      provider:      provider || 'fal',
      model:         v2vModel || 'kling-v2v-edit',
      mode:          mode     || 'edit',
      prompt,
      sourceFilePath,
      inPoint:       inPoint  || 0,
      outPoint:      outPoint || 10,
      images:        images   || [],
      elements:      elements || [],
      resolution:    resolution || null,
      seed:          seed != null ? seed : null,
      projectContext: projectContext || {},
      apiKey,
    });
    res.json({ jobId: job.id, status: job.status });
  } catch (err) {
    logger.error('Failed to create v2v job', err);
    res.status(500).json({ error: err.message });
  }
});

const { fileUtils } = require('./utils/fileUtils');

app.post('/history', (req, res) => {
  const projectContext = req.body || {};
  res.json(fileUtils.readProjectHistory(projectContext));
});

app.get('/jobs/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    outputFilePath: job.outputFilePath || null,
    metadataFilePath: job.metadataFilePath || null,
    error: job.error || null,
  });
});

app.post('/config/api-key', (req, res) => {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'provider and apiKey are required' });
  }
  try {
    configManager.setApiKey(provider, apiKey);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/config/api-key/:provider', (req, res) => {
  const key = configManager.getApiKey(req.params.provider);
  res.json({ configured: !!key });
});

app.post('/shutdown', (req, res) => {
  res.json({ ok: true });
  logger.info('Shutdown requested');
  setTimeout(() => process.exit(0), 200);
});

// Unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});
