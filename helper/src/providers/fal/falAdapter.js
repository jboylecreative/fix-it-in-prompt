'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { fal } = require('@fal-ai/client');
const { getEditImageModel, getImageToVideoModel, getVideoToVideoModel } = require('./models');
const { fileUtils } = require('../../utils/fileUtils');
const { logger } = require('../../utils/logger');

class FalAdapter {
  constructor(apiKey) {
    if (!apiKey) throw new Error('FalAdapter: apiKey is required');
    fal.config({ credentials: apiKey });
  }

  // ─── Edit Image ─────────────────────────────────────────────────────────────

  async editImage(params) {
    const { model, prompt, aspectRatio, seed, sourceFilePath, projectContext, onProgress, onStatus } = params;
    const modelDef = getEditImageModel(model);

    let imageUrl = null;
    if (sourceFilePath) {
      onStatus('uploading');
      onProgress(10);
      imageUrl = await this._uploadFile(sourceFilePath);
      logger.info(`Uploaded source to fal storage: ${imageUrl}`);
    }

    onStatus('queued');
    onProgress(20);

    const input = modelDef.buildInput({ imageUrl, prompt, aspectRatio });
    if (seed != null && !isNaN(Number(seed)) && modelDef.supportsSeed) input.seed = Number(seed);
    logger.info(`Submitting ${modelDef.falModelId} job — input: ${JSON.stringify(input)}`);

    const { request_id } = await fal.queue.submit(modelDef.falModelId, { input });
    logger.info(`fal request_id: ${request_id}`);

    onStatus('generating');
    onProgress(30);

    const result = await this._pollUntilComplete(modelDef.falModelId, request_id, onProgress, 30, 85);

    onStatus('downloading');
    onProgress(87);

    const outputUrl = modelDef.extractOutputUrl(result);
    const ext = modelDef.outputExtension;
    const tentativePath = fileUtils.resolveOutputPath(sourceFilePath, projectContext, model, 'edit', ext);
    const outputPath = await this._downloadFile(outputUrl, tentativePath);

    onStatus('complete');
    onProgress(100);

    const metadataPath = await fileUtils.writeMetadata({
      id: request_id,
      timestamp: new Date().toISOString(),
      source_layer_name: projectContext.layerName || '',
      source_file_path: sourceFilePath,
      source_type: 'original_source_image',
      workflow: 'image_edit',
      provider: 'fal',
      model,
      fal_model_id: modelDef.falModelId,
      prompt,
      aspect_ratio: aspectRatio,
      input_files: sourceFilePath ? [sourceFilePath] : [],
      output_file: outputPath,
      job_id: request_id,
      status: 'complete',
    }, outputPath);

    return { outputFilePath: outputPath, metadataFilePath: metadataPath };
  }

  // ─── Image to Video ──────────────────────────────────────────────────────────

  async imageToVideo(params) {
    const { model, prompt, duration, aspectRatio, resolution, seed, sourceFilePath, projectContext, onProgress, onStatus } = params;
    const modelDef = getImageToVideoModel(model);

    let imageUrl = null;
    if (sourceFilePath) {
      onStatus('uploading');
      onProgress(10);
      imageUrl = await this._uploadFile(sourceFilePath);
      logger.info(`Uploaded source to fal storage: ${imageUrl}`);
    }

    onStatus('queued');
    onProgress(20);

    const input = modelDef.buildInput({ imageUrl, prompt, duration, aspectRatio });
    if (seed != null && !isNaN(Number(seed)) && modelDef.supportsSeed) input.seed = Number(seed);
    if (resolution && modelDef.resolutions) input.resolution = resolution;
    logger.info(`Submitting ${modelDef.falModelId} job`);

    const { request_id } = await fal.queue.submit(modelDef.falModelId, { input });
    logger.info(`fal request_id: ${request_id}`);

    onStatus('generating');
    onProgress(30);

    const result = await this._pollUntilComplete(modelDef.falModelId, request_id, onProgress, 30, 85);

    onStatus('downloading');
    onProgress(87);

    const outputUrl = modelDef.extractOutputUrl(result);
    const ext = modelDef.outputExtension;
    const tentativePath = fileUtils.resolveOutputPath(sourceFilePath || null, projectContext, model, 'vid', ext);
    const outputPath = await this._downloadFile(outputUrl, tentativePath);

    onStatus('complete');
    onProgress(100);

    const metadataPath = await fileUtils.writeMetadata({
      id: request_id,
      timestamp: new Date().toISOString(),
      source_layer_name: projectContext.layerName || '',
      source_file_path: sourceFilePath || null,
      source_type: sourceFilePath ? 'original_source_image' : 'text_only',
      workflow: 'image_to_video',
      provider: 'fal',
      model,
      fal_model_id: modelDef.falModelId,
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      input_files: sourceFilePath ? [sourceFilePath] : [],
      output_file: outputPath,
      job_id: request_id,
      status: 'complete',
    }, outputPath);

    return { outputFilePath: outputPath, metadataFilePath: metadataPath };
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  async _uploadFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      mxf: 'application/mxf', avi: 'video/x-msvideo',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const file = new File([buffer], path.basename(filePath), { type: mime });
    const url = await fal.storage.upload(file);
    return url;
  }

