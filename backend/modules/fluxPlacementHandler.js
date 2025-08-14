// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-11_ADAPTIVE_SCALE_ENGINE_V2');

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

// -----------------------------
// Supabase setup
// -----------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// -----------------------------
// External API keys
// -----------------------------
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const FLUX_API_KEY = process.env.FLUX_API_KEY;

// -----------------------------
// Behavior flags
// -----------------------------
const ADAPTIVE_SCALE_ENABLED = (process.env.ADAPTIVE_SCALE_ENABLED ?? 'true').toLowerCase() === 'true';
const ADAPTIVE_ENGINE_ENABLED = (process.env.ADAPTIVE_ENGINE_ENABLED ?? 'true').toLowerCase() === 'true';

// Site-wide multiplier you already had
const GLOBAL_SCALE_UP = Number(process.env.MODEL_SCALE_UP || '1.0');

// Engine selection default
const FLUX_ENGINE_DEFAULT = (process.env.FLUX_ENGINE || 'kontext').toLowerCase(); // 'kontext' | 'fill'

// New: small calibration multipliers per engine to counter FLUX’s consistent shrink.
const ENGINE_CAL_BIAS_KONTEXT = Number(process.env.ENGINE_CAL_BIAS_KONTEXT || '1.08');
const ENGINE_CAL_BIAS_FILL    = Number(process.env.ENGINE_CAL_BIAS_FILL    || '1.02');

// -----------------------------
// Small helpers
// -----------------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

