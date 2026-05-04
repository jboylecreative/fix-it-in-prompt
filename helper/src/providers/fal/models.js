'use strict';

// ─── Aspect ratio helpers ─────────────────────────────────────────────────────

const ASPECT_RATIO_MAP = {
  'auto':  null,
  '1:1':   { width: 1024, height: 1024 },
  '16:9':  { width: 1280, height: 720  },
  '9:16':  { width: 720,  height: 1280 },
  '4:3':   { width: 1024, height: 768  },
  '3:4':   { width: 768,  height: 1024 },
  '21:9':  { width: 1344, height: 576  },
};

// Maps aspect ratio string → fal.ai preset string for models that use preset names
const FAL_SIZE_PRESETS = {
  '1:1':  'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3':  'landscape_4_3',
  '3:4':  'portrait_4_3',
  '21:9': 'landscape_16_9', // closest available
  'auto': 'square_hd',
};

function aspectRatioToSize(ratio) {
  return ASPECT_RATIO_MAP[ratio] || null;
}

function aspectRatioToPreset(ratio) {
  return FAL_SIZE_PRESETS[ratio] || 'square_hd';
}

// ─── Image models ─────────────────────────────────────────────────────────────
// supportsEdit: true  → accepts an image_url for img2img editing
// supportsEdit: false → text-to-image only (Generate Image tab)

