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
const RESPECT_MASK_SIZE       = (process.env.RESPECT_MASK_SIZE       ?? 'false').toLowerCase() === 'true';
const GLOBAL_SCALE_UP         = Number(process.env.MODEL_SCALE_UP   || '1.00'); // optional global bump
const FLUX_SHRINK_FIX         = Number(process.env.FLUX_SHRINK_FIX  || '1.12'); // <— corrects consistent FLUX downsizing
const FLUX_ENGINE_DEFAULT     = (process.env.FLUX_ENGINE || 'kontext').toLowerCase(); // 'kontext' | 'fill'

// -----------------------------
// Small helpers
// -----------------------------
// Weighted mask from placed tattoo alpha
async function buildWeightedMaskFromPositioned(positionedCanvasPNG) {
  const meta = await sharp(positionedCanvasPNG).metadata();
  const w = meta.width, h = meta.height;

  // Alpha → RAW
  const alphaRaw = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer();

  // Hard 0/255
  const hardRaw = Buffer.allocUnsafe(w * h);
  for (let i = 0; i < w * h; i++) hardRaw[i] = alphaRaw[i] > 0 ? 255 : 0;

  // Dilate via blur+threshold
  const hardBinaryPNG = await sharp(hardRaw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const dilatedPNG = await sharp(hardBinaryPNG).blur(1.6).threshold(1).png().toBuffer();
  const dilatedRaw = await sharp(dilatedPNG).raw().toBuffer();

  // Edge ring + weighted
  const ringRaw = Buffer.alloc(w * h);
  const insideRaw = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = Math.max(0, dilatedRaw[i] - hardRaw[i]); // edge band
    ringRaw[i]   = r ? 255 : 0;
    insideRaw[i] = hardRaw[i] ? 96 : 0;
  }
  const weightedRaw = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) weightedRaw[i] = Math.max(ringRaw[i], insideRaw[i]);

  const weightedMaskPNG = await sharp(weightedRaw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const edgeRingPNG     = await sharp(ringRaw,     { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const hardSilPNG      = await sharp(hardRaw,     { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();

  // White = edit
  const hardFluxMaskPNG = await sharp(dilatedPNG).png().toBuffer();
  // Black = edit (invert)
  const invertedFluxMaskPNG = await sharp(hardFluxMaskPNG).negate().png().toBuffer();

  // Alpha-hole (transparent = edit)
  const invAlphaRaw = Buffer.allocUnsafe(w * h);
  for (let i = 0; i < w * h; i++) invAlphaRaw[i] = 255 - hardRaw[i];
  const blackRGB = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  const alphaHoleMaskPNG = await sharp(blackRGB)
    .joinChannel(await sharp(invAlphaRaw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer())
    .png()
    .toBuffer();

  return {
    weightedMaskPNG,
    edgeRingPNG,
    hardSilPNG,
    hardFluxMaskPNG,       // white=edit
    invertedFluxMaskPNG,   // black=edit
    alphaHoleMaskPNG,      // transparent=edit
    w, h
  };
}

// Bake an “already inked” guide (multiply + soft-light)
async function bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvasPNG) {
  const base = sharp(skinImageBuffer).ensureAlpha().toColourspace('srgb');

  const tattooGray = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .toColourspace('srgb')
    .modulate({ saturation: 0, brightness: 0.6 }) // keep light; avoids near-black init
    .png()
    .toBuffer();

  return base
    .composite([
      { input: tattooGray, blend: 'multiply',   opacity: 0.55 },
      { input: tattooGray, blend: 'soft-light', opacity: 0.25 }
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

function clamp255(v) { return Math.max(0, Math.min(255, v|0)); }

async function colorToAlphaWhite(buffer) {
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
      raw[p]   = clamp255(Math.round((R - (1 - a) * 255) / a));
      raw[p+1] = clamp255(Math.round((G - (1 - a) * 255) / a));
      raw[p+2] = clamp255(Math.round((B - (1 - a) * 255) / a));
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

  const alpha = await img.extractChannel('alpha').raw().toBuffer();
  const N = w * h;

  // Binary mask (alpha > 128)
  let area = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < N; i++) {
    const v = alpha[i] > 128 ? 1 : 0;
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
  const cov = stats.coverage;   // 0..1
  const thn = stats.thinness;   // 0..1
  const sol = stats.solidity;   // area/bboxArea

  const isThinLine     = (cov < 0.12 && thn > 0.10);
  const hasHaloSplash  = (sol < 0.55);

  let scale = 1.00;
  if (isThinLine && !hasHaloSplash) {
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
// Flux helpers
// -----------------------------
const FLUX_ENDPOINTS = [
  'https://api.bfl.ai/v1/flux/fill',
  'https://api.bfl.ai/v1/flux-fill',
  'https://api.bfl.ai/v1/flux-pro-1.0-fill',
];

const FLUX_HEADERS = (key) => ({
  'Content-Type': 'application/json',
  'x-key': key || FLUX_API_KEY,
  'Authorization': `Bearer ${key || FLUX_API_KEY}`,
});

// Accepts many task/result shapes (URL, base64, polling)
async function extractFluxImageBuffer(task, headers) {
  // direct sample URL
  const directUrl = task?.result?.sample || task?.sample;
  if (directUrl) {
    const imgRes = await axios.get(directUrl, { responseType: 'arraybuffer' });
    return Buffer.from(imgRes.data);
  }

  // base64 fields
  const base64 =
    task?.result?.image ||
    task?.result?.images?.[0] ||
    task?.image ||
    task?.images?.[0] ||
    task?.output?.[0]?.base64 ||
    task?.result?.samples?.[0]?.base64;
  if (base64) {
    const b64 = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    return Buffer.from(b64, 'base64');
  }

  // polling
  if (task?.polling_url) {
    for (let tries = 0; tries < 60; tries++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await axios.get(task.polling_url, { headers, timeout: 15000 });
      const pd = poll.data;

      if (pd.status === 'Ready') {
        const dUrl = pd?.result?.sample;
        if (dUrl) {
          const imgRes = await axios.get(dUrl, { responseType: 'arraybuffer' });
          return Buffer.from(imgRes.data);
        }
        const pb64 =
          pd?.result?.image ||
          pd?.result?.images?.[0] ||
          pd?.image ||
          pd?.images?.[0] ||
          pd?.output?.[0]?.base64 ||
          pd?.result?.samples?.[0]?.base64;
        if (pb64) {
          const b64 = pb64.startsWith('data:') ? pb64.split(',')[1] : pb64;
          return Buffer.from(b64, 'base64');
        }
        break;
      }
      if (pd.status === 'Error' || pd.status === 'Content Moderated') break;
    }
  }
  return null;
}

async function isMostlyBlack(pngBuffer) {
  try {
    const stats = await sharp(pngBuffer).stats();
    const r = stats.channels[0].mean;
    const g = stats.channels[1].mean;
    const b = stats.channels[2].mean;
    return (r < 4 && g < 4 && b < 4);
  } catch {
    return false;
  }
}

// -----------------------------
// Public module
// -----------------------------
const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    if (!REMOVE_BG_API_KEY) {
      try {
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
    const engine = 'fill'; // hard-lock to masked inpainting
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

    // Build realism guide + masks
    const generatedImageUrls = [];

    const {
      weightedMaskPNG,
      edgeRingPNG,
      hardSilPNG,
      hardFluxMaskPNG,      // white=edit
      invertedFluxMaskPNG,  // black=edit
      alphaHoleMaskPNG      // transparent=edit
    } = await buildWeightedMaskFromPositioned(positionedCanvas);

    await uploadDebug(weightedMaskPNG,     userId, 'mask_weighted');
    await uploadDebug(edgeRingPNG,         userId, 'mask_edge_ring');
    await uploadDebug(hardSilPNG,          userId, 'mask_hard_silhouette');
    await uploadDebug(hardFluxMaskPNG,     userId, 'mask_flux_white_edit');
    await uploadDebug(invertedFluxMaskPNG, userId, 'mask_flux_black_edit');
    await uploadDebug(alphaHoleMaskPNG,    userId, 'mask_flux_alpha_hole');

    const guideComposite = await bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvas);
    await uploadDebug(guideComposite, userId, 'guide_baked');

    // Prompts: realism only
    const prompt =
      'Keep the tattoo’s exact geometry and proportions pixel-perfect. Only add realistic under-skin ink diffusion, subtle micro-bleed, lighting and skin texture. No restyle, no resize, no new elements.';
    const negative =
      'no redraw, no restyle, no resizing, no thicker lines, no thinner lines, no ornaments, no extra text, no new colors';

    // Raw base64 (no data URI)
    const rawImgBase64    = guideComposite.toString('base64');
    const rawMaskWhite    = hardFluxMaskPNG.toString('base64');
    const rawMaskBlack    = invertedFluxMaskPNG.toString('base64');
    const rawMaskAlpha    = alphaHoleMaskPNG.toString('base64');

    const headers = FLUX_HEADERS(fluxApiKey);

    // Try multiple combinations until we get a non-black PNG
    async function tryOne(endpoint, imageB64, maskB64, maskMode) {
      // Some APIs accept 'guidance', some use 'guidance_scale'.
      const basePayload = {
        prompt,
        negative_prompt: negative,
        image: imageB64,
        mask: maskB64,
        output_format: 'png',
        steps: 28,
        guidance: 4,
        guidance_scale: 4,     // cover both
        safety_tolerance: 6,
        // Optional hint for engines that distinguish mask polarity
        mask_mode: maskMode,   // 'white_edit' | 'black_edit' | 'alpha_hole' (ignored if unsupported)
      };

      try {
        const res = await axios.post(endpoint, basePayload, { headers, timeout: 120000 });
        const task = res.data;
        let buf = await extractFluxImageBuffer(task, headers);
        if (!buf) return null;

        // If it's essentially black, consider it a failed variant
        if (await isMostlyBlack(buf)) {
          console.warn(`[FLUX] ${endpoint} returned near-black image for maskMode=${maskMode}`);
          return null;
        }
        return buf;
      } catch (e) {
        console.warn(`[FLUX] POST failed ${endpoint} (maskMode=${maskMode}):`, e.response?.status, e.response?.data || e.message);
        return null;
      }
    }

    const endpoints = FLUX_ENDPOINTS;

    for (let i = 0; i < numVariations; i++) {
      let fluxBuf = null;

      // Order: raw base64 + white=edit → black=edit → alpha-hole, across the endpoints
      for (const ep of endpoints) {
        if (!fluxBuf) fluxBuf = await tryOne(ep, rawImgBase64, rawMaskWhite, 'white_edit');
        if (!fluxBuf) fluxBuf = await tryOne(ep, rawImgBase64, rawMaskBlack, 'black_edit');
        if (!fluxBuf) fluxBuf = await tryOne(ep, rawImgBase64, rawMaskAlpha, 'alpha_hole');
        if (fluxBuf) break;
      }

      if (!fluxBuf) continue;

      // Clamp back to silhouette and upload
      const clamped = await clampToSilhouette(fluxBuf, hardSilPNG, weightedMaskPNG);
      const watermarked = await this.applyWatermark(clamped);
      const fileName = `tattoo-${uuidv4()}.png`;
      const publicUrl = await this.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
      generatedImageUrls.push(publicUrl);
      console.log('Image uploaded to Supabase:', publicUrl);
    }

    if (generatedImageUrls.length === 0) throw new Error('Flux API: No images were generated.');
    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