  async _trimVideo(sourcePath, inPoint, duration) {
    let ffmpegPath;
    try { ffmpegPath = require('ffmpeg-static'); }
    catch (e) { throw new Error('ffmpeg-static not found. Run: npm install in the helper directory.'); }

    const { execFile } = require('child_process');
    const os = require('os');
    const ext = path.extname(sourcePath) || '.mp4';
    const tmpFile = path.join(os.tmpdir(), `aig_v2v_${Date.now()}${ext}`);

    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, [
        '-ss', String(inPoint),
        '-t',  String(duration),
        '-i',  sourcePath,
        '-c',  'copy',
        '-avoid_negative_ts', 'make_zero',
        '-y',
        tmpFile,
      ], { timeout: 120000, windowsHide: true }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`FFmpeg trim failed: ${stderr || err.message}`));
        else resolve();
      });
    });

    return tmpFile;
  }

  // ─── Video to Video ──────────────────────────────────────────────────────────

  async videoToVideo(params) {
    const { mode, prompt, sourceFilePath, inPoint, duration, imagePaths, elementPaths,
            projectContext, onProgress, onStatus, modelKey: explicitModelKey, resolution, seed } = params;

    const modelKey = explicitModelKey || (mode === 'reference' ? 'kling-v2v-reference' : 'kling-v2v-edit');
    const modelDef = getVideoToVideoModel(modelKey);

    // Trim the source to the exact in/out window
    onStatus('trimming');
    onProgress(5);
    let tmpVideoPath = null;
    let videoPath = sourceFilePath;
    try {
      tmpVideoPath = await this._trimVideo(sourceFilePath, inPoint, duration);
      videoPath = tmpVideoPath;
      logger.info(`Trimmed source to ${duration}s: ${tmpVideoPath}`);
    } catch (e) {
      logger.error('Trim failed, using source directly: ' + e.message);
    }

    try {
      // Upload all files (video + images + element images) — images in parallel
      onStatus('uploading');
      onProgress(10);

      const videoUrl = await this._uploadFile(videoPath);
      logger.info(`Uploaded video: ${videoUrl}`);
      onProgress(20);

      const imageUrls = imagePaths.length
        ? await Promise.all(imagePaths.map(p => this._uploadFile(p)))
        : [];
      onProgress(35);

      // Flatten element image paths, upload all, then rebuild nested structure
      const flatElPaths = elementPaths.flat();
      const flatElUrls  = flatElPaths.length
        ? await Promise.all(flatElPaths.map(p => this._uploadFile(p)))
        : [];
      let urlIdx = 0;
      const elementUrls = elementPaths.map(views => {
        const urls = flatElUrls.slice(urlIdx, urlIdx + views.length);
        urlIdx += views.length;
        return urls;
      });
      onProgress(50);

      // Submit job
      onStatus('queued');
      const input = modelDef.buildInput({ prompt, videoUrl, images: imageUrls, elements: elementUrls });
      if (seed != null && !isNaN(Number(seed)) && modelDef.supportsSeed) input.seed = Number(seed);
      if (resolution && modelDef.resolutions) input.resolution = resolution;
      logger.info(`Submitting ${modelDef.falModelId}`);
      const { request_id } = await fal.queue.submit(modelDef.falModelId, { input });

      onStatus('generating');
      onProgress(55);

      const result = await this._pollUntilComplete(modelDef.falModelId, request_id, onProgress, 55, 90);

      onStatus('downloading');
      onProgress(92);

      const outputUrl  = modelDef.extractOutputUrl(result);
      const tentative  = fileUtils.resolveOutputPath(sourceFilePath, projectContext, modelKey, 'v2v', 'mp4');
      const outputPath = await this._downloadFile(outputUrl, tentative);

      onStatus('complete');
      onProgress(100);

      const metadataPath = await fileUtils.writeMetadata({
        id: request_id,
        timestamp: new Date().toISOString(),
        workflow: `v2v-${mode}`,
        provider: 'fal',
        model: modelKey,
        fal_model_id: modelDef.falModelId,
        prompt,
        source_file_path: sourceFilePath,
        image_files: imagePaths,
        element_files: elementPaths,
        output_file: outputPath,
        job_id: request_id,
        status: 'complete',
      }, outputPath);

      return { outputFilePath: outputPath, metadataFilePath: metadataPath };
    } finally {
      if (tmpVideoPath) { try { fs.unlinkSync(tmpVideoPath); } catch (e) {} }
    }
  }

  async _pollUntilComplete(falModelId, requestId, onProgress, progressStart, progressEnd) {
    const POLL_INTERVAL_MS = 3000;
    const MAX_POLLS = 200; // ~10 minutes
    let polls = 0;

    while (polls < MAX_POLLS) {
      await sleep(POLL_INTERVAL_MS);
      polls++;

      const status = await fal.queue.status(falModelId, { requestId, logs: false });
      logger.info(`Poll ${polls}: ${status.status}`);

      const progressFraction = Math.min(polls / MAX_POLLS, 1);
      const progress = Math.round(progressStart + progressFraction * (progressEnd - progressStart));
      onProgress(progress);

      if (status.status === 'COMPLETED') {
        const raw = await fal.queue.result(falModelId, { requestId });
        const result = raw.data || raw;
        return result;
      }

      if (status.status === 'FAILED') {
        const errMsg = status.error || 'fal.ai job failed with no error message';
        throw new Error(`Provider job failed: ${errMsg}`);
      }

      // IN_QUEUE or IN_PROGRESS — keep polling
    }

    throw new Error('Job timed out after 10 minutes of polling');
  }

  async _downloadFile(url, destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const get = url.startsWith('https') ? https : require('http');
      get.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    // Detect actual format from magic bytes and rename if the extension is wrong.
    // Some models return JPEG/WebP despite the URL suggesting PNG.
    try {
      const buf = Buffer.alloc(12);
      const fd = fs.openSync(destPath, 'r');
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);

      let detectedExt = null;
      if (buf[0] === 0xFF && buf[1] === 0xD8)                                          detectedExt = 'jpg';
      else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) detectedExt = 'png';
      else if (buf.slice(0, 4).toString('ascii') === 'RIFF' &&
               buf.slice(8, 12).toString('ascii') === 'WEBP')                           detectedExt = 'webp';

      if (detectedExt) {
        const currentExt = path.extname(destPath).replace('.', '').toLowerCase();
        if (detectedExt !== currentExt) {
          const actualPath = destPath.slice(0, destPath.lastIndexOf('.')) + '.' + detectedExt;
          fs.renameSync(destPath, actualPath);
          logger.info(`Renamed output: .${currentExt} → .${detectedExt}`);
          return actualPath;
        }
      }
    } catch (e) {
      logger.info(`Format detection skipped: ${e.message}`);
    }

    return destPath;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { FalAdapter };
