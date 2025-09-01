// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-12_ADAPTIVE_SCALE_ENGINE_V2');

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
const ADAPTIVE_SCALE_ENABLED  = (process.env.ADAPTIVE_SCALE_ENABLED  ?? 'true').toLowerCase() === 'true';
const ADAPTIVE_ENGINE_ENABLED = (process.env.ADAPTIVE_ENGINE_ENABLED ?? 'true').toLowerCase() === 'true';
const RESPECT_MASK_SIZE = (process.env.RESPECT_MASK_SIZE ?? 'false').toLowerCase() === 'true';
const GLOBAL_SCALE_UP         = Number(process.env.MODEL_SCALE_UP   || '1.00'); // optional global bump
const FLUX_SHRINK_FIX         = Number(process.env.FLUX_SHRINK_FIX  || '1.12'); // <— new: corrects consistent FLUX downsizing
const FLUX_ENGINE_DEFAULT     = (process.env.FLUX_ENGINE || 'kontext').toLowerCase(); // 'kontext' | 'fill'

// -----------------------------
// Small helpers
// -----------------------------
// Weighted mask from placed tattoo alpha
async function buildWeightedMaskFromPositioned(positionedCanvasPNG) {
  const meta = await sharp(positionedCanvasPNG).metadata();
  const w = meta.width, h = meta.height;

  const alpha = await sharp(positionedCanvasPNG).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const hard = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).threshold(1).raw().toBuffer();

  const dilated = await sharp(hard, { raw: { width: w, height: h, channels: 1 } }).blur(1.6).threshold(1).raw().toBuffer();

  const eroded  = await sharp(hard, { raw: { width: w, height: h, channels:1 } }).morphology('erode', { width: 3, height: 3, data: [1,1,1,1,1,1,1,1,1] }).raw().toBuffer();

  const N = w * h;
  const ring   = Buffer.alloc(N);
  const inside = Buffer.alloc(N);
  for (let i = 0; i < N; i++) {
    const r = Math.max(0, dilated[i] - eroded[i]); // edge band
    ring[i]   = r ? 255 : 0;   // full strength at edges
    inside[i] = eroded[i] ? 96 : 0; // soft interior (~38%)
  }
  const weighted = Buffer.alloc(N);
  for (let i = 0; i < N; i++) weighted[i] = Math.max(ring[i], inside[i]);

  return {
    weightedMaskPNG: await sharp(weighted, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(),
    edgeRingPNG:     await sharp(ring,     { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(),
    hardSilPNG:      await sharp(eroded,   { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(),
    w, h
  };
}

// Bake an “already inked” guide (multiply + soft-light)
// FIX: keep both layers in sRGB with alpha; desaturate instead of converting to "b-w"
async function bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvasPNG) {
  const base = sharp(skinImageBuffer).ensureAlpha().toColourspace('srgb');

  const tattooGray = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .toColourspace('srgb')           // stay in sRGB to avoid srgb→rgb route errors
    .modulate({ saturation: 0, brightness: 0.32 }) // grayscale look without b-w conversion
    .png()
    .toBuffer();

  return base
    .composite([
      { input: tattooGray, blend: 'multiply',   opacity: 0.9 },
      { input: tattooGray, blend: 'soft-light', opacity: 0.35 }
    ])
    .png()
    .toBuffer();
}

// Clamp FLUX result back to original silhouette + subtle edge restore
async function clampToSilhouette(fluxPNG, hardSilPNG, edgeRingPNG) {
  const clamped = await sharp(fluxPNG)
    .composite([{ input: hardSilPNG, blend: 'dest-in' }])
    .png().toBuffer();
  return sharp(clamped)
    .composite([{ input: edgeRingPNG, blend: 'multiply', opacity: 0.15 }])
    .png().toBuffer();
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

async function uploadDebug(imageBuffer, userId, name, contentType = 'image/png', folder = 'debug') {
  try {
    const fileName = `${name}_${uuidv4()}.${contentType.startsWith('image/png') ? 'png' : 'jpg'}`;
    const filePath = `${userId}/${folder}/${fileName}`;
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
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
  const lowVar    = (std[0] < 3.5 && std[1] < 3.5 && std[2] < 3.5);

  return { isUniformWhite: nearWhite && lowVar, bgColor: mean };
}

async function colorToAlphaWhite(buffer) {
  // Gentle white→alpha with decontamination
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
  // returns { coverage, thinness, solidity, bbox, width, height }
  const img = sharp(pngBuffer).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width | 0, h = meta.height | 0;

  const alpha = await img.extractChannel('alpha').raw().toBuffer(); // 1 ch
  const N = w * h;

  // Binary mask (alpha > 128)
  const mask = new Uint8Array(N);
  let area = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < N; i++) {
    const v = alpha[i] > 128 ? 1 : 0;
    mask[i] = v;
    if (v) {
      area++;
      const y = (i / w) | 0, x = i - y * w;
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

  // Thinness proxy: average absolute gradient of alpha within bbox
  let gradAcc = 0, gradCount = 0;
  for (let y = minY + 1; y < maxY; y++) {
    let row = y * w;
    for (let x = minX + 1; x < maxX; x++) {
      const i = row + x;
      gradAcc += Math.abs(alpha[i] - alpha[i - 1]) + Math.abs(alpha[i] - alpha[i - w]);
      gradCount += 2;
    }
  }
  const thinness = gradCount ? (gradAcc / (gradCount * 255)) : 0;

  return {
    coverage, thinness, solidity,
    bbox: { minX, minY, maxX, maxY, w: bboxW, h: bboxH },
    width: w, height: h
  };
}

function chooseAdaptiveScale(stats) {
  // thresholds tuned conservatively (so global FLUX_SHRINK_FIX does most of the work)
  const cov = stats.coverage;   // 0..1
  const thn = stats.thinness;   // 0..1 (higher → thinner lines)
  const sol = stats.solidity;   // area/bboxArea

  const isThinLine     = (cov < 0.12 && thn > 0.10);
  const hasHaloSplash  = (sol < 0.55);

  let scale = 1.00;

  if (isThinLine && !hasHaloSplash) {
    // was 1.20–1.50; soften because we apply FLUX_SHRINK_FIX globally
    const boost = clamp(1.12 + (0.12 - cov) * 2.0, 1.12, 1.40);
    scale = boost;
  } else if (hasHaloSplash) {
    scale = 1.00;
  } else {
    scale = 1.02;
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
    if (!REMOVE_BG_API_KEY) {
      try {
        // Always try to convert white to alpha as a fallback
        console.log('[BG] No API key. Attempting local white-to-alpha conversion.');
        return await colorToAlphaWhite(imageBuffer);
      } catch (e) {
        console.warn('[BG] local white-to-alpha conversion failed, passing-through:', e.message);
        return await sharp(imageBuffer).png().toBuffer();
      }
    }

    try {
      const formData = new FormData();
      formData.append('image_file', new Blob([imageBuffer], { type: 'image/png' }), 'tattoo_design.png');
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
        // As a final fallback, still try the local conversion
        console.log('[BG] remove.bg failed. Attempting local white-to-alpha conversion.');
        return await colorToAlphaWhite(imageBuffer);
      } catch (e) {
        console.warn('[BG] Final fallback failed. Passing through as PNG.', e.message);
        return await sharp(imageBuffer).png().toBuffer();
      }
    }
  },

  applyWatermark: async (imageBuffer) => {
    try {
      const watermarkText = 'SkinTip.AI';
      const watermarkSvg = `<svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
        <text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" fill-opacity="0.5">${watermarkText}</text>
      </svg>`;
      const svgBuffer = Buffer.from(watermarkSvg);

      const metadata = await sharp(imageBuffer).metadata();
      const imageWidth = metadata.width;
      const imageHeight = metadata.height;

      const svgWidth = 200;
      const svgHeight = 30;
      const padding = 15;

      const left = Math.max(0, imageWidth - svgWidth - padding);
      const top  = Math.max(0, imageHeight - svgHeight - padding);

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
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
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

  placeTattooOnSkin: async function(skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, numVariations, fluxApiKey, tattooAngle = 0, tattooScale = 1.0) {
    const tattooDesignOriginalBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooDesignPng = await this.removeImageBackground(tattooDesignOriginalBuffer);

    const stats = await analyzeTattooAlpha(tattooDesignPng);
    const { scale: adaptScale, isThinLine } = ADAPTIVE_SCALE_ENABLED ? chooseAdaptiveScale(stats) : { scale: 1.0, isThinLine: false };

    const LOCK_SILHOUETTE = (process.env.LOCK_SILHOUETTE ?? 'false').toLowerCase() === 'true';
    // const engine = LOCK_SILHOUETTE ? 'fill' : pickEngine(FLUX_ENGINE_DEFAULT, ADAPTIVE_ENGINE_ENABLED, isThinLine);
    const engine = 'fill'; // [CHANGED] Hard-lock to masked inpainting
    const EFFECTIVE_SCALE = tattooScale * GLOBAL_SCALE_UP * FLUX_SHRINK_FIX * adaptScale;

    const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
    const maskMeta = await sharp(originalMaskBuffer).metadata();
    const maskGrayRaw = await sharp(originalMaskBuffer).grayscale().raw().toBuffer();

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

    const targetW = Math.round(maskBBox.width * EFFECTIVE_SCALE);
    const targetH = Math.round(maskBBox.height * EFFECTIVE_SCALE);

    const resizedTattoo = await sharp(tattooDesignPng).resize({ width: targetW, height: targetH, fit: 'inside', withoutEnlargement: false }).toBuffer();
    const rotatedTattoo = await sharp(resizedTattoo).rotate(tattooAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    const rotMeta = await sharp(rotatedTattoo).metadata();

    const centeredLeft = maskBBox.minX + (maskBBox.width - targetW) / 2;
    const centeredTop = maskBBox.minY + (maskBBox.height - targetH) / 2;
    const placementLeft = Math.round(centeredLeft - (rotMeta.width - targetW) / 2);
    const placementTop = Math.round(centeredTop - (rotMeta.height - targetH) / 2);

    const skinMeta = await sharp(skinImageBuffer).metadata();
    const positionedCanvas = await sharp({ create: { width: skinMeta.width, height: skinMeta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: rotatedTattoo, left: placementLeft, top: placementTop }])
      .png().toBuffer();

   // Build realism guide + weighted mask so FLUX preserves geometry
const generatedImageUrls = [];

const { weightedMaskPNG, edgeRingPNG, hardSilPNG } =
  await buildWeightedMaskFromPositioned(positionedCanvas);
await uploadDebug(weightedMaskPNG, userId, 'mask_weighted');
await uploadDebug(edgeRingPNG,     userId, 'mask_edge_ring');
await uploadDebug(hardSilPNG,      userId, 'mask_hard_silhouette');

const guideComposite = await bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvas);
await uploadDebug(guideComposite, userId, 'guide_baked');

// Prompting tuned for “keep pixels, add realism only”
const prompt =
  'Keep the tattoo’s exact geometry and proportions pixel-perfect. Only add realistic under-skin ink diffusion, subtle micro-bleed, lighting and skin texture. No restyle, no resize, no new elements.';
const negative =
  'no redraw, no restyle, no resizing, no thicker lines, no thinner lines, no ornaments, no extra text, no new colors';

const headers = {
  'Content-Type': 'application/json',
  'x-key': fluxApiKey || FLUX_API_KEY,
  'Authorization': `Bearer ${fluxApiKey || FLUX_API_KEY}`
};

// Prefer KONText (img2img with fidelity); fall back to fill
const imgB64  = guideComposite.toString('base64');
const maskB64 = weightedMaskPNG.toString('base64');

for (let i = 0; i < numVariations; i++) {
  const seed = Date.now() + i;

  // Try KONText first
  const kontextPayload = {
    prompt,
    negative_prompt: negative,
    image: imgB64,
    mask: maskB64,
    output_format: 'png',
    fidelity: 0.99,
    guidance_scale: 5.0,
    strength: 0.25,
    prompt_upsampling: true,
    safety_tolerance: 2,
    seed
  };

  let task = null;
  try {
    task = (await axios.post('https://api.bfl.ai/v1/flux/kontext-pro', kontextPayload, { headers, timeout: 90000 })).data;
  } catch (e1) {
    try {
      task = (await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', kontextPayload, { headers, timeout: 90000 })).data;
    } catch (e2) {
      // fall through to fill
    }
  }

  // Fallback to fill with LOW guidance (so it won’t redraw)
  if (!task) {
    const fillPayload = {
      prompt,
      negative_prompt: negative,
      image: imgB64,
      mask: maskB64,
      output_format: 'png',
      steps: 28,
      guidance: 5,
      safety_tolerance: 2,
      seed
    };
    try {
      task = (await axios.post('https://api.bfl.ai/v1/flux/fill', fillPayload, { headers, timeout: 90000 })).data;
    } catch (e3) {
      try {
        task = (await axios.post('https://api.bfl.ai/v1/flux-fill', fillPayload, { headers, timeout: 90000 })).data;
      } catch (e4) {
        try {
          task = (await axios.post('https://api.bfl.ai/v1/flux-pro-1.0-fill', fillPayload, { headers, timeout: 90000 })).data;
        } catch (e5) {
          // no-op; task stays null
        }
      }
    }
  }
  if (!task) continue;

  // Get the image (direct or by polling)
  let fluxBuf = null;
  if (task.result?.sample) {
    const imgRes = await axios.get(task.result.sample, { responseType: 'arraybuffer' });
    fluxBuf = Buffer.from(imgRes.data);
  } else if (task.polling_url) {
    for (let tries = 0; tries < 60 && !fluxBuf; tries++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await axios.get(task.polling_url, { headers, timeout: 15000 });
      if (poll.data.status === 'Ready' && poll.data.result?.sample) {
        const imgRes = await axios.get(poll.data.result.sample, { responseType: 'arraybuffer' });
        fluxBuf = Buffer.from(imgRes.data);
        break;
      }
      if (poll.data.status === 'Error' || poll.data.status === 'Content Moderated') break;
    }
  }
  if (!fluxBuf) continue;

  // Final safety net: clamp back to your original silhouette
  const clamped = await clampToSilhouette(fluxBuf, hardSilPNG, edgeRingPNG);

  // Watermark + upload
  const watermarked = await this.applyWatermark(clamped);
  const fileName = `tattoo-${uuidv4()}.png`;
  const publicUrl = await this.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
  generatedImageUrls.push(publicUrl);
}

    if (generatedImageUrls.length === 0) throw new Error('Flux API: No images were generated.');
    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
