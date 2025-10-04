// backend/modules/hillClimbHandler.js
import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const FLUX_API_KEY = process.env.FLUX_API_KEY;

// --- Internal Helper Functions (Full implementations) ---
function _clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

async function _uploadToSupabaseStorage(imageBuffer, fileName, userId, folder = '', contentType = 'image/png') {
    const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(filePath, imageBuffer, { contentType, upsert: false });
    if (error) throw new Error(`Failed to upload image to storage: ${error.message}`);
    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    if (!pub?.publicUrl) throw new Error('Failed to get public URL for uploaded image.');
    return pub.publicUrl;
}

async function _applyWatermark(imageBuffer) {
    try {
        const watermarkText = 'SkinTip.AI';
        const watermarkSvg = `<svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg"><text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" fill-opacity="0.5">${watermarkText}</text></svg>`;
        const svgBuffer = Buffer.from(watermarkSvg);
        const metadata = await sharp(imageBuffer).metadata();
        const left = Math.max(0, metadata.width - 200 - 15);
        const top = Math.max(0, metadata.height - 30 - 15);
        return await sharp(imageBuffer).composite([{ input: svgBuffer, top, left, blend: 'over' }]).png().toBuffer();
    } catch (error) {
        console.error('Error applying watermark:', error);
        return imageBuffer;
    }
}

async function _removeImageBackground(imageBuffer) {
    if (!REMOVE_BG_API_KEY) {
        return sharp(imageBuffer).png().toBuffer();
    }
    const formData = new FormData();
    formData.append('image_file', imageBuffer, 'tattoo_design.png');
    formData.append('size', 'auto');
    formData.append('format', 'png');
    const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
        headers: { 'X-Api-Key': REMOVE_BG_API_KEY, ...formData.getHeaders() },
        responseType: 'arraybuffer'
    });
    return Buffer.from(response.data);
}

async function _analyzeTattooAlpha(pngBuffer) {
  const img = sharp(pngBuffer).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width | 0, h = meta.height | 0;
  if (!w || !h) return { coverage: 0, isThinLine: false };

  let area = 0;
  const alpha = await img.extractChannel('alpha').raw().toBuffer();
  for (let i = 0; i < w * h; i++) {
      if (alpha[i] > 128) area++;
  }
  const coverage = area / (w * h);
  const isThinLine = (coverage < 0.12);
  return { coverage, isThinLine };
}

function _chooseAdaptiveScale(stats) {
  const cov = stats.coverage;
  const isThinLine = stats.isThinLine;
  let scale = 1.0;
  if (isThinLine) {
    const boost = _clamp(1.20 + (0.12 - cov) * 2.5, 1.20, 1.50);
    scale = boost;
  } else {
    scale = 1.05;
  }
  return { scale };
}

function _pickEngine(baseEngine, adaptiveEnabled, isThinLine) {
  if (!adaptiveEnabled) return baseEngine;
  return isThinLine ? 'fill' : baseEngine;
}

function _getMaskBBox(buf, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1, found = false;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (buf[y * w + x] > 0) {
                found = true;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    return found ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, isEmpty: false } : { isEmpty: true };
}

async function _dilateGrayMaskToPng(grayRawBuffer, w, h, growPx) {
    const r = _clamp(growPx, 1, 64);
    const k = 2 * r + 1;
    const kernel = { width: k, height: k, kernel: new Array(k * k).fill(1) };
    return sharp(grayRawBuffer, { raw: { width: w, height: h, channels: 1 } }).convolve(kernel).threshold(1).toColourspace('b-w').png().toBuffer();
}

async function _bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvasPNG, settings) {
    const base = sharp(skinImageBuffer).ensureAlpha().toColourspace('srgb');
    const tattooPrep = await sharp(positionedCanvasPNG).ensureAlpha().toColourspace('srgb')
        .modulate({ saturation: 0.15, brightness: settings.bakeTuning.brightness })
        .gamma(settings.bakeTuning.gamma).png().toBuffer();
    return base.composite([
        { input: tattooPrep, blend: 'overlay', opacity: settings.bakeTuning.overlayOpacity },
        { input: tattooPrep, blend: 'soft-light', opacity: settings.bakeTuning.softlightOpacity },
        { input: tattooPrep, blend: 'multiply', opacity: settings.bakeTuning.multiplyOpacity }
    ]).png().toBuffer();
}