const EDIT_IMAGE_MODELS = {
  // Edit Image tab — uses the dedicated edit endpoint for precise image editing
  'nano-banana': {
    falModelId: 'fal-ai/nano-banana-2/edit',
    label: 'Nano Banana 2',
    supportsEdit: true,
    supportsSeed: true,
    buildInput(params) {
      const input = {
        prompt: params.prompt,
        image_urls: [params.imageUrl],
        resolution: '2K',
      };
      if (params.aspectRatio && params.aspectRatio !== 'auto') {
        input.aspect_ratio = params.aspectRatio;
      }
      return input;
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      if (result.image && result.image.url) return result.image.url;
      if (result.output) return result.output;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },

  // Generate Image tab — uses the base generation endpoint
  'nano-banana-gen': {
    falModelId: 'fal-ai/nano-banana-2',
    label: 'Nano Banana 2',
    supportsEdit: false,
    supportsSeed: true,
    buildInput(params) {
      const input = {
        prompt: params.prompt,
        resolution: '2K',
      };
      if (params.aspectRatio && params.aspectRatio !== 'auto') {
        input.aspect_ratio = params.aspectRatio;
      }
      return input;
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      if (result.image && result.image.url) return result.image.url;
      if (result.output) return result.output;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },

  'gpt-image-2': {
    falModelId: 'openai/gpt-image-2',
    label: 'GPT Image 2',
    supportsEdit: false,
    supportsSeed: false,
    buildInput(params) {
      const input = {
        prompt: params.prompt,
        image_size: aspectRatioToPreset(params.aspectRatio),
      };
      return input;
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      if (result.image && result.image.url) return result.image.url;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },

  'flux-2-pro': {
    falModelId: 'fal-ai/flux-2-pro',
    label: 'FLUX 2 Pro',
    supportsEdit: false,
    supportsSeed: true,
    buildInput(params) {
      return {
        prompt: params.prompt,
        image_size: aspectRatioToPreset(params.aspectRatio),
      };
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },

  'grok-image': {
    falModelId: 'xai/grok-imagine-image',
    label: 'Grok Imagine',
    supportsEdit: false,
    supportsSeed: false,
    buildInput(params) {
      const input = {
        prompt: params.prompt,
        resolution: '2k',
      };
      if (params.aspectRatio && params.aspectRatio !== 'auto') {
        input.aspect_ratio = params.aspectRatio;
      }
      return input;
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      if (result.image && result.image.url) return result.image.url;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },

  'seedream-5': {
    falModelId: 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
    label: 'Seedream 5 Lite',
    supportsEdit: false,
    supportsSeed: true,
    buildInput(params) {
      return {
        prompt: params.prompt,
        image_size: aspectRatioToPreset(params.aspectRatio),
      };
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },

  'qwen-image-max': {
    falModelId: 'fal-ai/qwen-image-max/text-to-image',
    label: 'Qwen Image Max',
    supportsEdit: false,
    supportsSeed: true,
    buildInput(params) {
      return {
        prompt: params.prompt,
        image_size: aspectRatioToPreset(params.aspectRatio),
      };
    },
    extractOutputUrl(result) {
      if (result.images && result.images[0]) return result.images[0].url;
      throw new Error('Could not extract output URL from result: ' + JSON.stringify(result));
    },
    outputExtension: 'png',
  },
};

// ─── Image-to-video models ────────────────────────────────────────────────────

const IMAGE_TO_VIDEO_MODELS = {
  'seedance': {
    falModelId: 'bytedance/seedance-2.0/image-to-video',
    label: 'Seedance 2.0',
    supportsSeed: true,
    resolutions: ['480p', '720p', '1080p'],
    buildInput(params) {
      return {
        image_url: params.imageUrl,
        prompt: params.prompt,
        duration: parseInt(params.duration, 10) || 5,
        aspect_ratio: params.aspectRatio || 'auto',
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL from result');
    },
    outputExtension: 'mp4',
  },

  'kling': {
    falModelId: 'fal-ai/kling-video/v3/pro/image-to-video',
    label: 'Kling 3.0',
    supportsSeed: true,
    buildInput(params) {
      return {
        image_url: params.imageUrl,
        prompt: params.prompt,
        duration: parseInt(params.duration, 10) || 5,
        aspect_ratio: params.aspectRatio || '16:9',
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL from result');
    },
    outputExtension: 'mp4',
  },

  'veo': {
    falModelId: 'fal-ai/veo3.1/fast/image-to-video',
    label: 'Veo 3.1',
    supportsSeed: false,
    resolutions: ['720p', '1080p', '4k'],
    buildInput(params) {
      // Veo 3.1 fast only accepts "4s", "6s", "8s"
      const seconds = parseInt(params.duration, 10) || 8;
      const dur = seconds <= 4 ? '4s' : seconds <= 6 ? '6s' : '8s';
      // Veo only accepts "auto", "16:9", "9:16"
      const validRatios = ['auto', '16:9', '9:16'];
      const ratio = validRatios.includes(params.aspectRatio) ? params.aspectRatio : 'auto';
      return {
        image_url: params.imageUrl,
        prompt: params.prompt,
        duration: dur,
        aspect_ratio: ratio,
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL from result');
    },
    outputExtension: 'mp4',
  },

  'grok-video': {
    falModelId: 'xai/grok-imagine-video/image-to-video',
    label: 'Grok Video',
    supportsSeed: false,
    resolutions: ['480p', '720p'],
    buildInput(params) {
      return {
        image_url: params.imageUrl,
        prompt: params.prompt,
        duration: parseInt(params.duration, 10) || 5,
        aspect_ratio: params.aspectRatio || '16:9',
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL from result');
    },
    outputExtension: 'mp4',
  },

  'hailuo': {
    falModelId: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video',
    label: 'Hailuo 2.3',
    supportsSeed: true,
    resolutions: ['512p', '768p'],
    buildInput(params) {
      // Hailuo accepts duration as a string ("6" or "10"), no aspect_ratio param
      const validDurations = [6, 10];
      const dur = validDurations.includes(parseInt(params.duration, 10)) ? String(params.duration) : '6';
      return {
        image_url: params.imageUrl,
        prompt: params.prompt,
        duration: dur,
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL from result');
    },
    outputExtension: 'mp4',
  },

  'happy-horse': {
    falModelId: 'alibaba/happy-horse/image-to-video',
    label: 'Happy Horse',
    supportsSeed: true,
    resolutions: ['720p', '1080p'],
    buildInput(params) {
      return {
        image_url: params.imageUrl,
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio && params.aspectRatio !== 'auto' ? params.aspectRatio : undefined,
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL from result');
    },
    outputExtension: 'mp4',
  },
};

// ─── Video-to-video models ────────────────────────────────────────────────────

const VIDEO_TO_VIDEO_MODELS = {
  'kling-v2v-edit': {
    falModelId: 'fal-ai/kling-video/o3/pro/video-to-video/edit',
    label: 'Kling O3 — Edit',
    supportsSeed: true,
    buildInput(params) {
      const input = { prompt: params.prompt, video_url: params.videoUrl };
      if (params.images && params.images.length > 0)
        input.images = params.images.map(url => ({ image_url: url }));
      if (params.elements && params.elements.length > 0)
        input.elements = params.elements.map(urls => ({ image_urls: urls }));
      return input;
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL: ' + JSON.stringify(result));
    },
    outputExtension: 'mp4',
  },

  'kling-v2v-reference': {
    falModelId: 'fal-ai/kling-video/o3/standard/reference-to-video',
    label: 'Kling O3 — Reference',
    supportsSeed: true,
    buildInput(params) {
      const input = { prompt: params.prompt, reference_video_url: params.videoUrl };
      if (params.images && params.images.length > 0)
        input.images = params.images.map(url => ({ image_url: url }));
      if (params.elements && params.elements.length > 0)
        input.elements = params.elements.map(urls => ({ image_urls: urls }));
      return input;
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL: ' + JSON.stringify(result));
    },
    outputExtension: 'mp4',
  },

  'happy-horse-v2v': {
    falModelId: 'alibaba/happy-horse/video-edit',
    label: 'Happy Horse',
    supportsSeed: true,
    resolutions: ['480p', '720p', '1080p'],
    buildInput(params) {
      return {
        prompt: params.prompt,
        video_url: params.videoUrl,
      };
    },
    extractOutputUrl(result) {
      if (result.video && result.video.url) return result.video.url;
      if (result.url) return result.url;
      throw new Error('Could not extract video URL: ' + JSON.stringify(result));
    },
    outputExtension: 'mp4',
  },
};

function getEditImageModel(key) {
  const m = EDIT_IMAGE_MODELS[key];
  if (!m) throw new Error(`Unknown image model: "${key}". Available: ${Object.keys(EDIT_IMAGE_MODELS).join(', ')}`);
  return m;
}

function getImageToVideoModel(key) {
  const m = IMAGE_TO_VIDEO_MODELS[key];
  if (!m) throw new Error(`Unknown image-to-video model: "${key}". Available: ${Object.keys(IMAGE_TO_VIDEO_MODELS).join(', ')}`);
  return m;
}

function getVideoToVideoModel(key) {
  const m = VIDEO_TO_VIDEO_MODELS[key];
  if (!m) throw new Error(`Unknown v2v model: "${key}". Available: ${Object.keys(VIDEO_TO_VIDEO_MODELS).join(', ')}`);
  return m;
}

module.exports = {
  EDIT_IMAGE_MODELS,
  IMAGE_TO_VIDEO_MODELS,
  VIDEO_TO_VIDEO_MODELS,
  getEditImageModel,
  getImageToVideoModel,
  getVideoToVideoModel,
  aspectRatioToSize,
  aspectRatioToPreset,
};
