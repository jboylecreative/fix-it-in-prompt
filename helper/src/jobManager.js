'use strict';

const { randomUUID } = require('crypto');
const { FalAdapter } = require('./providers/fal/falAdapter');
const { logger } = require('./utils/logger');
const { fileUtils } = require('./utils/fileUtils');

// In-memory job store — acceptable for v1 (jobs lost on helper restart)
const jobs = new Map();

function createAdapter(provider, apiKey) {
  if (provider === 'fal') return new FalAdapter(apiKey);
  throw new Error(`Unknown provider: ${provider}`);
}

async function createJob(params) {
  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    progress: 0,
    type: params.type,
    provider: params.provider,
    model: params.model,
    prompt: params.prompt,
    aspectRatio: params.aspectRatio,
    duration: params.duration,
    sourceFilePath: params.sourceFilePath,
    projectContext: params.projectContext,
    // v2v-specific
    mode:      params.mode      || null,
    inPoint:   params.inPoint   || 0,
    outPoint:  params.outPoint  || 0,
    images:    params.images    || [],
    elements:  params.elements  || [],
    // shared options
    resolution: params.resolution || null,
    seed:       params.seed       != null ? params.seed : null,
    outputFilePath: null,
    metadataFilePath: null,
    error: null,
    createdAt: new Date().toISOString(),
  };

  jobs.set(id, job);

  // Run async without awaiting — caller gets jobId immediately
  runJob(job, params.apiKey).catch((err) => {
    job.status = 'failed';
    job.error = err.message;
    logger.error(`Job ${id} failed`, err);
  });

  return job;
}

async function runJob(job, apiKey) {
  const adapter = createAdapter(job.provider, apiKey);

  try {
    job.status = 'running';
    job.progress = 5;

    let handle;
    if (job.type === 'edit-image') {
      handle = await adapter.editImage({
        model: job.model,
        prompt: job.prompt,
        aspectRatio: job.aspectRatio,
        seed: job.seed,
        sourceFilePath: job.sourceFilePath,
        projectContext: job.projectContext,
        onProgress: (p) => { job.progress = p; },
        onStatus: (s) => { job.status = s; },
      });
    } else if (job.type === 'image-to-video') {
      handle = await adapter.imageToVideo({
        model: job.model,
        prompt: job.prompt,
        duration: job.duration,
        aspectRatio: job.aspectRatio,
        resolution: job.resolution,
        seed: job.seed,
        sourceFilePath: job.sourceFilePath,
        projectContext: job.projectContext,
        onProgress: (p) => { job.progress = p; },
        onStatus: (s) => { job.status = s; },
      });
    } else if (job.type === 'v2v') {
      handle = await adapter.videoToVideo({
        modelKey:      job.model,
        mode:          job.mode || 'edit',
        prompt:        job.prompt,
        sourceFilePath: job.sourceFilePath,
        inPoint:       job.inPoint,
        duration:      job.outPoint - job.inPoint,
        imagePaths:    job.images,
        elementPaths:  job.elements,
        resolution:    job.resolution,
        seed:          job.seed,
        projectContext: job.projectContext,
        onProgress: (p) => { job.progress = p; },
        onStatus:   (s) => { job.status   = s; },
      });
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    job.outputFilePath = handle.outputFilePath;
    job.metadataFilePath = handle.metadataFilePath;
    job.status = 'complete';
    job.progress = 100;
    logger.info(`Job ${job.id} complete: ${job.outputFilePath}`);

    try {
      fileUtils.appendProjectHistory({
        completedAt:    new Date().toISOString(),
        createdAt:      job.createdAt,
        type:           job.type,
        model:          job.model,
        prompt:         job.prompt,
        aspectRatio:    job.aspectRatio || null,
        duration:       job.duration    || null,
        outputFilePath: job.outputFilePath,
      }, job.projectContext);
    } catch (e) {
      logger.info(`Could not write history: ${e.message}`);
    }
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    throw err;
  }
}

function getJob(id) {
  return jobs.get(id) || null;
}

const jobManager = { createJob, getJob };
module.exports = { jobManager };