// --- Generation Engine ---
async function _generateSingleImage(skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, fluxApiKey, settings) {
    const tattooDesignOriginalBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooDesignPng = await _removeImageBackground(tattooDesignOriginalBuffer);

    const stats = await _analyzeTattooAlpha(tattooDesignPng);
    const baseEngine = settings.behaviorFlags.fluxEngineDefault;
    const { scale: adaptScale } = _chooseAdaptiveScale(stats);
    const engine = _pickEngine(baseEngine, settings.behaviorFlags.adaptiveEngineEnabled, stats.isThinLine);
    const ENGINE_SIZE_BIAS = engine === 'kontext' ? settings.engineSizeBias.kontext : settings.engineSizeBias.fill;
    const EFFECTIVE_SCALE = (settings.tattooScale || 1.0) * settings.behaviorFlags.globalScaleUp * adaptScale * ENGINE_SIZE_BIAS;

    const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
    const maskMeta = await sharp(originalMaskBuffer).metadata();
    const maskGrayRaw = await sharp(originalMaskBuffer).grayscale().raw().toBuffer();
    const maskBBox = _getMaskBBox(maskGrayRaw, maskMeta.width, maskMeta.height);
    if (maskBBox.isEmpty) throw new Error('Mask area is empty.');

    const growPx = _clamp(
      Math.round(settings.maskGrow.pct * Math.max(maskBBox.width, maskBBox.height)),
      settings.maskGrow.min,
      settings.maskGrow.max
    );
    const grownMaskPng = await _dilateGrayMaskToPng(maskGrayRaw, maskMeta.width, maskMeta.height, growPx);

    const targetW = Math.round(maskBBox.width * EFFECTIVE_SCALE);
    const targetH = Math.round(maskBBox.height * EFFECTIVE_SCALE);
    const resizedTattoo = await sharp(tattooDesignPng)
      .resize({ width: targetW, height: targetH, fit: sharp.fit.inside, withoutEnlargement: false })
      .toBuffer();
    const rotatedTattoo = await sharp(resizedTattoo)
      .rotate(settings.tattooAngle || 0, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const rotMeta = await sharp(rotatedTattoo).metadata();

    const centeredLeft = maskBBox.minX + (maskBBox.width - targetW) / 2;
    const centeredTop = maskBBox.minY + (maskBBox.height - targetH) / 2;
    const placementLeft = Math.round(centeredLeft - (rotMeta.width - targetW) / 2);
    const placementTop = Math.round(centeredTop - (rotMeta.height - targetH) / 2);

    const skinMeta = await sharp(skinImageBuffer).metadata();
    const positionedCanvas = await sharp({
      create: { width: skinMeta.width, height: skinMeta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([{ input: rotatedTattoo, left: placementLeft, top: placementTop }])
      .png()
      .toBuffer();

    const guideComposite = await _bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvas, settings);

    const basePrompt = settings.prompt;
    const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
    const endpoint = engine === 'fill' ? 'https://api.bfl.ai/v1/flux-fill' : 'https://api.bfl.ai/v1/flux-kontext-pro';
    const inputBase64 = guideComposite.toString('base64');
    const maskB64 = Buffer.from(grownMaskPng).toString('base64');

    const seed = Date.now();
    const payload = engine === 'fill'
      ? { prompt: basePrompt, input_image: inputBase64, mask_image: maskB64, output_format: 'png', n: 1, guidance_scale: 8.0, prompt_upsampling: true, safety_tolerance: 2, seed }
      : { prompt: basePrompt, input_image: inputBase64, mask_image: maskB64, output_format: 'png', n: 1, fidelity: 0.8, guidance_scale: 8.0, prompt_upsampling: true, safety_tolerance: 2, seed };

    let task;
    try {
      const res = await axios.post(endpoint, payload, { headers: fluxHeaders, timeout: 90000 });
      task = res.data;
    } catch (e) {
      console.error('FLUX post failed:', e.response?.data || e.message);
      return null;
    }

    if (!task?.polling_url) {
      console.warn(`HILL_CLIMB_LOG: FLUX job submission failed for user ${userId}. Reason: Polling URL was not returned.`, { task });
      return null;
    }

    let attempts = 0, done = false;
    while (!done && attempts < 60) {
      attempts++;
      await new Promise(r => setTimeout(r, 2000));
      try {
        const poll = await axios.get(task.polling_url, { headers: { 'x-key': fluxApiKey }, timeout: 15000 });
        const data = poll.data;

        if (data.status === 'Ready') {
          const url = data.result?.sample;
          if (!url) {
            console.warn(`HILL_CLIMB_LOG: FLUX job ready but no sample URL found for user ${userId}.`, { result: data.result });
            done = true; // Exit loop, will return null
            break;
          }
          const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
          const buf = Buffer.from(imgRes.data);
          const watermarked = await _applyWatermark(buf);
          const fileName = `tattoo-${uuidv4()}.png`;
          const publicUrl = await _uploadToSupabaseStorage(watermarked, fileName, userId, 'hill_climb_results');
          return publicUrl;
        } else if (data.status === 'Error' || data.status === 'Content Moderated') {
          console.warn(`HILL_CLIMB_LOG: FLUX polling failed for user ${userId}. Status: ${data.status}. Details: ${data.details || 'N/A'}`);
          done = true; // Exit loop, will return null
        }
        // If status is 'Processing' or similar, just continue the loop
      } catch (pollError) {
        console.warn(`HILL_CLIMB_LOG: Error during FLUX polling for user ${userId}. Attempt ${attempts}.`, pollError.message);
        // Continue polling until timeout
      }
    }

    if (!done) {
        console.warn(`HILL_CLIMB_LOG: FLUX polling timed out after ${attempts} attempts for user ${userId}.`);
    }
    return null;
}

const hillClimbHandler = {
  generateHillClimbVariations: async function (skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, fluxApiKey, baseParams, activeGroup, paramIndex) {
    const paramGroups = {
      'Core Blend & Appearance': ['bakeTuning.brightness', 'bakeTuning.gamma', 'bakeTuning.overlayOpacity', 'bakeTuning.softlightOpacity', 'bakeTuning.multiplyOpacity'],
      'Sizing & Scaling': ['behaviorFlags.globalScaleUp', 'engineSizeBias.kontext', 'engineSizeBias.fill']
    };

    const stepSizes = {
      'bakeTuning.brightness': 0.05,
      'bakeTuning.gamma': 0.05,
      'bakeTuning.overlayOpacity': 0.05,
      'bakeTuning.softlightOpacity': 0.05,
      'bakeTuning.multiplyOpacity': 0.02,
      'behaviorFlags.globalScaleUp': 0.05,
      'engineSizeBias.kontext': 0.02,
      'engineSizeBias.fill': 0.02
    };

    const paramsToVary = paramGroups[activeGroup];
    if (!paramsToVary) {
      throw new Error(`Invalid parameter group: ${activeGroup}`);
    }

    const paramToVary = paramsToVary[paramIndex];
    const [mainKey, subKey] = paramToVary.split('.');

    const variations = [
      { label: 'no change', params: JSON.parse(JSON.stringify(baseParams)) },
      { label: `${paramToVary} +`, params: JSON.parse(JSON.stringify(baseParams)) },
      { label: `${paramToVary} -`, params: JSON.parse(JSON.stringify(baseParams)) }
    ];

    variations[1].params[mainKey][subKey] += stepSizes[paramToVary];
    variations[2].params[mainKey][subKey] -= stepSizes[paramToVary];

    const promises = variations.map(v =>
        _generateSingleImage(
            skinImageBuffer,
            tattooDesignImageBase64,
            maskBase64,
            userId,
            fluxApiKey,
            v.params
        )
    );

    const results = await Promise.all(promises);

    return results.map((url, i) => ({
        label: variations[i].label,
        imageUrl: url,
        params: variations[i].params
    }));
  }
};

export default hillClimbHandler;