async function uploadDebug(imageBuffer, userId, name, contentType = 'image/png', folder = 'debug') {
  try {
    const fileName = `${name}_${uuidv4()}.${contentType.startsWith('image/png') ? 'png' : 'jpg'}`;
    const filePath = `${userId}/${folder}/${fileName}`;
    const { error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(filePath, imageBuffer, { contentType, upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    console.log('[UPLOAD] final URL for client:', pub.publicUrl);
    console.log(`[DEBUG_UPLOAD] ${fileName} => ${pub.publicUrl}`);
    return pub.publicUrl;
  } catch (e) {
    console.warn('[DEBUG_UPLOAD] failed:', e.message);
    return null;
  }
}

// -----------------------------
// Background removal
// -----------------------------
async function detectUniformWhiteBackground(pngBuffer) {
  const meta = await sharp(pngBuffer).metadata();
  const w = meta.width | 0, h = meta.height | 0;
  if (!w || !h) return { isUniformWhite: false, bgColor: [255, 255, 255] };

  let patch = Math.floor(Math.min(w, h) * 0.05);
  patch = Math.max(2, Math.min(patch, w, h));

  async function stats(left, top) {
    const l = Math.max(0, Math.min(left,  w - patch));
    const t = Math.max(0, Math.min(top,   h - patch));
    const buf = await sharp(pngBuffer)
      .extract({ left: l, top: t, width: patch, height: patch })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const n = patch * patch;
    let r = 0, g = 0, b = 0, rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < n; i++) {
      const R = buf[i * 4 + 0], G = buf[i * 4 + 1], B = buf[i * 4 + 2];
      r += R; g += G; b += B;
      rr += R * R; gg += G * G; bb += B * B;
    }
    const mean = [r / n, g / n, b / n];
    const std = [
      Math.sqrt(rr / n - mean[0] * mean[0]),
      Math.sqrt(gg / n - mean[1] * mean[1]),
      Math.sqrt(bb / n - mean[2] * mean[2]),
    ];
    return { mean, std };
  }

  const s1 = await stats(0, 0);
  const s2 = await stats(w - patch, 0);
  const s3 = await stats(0, h - patch);
  const s4 = await stats(w - patch, h - patch);

  const mean = [
    (s1.mean[0] + s2.mean[0] + s3.mean[0] + s4.mean[0]) / 4,
    (s1.mean[1] + s2.mean[1] + s3.mean[1] + s4.mean[1]) / 4,
    (s1.mean[2] + s2.mean[2] + s3.mean[2] + s4.mean[2]) / 4,
  ];
  const std = [
    (s1.std[0] + s2.std[0] + s3.std[0] + s4.std[0]) / 4,
    (s1.std[1] + s2.std[1] + s3.std[1] + s4.std[1]) / 4,
    (s1.std[2] + s2.std[2] + s3.std[2] + s4.std[2]) / 4,
  ];

  const nearWhite = (mean[0] >= 242 && mean[1] >= 242 && mean[2] >= 242);
  const lowVar = (std[0] < 3.5 && std[1] < 3.5 && std[2] < 3.5);

  return { isUniformWhite: nearWhite && lowVar, bgColor: mean };
}

async function colorToAlphaWhite(buffer) {
  // soft white→alpha + simple decontamination
  const img = sharp(buffer).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const raw = await img.raw().toBuffer();

  const soft = 235, hard = 252;
  const ramp = Math.max(1, hard - soft);

  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const R = raw[p], G = raw[p + 1], B = raw[p + 2], A = raw[p + 3];
    const wmax = Math.max(R, G, B);
    let alpha = A;
    if (wmax >= soft) {
      const cut = Math.max(0, Math.min(1, (wmax - soft) / ramp));
      alpha = Math.round(A * (1 - cut));
      if (wmax >= hard) alpha = 0;
    }
    if (alpha > 0 && alpha < 255) {
      const a = alpha / 255;
      raw[p]   = clamp(Math.round((R - (1 - a) * 255) / a), 0, 255);
      raw[p+1] = clamp(Math.round((G - (1 - a) * 255) / a), 0, 255);
      raw[p+2] = clamp(Math.round((B - (1 - a) * 255) / a), 0, 255);
    }
    raw[p + 3] = alpha;
  }

  return await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// -----------------------------
// Adaptive analysis on tattoo alpha
// -----------------------------
async function analyzeTattooAlpha(pngBuffer) {
  const img = sharp(pngBuffer).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width | 0, h = meta.height | 0;

  const alpha = await img.extractChannel('alpha').raw().toBuffer(); // 1 channel
  const N = w * h;

  let area = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < N; i++) {
    const v = alpha[i] > 128 ? 1 : 0;
    if (v) {
      area++;
      const y = (i / w) | 0;
      const x = i - y * w;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (area === 0) {
    return { coverage: 0, thinness: 0, solidity: 0, bbox: null, width: w, height: h };
  }

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bboxArea = bboxW * bboxH;
  const coverage = area / N;
  const solidity = bboxArea > 0 ? area / bboxArea : 0;

  // Thinness proxy via simple alpha gradients inside bbox
  let gradAcc = 0, gradCount = 0;
  for (let y = minY + 1; y < maxY; y++) {
    const row = y * w;
    for (let x = minX + 1; x < maxX; x++) {
      const i = row + x;
      const gx = Math.abs(alpha[i] - alpha[i - 1]);
      const gy = Math.abs(alpha[i] - alpha[i - w]);
      gradAcc += gx + gy;
      gradCount += 2;
    }
  }
  const thinness = gradCount ? (gradAcc / (gradCount * 255)) : 0;

  return {
    coverage,
    thinness,
    solidity,
    bbox: { minX, minY, maxX, maxY, w: bboxW, h: bboxH },
    width: w,
    height: h
  };
}

function chooseAdaptiveScale(stats) {
  const cov = stats.coverage;
  const thn = stats.thinness;
  const sol = stats.solidity;

  const isThinLine = (cov < 0.12 && thn > 0.10);
  const hasHaloSplash = (sol < 0.55);

  let scale = 1.0;
  if (isThinLine && !hasHaloSplash) {
    const boost = clamp(1.18 + (0.10 - cov) * 2.2, 1.18, 1.38);
    scale = boost;
  } else if (hasHaloSplash) {
    scale = 1.0;
  } else {
    scale = 1.00;
  }

  return { scale, isThinLine, hasHaloSplash };
}

function pickEngine(baseEngine, adaptiveEnabled, isThinLine) {
  if (!adaptiveEnabled) return baseEngine;
  return isThinLine ? 'fill' : baseEngine;
}

// -----------------------------
// Public module
// -----------------------------
const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    // 1) local white->alpha if uniform white and no key
    if (!REMOVE_BG_API_KEY) {
      try {
        const { isUniformWhite } = await detectUniformWhiteBackground(imageBuffer);
        if (isUniformWhite) {
          console.log('[BG] Uniform white detected → converting to alpha locally.');
          return await colorToAlphaWhite(imageBuffer);
        }
      } catch (e) {
        console.warn('[BG] local white→alpha probe failed, pass-through:', e.message);
      }
      return await sharp(imageBuffer).png().toBuffer();
    }

    // 2) remove.bg then fallback to local/passthrough
    try {
      const formData = new FormData();
      // Node 22 has global Blob; if not, form-data can accept Buffers as well.
      formData.append('image_file', Buffer.from(imageBuffer), {
        filename: 'tattoo_design.png',
        contentType: 'image/png'
      });
      formData.append('size', 'auto');
      formData.append('format', 'png');

      const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
        headers: { 'X-Api-Key': REMOVE_BG_API_KEY, ...formData.getHeaders() },
        responseType: 'arraybuffer'
      });
      if (response.status === 200) return Buffer.from(response.data);
      throw new Error(`remove.bg status ${response.status}`);
    } catch (error) {
      console.warn('[BG] remove.bg failed; fallback to local:', error.message);
      try {
        const { isUniformWhite } = await detectUniformWhiteBackground(imageBuffer);
        if (isUniformWhite) return await colorToAlphaWhite(imageBuffer);
      } catch (e) { /* ignore */ }
      return await sharp(imageBuffer).png().toBuffer();
    }
  },

  applyWatermark: async (imageBuffer) => {
    try {
      const watermarkText = 'SkinTip.AI';
      const watermarkSvg =
        `<svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
           <text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" fill-opacity="0.5">${watermarkText}</text>
         </svg>`;
      const svgBuffer = Buffer.from(watermarkSvg);

      const metadata = await sharp(imageBuffer).metadata();
      const imageWidth = metadata.width || 0;
      const imageHeight = metadata.height || 0;

      const svgWidth = 200;
      const svgHeight = 30;
      const padding = 15;

      const left = Math.max(0, imageWidth - svgWidth - padding);
      const top = Math.max(0, imageHeight - svgHeight - padding);

      return await sharp(imageBuffer)
        .composite([{ input: svgBuffer, top, left, blend: 'over' }])
        .png()
        .toBuffer();
    } catch (error) {
      console.error('Error applying watermark:', error);
      return imageBuffer;
    }
  },

  uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/png') => {
    const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
    const { error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(filePath, imageBuffer, { contentType, upsert: false });
    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error(`Failed to upload image to storage: ${error.message}`);
    }
    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    if (!pub?.publicUrl) throw new Error('Failed to get public URL for uploaded image.');
    console.log('Image uploaded to Supabase:', pub.publicUrl);
    return pub.publicUrl;
  },

  /**
   * Main pipeline
   */
  placeTattooOnSkin: async (
    skinImageBuffer,
    tattooDesignImageBase64,
    maskBase64,
    userId,
    numVariations,
    fluxApiKey,
    tattooAngle = 0,
    tattooScale = 1.0
  ) => {
    // --- Inputs ---
    const tattooDesignOriginalBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooMeta0 = await sharp(tattooDesignOriginalBuffer).metadata();
    console.log(`Input tattoo meta: ${tattooMeta0.width}x${tattooMeta0.height}, fmt=${tattooMeta0.format}`);

    // --- Remove background to ensure alpha ---
    const tattooDesignPng = await fluxPlacementHandler.removeImageBackground(tattooDesignOriginalBuffer);

    // --- Analyze tattoo alpha for adaptive decisions ---
    const stats = await analyzeTattooAlpha(tattooDesignPng);
    console.log(`[ADAPT] coverage=${stats.coverage.toFixed(4)} thinness=${stats.thinness.toFixed(4)} solidity=${stats.solidity.toFixed(4)} bbox=${stats.bbox ? stats.bbox.w+'x'+stats.bbox.h : 'NA'}`);

    // --- Adaptive scale & engine pick ---
    const baseEngine = FLUX_ENGINE_DEFAULT;
    const { scale: adaptScale, isThinLine, hasHaloSplash } =
      ADAPTIVE_SCALE_ENABLED ? chooseAdaptiveScale(stats) : { scale: 1.0, isThinLine: false, hasHaloSplash: false };
    const engine = pickEngine(baseEngine, ADAPTIVE_ENGINE_ENABLED, isThinLine);
    const engineBias = engine === 'fill' ? ENGINE_CAL_BIAS_FILL : ENGINE_CAL_BIAS_KONTEXT;

    // final scale factor used when sizing to mask region
    const EFFECTIVE_SCALE = tattooScale * GLOBAL_SCALE_UP * adaptScale * engineBias;
    console.log(`[ENGINE] chosen=${engine} | GLOBAL_SCALE_UP=${GLOBAL_SCALE_UP} | adaptiveScale=${adaptScale.toFixed(3)} | engineBias=${engineBias.toFixed(3)} | effective=${EFFECTIVE_SCALE.toFixed(3)} | thinLine=${isThinLine} halo=${hasHaloSplash}`);

    // --- Prepare mask ---
    const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
    let maskMeta, maskGrayRaw;
    try {
      maskMeta = await sharp(originalMaskBuffer).metadata();
      maskGrayRaw = await sharp(originalMaskBuffer).grayscale().raw().toBuffer();
      console.log(`Mask meta: ${maskMeta.width}x${maskMeta.height}`);
    } catch (e) {
      throw new Error(`Failed to read mask: ${e.message}`);
    }

    // Compute bounding box of white region in mask (non-zero)
    function getMaskBBox(buf, w, h) {
      let minX = w, minY = h, maxX = -1, maxY = -1, found = false;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          if (buf[row + x] > 0) {
            found = true;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!found) return { isEmpty: true };
      return { isEmpty: false, minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
    const maskBBox = getMaskBBox(maskGrayRaw, maskMeta.width, maskMeta.height);
    if (maskBBox.isEmpty) throw new Error('Mask area is empty.');

    // --- Resize/rotate tattoo to fit mask with effective scale ---
    const targetW = Math.round(maskBBox.width * EFFECTIVE_SCALE);
    const targetH = Math.round(maskBBox.height * EFFECTIVE_SCALE);
    const resizedTattoo = await sharp(tattooDesignPng)
      .resize({ width: targetW, height: targetH, fit: sharp.fit.inside, withoutEnlargement: false })
      .toBuffer();

    const rotatedTattoo = await sharp(resizedTattoo)
      .rotate(tattooAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    const rotMeta = await sharp(rotatedTattoo).metadata();

    const centeredLeft = maskBBox.minX + (maskBBox.width  - targetW) / 2;
    const centeredTop  = maskBBox.minY + (maskBBox.height - targetH) / 2;
    const placementLeft = Math.round(centeredLeft - (rotMeta.width  - targetW) / 2);
    const placementTop  = Math.round(centeredTop  - (rotMeta.height - targetH) / 2);

    // --- Build positioned tattoo canvas (skin-sized transparent), then mask-composite ---
    const skinMeta = await sharp(skinImageBuffer).metadata();

    const positionedCanvas = await sharp({
      create: {
        width: skinMeta.width,
        height: skinMeta.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: rotatedTattoo, left: placementLeft, top: placementTop }])
      .png()
      .toBuffer();

    const compositedForPreview = await sharp(skinImageBuffer)
      .composite([{ input: positionedCanvas, blend: 'over', mask: maskGrayRaw }])
      .png()
      .toBuffer();

    await uploadDebug(originalMaskBuffer, userId, 'mask_original');
    await uploadDebug(positionedCanvas, userId, 'tattoo_canvas_positioned');
    await uploadDebug(compositedForPreview, userId, 'debug_sharp_composite');

    // -----------------------------
    // FLUX call(s)
    // -----------------------------
    const generatedImageUrls = [];
    const basePrompt =
      'Preserve the exact silhouette, linework, proportions and interior details of the tattoo. Only relight and blend the existing tattoo into the skin. Add realistic lighting, micro-shadowing, slight ink diffusion, and subtle skin texture. Do not redraw or restyle.';

    const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey || FLUX_API_KEY };

    const endpoint = engine === 'fill'
      ? 'https://api.bfl.ai/v1/flux-fill'
      : 'https://api.bfl.ai/v1/flux-kontext-pro';

    const inputBase64 = compositedForPreview.toString('base64');
    const maskB64 = maskBase64;

    console.log(`Making ${numVariations} calls to FLUX (${endpoint.split('/').pop()})...`);

    for (let i = 0; i < numVariations; i++) {
      const seed = Date.now() + i;

      const payload = engine === 'fill'
        ? {
            prompt: basePrompt,
            input_image: inputBase64,
            mask_image: maskB64,
            output_format: 'png',
            n: 1,
            guidance_scale: 8.0,
            prompt_upsampling: true,
            safety_tolerance: 2,
            seed
          }
        : {
            prompt: basePrompt,
            input_image: inputBase64,
            mask_image: maskB64,
            output_format: 'png',
            n: 1,
            fidelity: 0.8,
            guidance_scale: 8.0,
            prompt_upsampling: true,
            safety_tolerance: 2,
            seed
          };

      let task;
      try {
        const res = await axios.post(endpoint, payload, { headers: fluxHeaders, timeout: 90000 });
        task = res.data;
        console.log(`DEBUG: FLUX POST status=${res.status} id=${task.id}`);
      } catch (e) {
        console.error('FLUX post failed:', e.response?.data || e.message);
        continue;
      }

      if (!task?.polling_url) {
        console.warn('FLUX: missing polling_url');
        continue;
      }

      let attempts = 0, done = false;
      while (!done && attempts < 60) {
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        const poll = await axios.get(task.polling_url, { headers: { 'x-key': fluxApiKey || FLUX_API_KEY }, timeout: 15000 });
        const data = poll.data;

        if (data.status === 'Ready') {
          const url = data.result?.sample;
          if (!url) { done = true; break; }
          const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
          const buf = Buffer.from(imgRes.data);
          const watermarked = await fluxPlacementHandler.applyWatermark(buf);
          const fileName = `tattoo-${uuidv4()}.png`;
          const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
          generatedImageUrls.push(publicUrl);
          done = true;
        } else if (data.status === 'Error' || data.status === 'Content Moderated') {
          console.warn('FLUX polling end:', data.status, data.details || '');
          done = true;
        }
      }
    }

    if (generatedImageUrls.length === 0) {
      throw new Error('Flux API: No images were generated across all attempts. Please try again.');
    }

    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
