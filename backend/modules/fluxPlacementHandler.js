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
const FLUX_SHRINK_FIX         = Number(process.env.FLUX_SHRINK_FIX  || '1.12'); // corrects consistent FLUX downsizing
const FLUX_ENGINE_DEFAULT     = (process.env.FLUX_ENGINE || 'kontext').toLowerCase(); // 'kontext' | 'fill'

// -----------------------------
// Small helpers
// -----------------------------
// Weighted mask from placed tattoo alpha
async function buildWeightedMaskFromPositioned(positionedCanvasPNG) {
  const meta = await sharp(positionedCanvasPNG).metadata();
  const w = meta.width, h = meta.height;

  // 1) Extract alpha channel as RAW 8-bit (w*h)
  const alphaRaw = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer();

  // 2) Make a hard binary mask (>=1 → 255)
  const hardRaw = Buffer.allocUnsafe(w * h);
  for (let i = 0; i < w * h; i++) hardRaw[i] = alphaRaw[i] > 0 ? 255 : 0;

  // 3) Dilate by blurring then thresholding to 0/255
  const hardBinaryPNG = await sharp(hardRaw, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();

  const dilatedPNG = await sharp(hardBinaryPNG)
    .blur(1.6)
    .threshold(1)
    .png()
    .toBuffer();

  // Bring dilated back to RAW for ring computation
  const dilatedRaw = await sharp(dilatedPNG).raw().toBuffer();

  // 4) Build ring and weighted masks from RAW arrays
  const ringRaw = Buffer.alloc(w * h);
  const insideRaw = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = Math.max(0, dilatedRaw[i] - hardRaw[i]); // edge band
    ringRaw[i] = r ? 255 : 0;
    insideRaw[i] = hardRaw[i] ? 96 : 0;                // ~38%
  }
  const weightedRaw = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) weightedRaw[i] = Math.max(ringRaw[i], insideRaw[i]);

  // 5) Produce the PNG masks we need
  const weightedMaskPNG = await sharp(weightedRaw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const edgeRingPNG     = await sharp(ringRaw,     { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const hardSilPNG      = await sharp(hardRaw,     { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();

  // Hard mask for FLUX (white=edit) — slight inflate already applied via dilated
  const hardFluxMaskPNG = await sharp(dilatedPNG).png().toBuffer();

  // Inverted version (white=keep) for alternate polarity routes
  const invertedFluxMaskPNG = await sharp(hardFluxMaskPNG).negate().png().toBuffer();

  // Alpha-hole (transparent=edit): black RGB + alpha = 0 in edit region
  const alphaHoleA = Buffer.allocUnsafe(w * h);
  for (let i = 0; i < w * h; i++) alphaHoleA[i] = 255 - hardRaw[i];
  const baseBlackRGB = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer();
  const alphaHoleMaskPNG = await sharp(baseBlackRGB)
    .joinChannel(await sharp(alphaHoleA, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer())
    .png()
    .toBuffer();

  return {
    weightedMaskPNG,
    edgeRingPNG,
    hardSilPNG,
    hardFluxMaskPNG,
    invertedFluxMaskPNG,
    alphaHoleMaskPNG,
    w, h
  };
}

// Bake an “already inked” guide (multiply + soft-light)
// keep sRGB, keep it LIGHT to avoid near-black init
async function bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvasPNG) {
  const base = sharp(skinImageBuffer).ensureAlpha().toColourspace('srgb');

  const tattooGray = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .toColourspace('srgb')
    .modulate({ saturation: 0, brightness: 0.6 }) // lighter than 0.32
    .png()
    .toBuffer();

  return base
    .composite([
      { input: tattooGray, blend: 'multiply',   opacity: 0.55 }, // lighter composite
      { input: tattooGray, blend: 'soft-light', opacity: 0.25 }
    ])
    .png()
    .toBuffer();
}

// Clamp FLUX result back to original silhouette + subtle edge restore
async function clampToSilhouette(fluxPNG, hardSilPNG, edgeRingPNG) {
  const clamped = await sharp(fluxPNG)
    .composite([{ input: hardSilPNG, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(clamped)
    .composite([{ input: edgeRingPNG, blend: 'multiply', opacity: 0.15 }])
    .png()
    .toBuffer();
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
      // NOTE: form-data in Node expects Buffer/Stream, not Blob
      formData.append('image_file', imageBuffer, { filename: 'tattoo_design.png', contentType: 'image/png' });
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
    // const engine = LOCK_SILHOUETTE ? 'fill' : pickEngine(FLUX_ENGINE_DEFAULT, ADAPTIVE_ENGINE_ENABLED, isThinLine);
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
      .png()
      .toBuffer();

    // Build realism guide + weighted mask so FLUX preserves geometry
    const generatedImageUrls = [];

    const { weightedMaskPNG, edgeRingPNG, hardSilPNG, hardFluxMaskPNG, invertedFluxMaskPNG, alphaHoleMaskPNG } =
      await buildWeightedMaskFromPositioned(positionedCanvas);
    await uploadDebug(weightedMaskPNG,  userId, 'mask_weighted');
    await uploadDebug(edgeRingPNG,      userId, 'mask_edge_ring');
    await uploadDebug(hardSilPNG,       userId, 'mask_hard_silhouette');
    await uploadDebug(hardFluxMaskPNG,  userId, 'mask_flux_binary');

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

    // util: some FLUX routes want a data URI, some return direct base64 or arrays
    const asDataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

    // tiny helper to detect "black" outputs so we can flip mask polarity automatically
    async function bufferIsMostlyBlack(buf) {
      try {
        const stats = await sharp(buf).stats();
        const mean =
          (stats.channels?.[0]?.mean ?? 0) * 0.299 +
          (stats.channels?.[1]?.mean ?? 0) * 0.587 +
          (stats.channels?.[2]?.mean ?? 0) * 0.114;
        return mean < 8; // very dark
      } catch {
        return false;
      }
    }

    async function extractFluxImageBuffer(taskOrData) {
      const data = taskOrData;

      // direct sample URL
      if (data?.result?.sample || data?.sample) {
        const url = data?.result?.sample || data?.sample;
        const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(imgRes.data);
      }

      // direct base64 fields
      const base64 =
        data?.result?.image ||
        data?.result?.images?.[0] ||
        data?.image ||
        data?.images?.[0] ||
        data?.output?.[0]?.base64 ||
        data?.result?.samples?.[0]?.base64;
      if (base64) {
        const b64 = base64.startsWith('data:') ? base64.split(',')[1] : base64;
        return Buffer.from(b64, 'base64');
      }

      // task with polling_url
      if (data?.polling_url) {
        for (let tries = 0; tries < 60; tries++) {
          await new Promise(r => setTimeout(r, 2000));
          const poll = await axios.get(data.polling_url, { headers, timeout: 15000 });
          const pd = poll.data;

          if (pd.status === 'Ready') {
            if (pd.result?.sample) {
              const imgRes = await axios.get(pd.result.sample, { responseType: 'arraybuffer' });
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

    // Prefer KONText (img2img with fidelity); fall back to fill
    const imgDataUri              = asDataUri(guideComposite);       // data URI
    const maskWhiteEditDataUri    = asDataUri(hardFluxMaskPNG);      // white=edit
    const maskWhiteKeepDataUri    = asDataUri(invertedFluxMaskPNG);  // white=keep
    const maskAlphaHoleDataUri    = asDataUri(alphaHoleMaskPNG);     // transparent=edit

    // Raw base64 for endpoints that dislike data URIs
    const rawImgBase64            = guideComposite.toString('base64');
    const rawMaskWhiteEditBase64  = hardFluxMaskPNG.toString('base64');
    const rawMaskWhiteKeepBase64  = invertedFluxMaskPNG.toString('base64');
    const rawMaskAlphaHoleBase64  = alphaHoleMaskPNG.toString('base64');

    for (let i = 0; i < numVariations; i++) {
      const seed = Date.now() + i;

      // ——— 1) KONText (may 404; try quickly) ———
      const kontextPayload = {
        prompt,
        negative_prompt: negative,
        image: imgDataUri,
        mask: maskWhiteEditDataUri,   // first attempt uses white=edit
        output_format: 'png',
        fidelity: 0.99,
        guidance_scale: 4.0,
        strength: 0.15,
        prompt_upsampling: true,
        safety_tolerance: 6,
        seed
      };

      let task = null;
      try {
        const r1 = await axios.post('https://api.bfl.ai/v1/flux/kontext-pro', kontextPayload, { headers, timeout: 120000 });
        task = r1.data;
      } catch (e1) {
        console.warn('KONText POST failed (primary):', e1.response?.status, e1.response?.data || e1.message);
        try {
          const r2 = await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', kontextPayload, { headers, timeout: 120000 });
          task = r2.data;
        } catch (e2) {
          console.warn('KONText POST failed (alt):', e2.response?.status, e2.response?.data || e2.message);
        }
      }

      // ——— 2) FILL route (with auto-polarity fallback) ———
      async function callFill(imageField, maskField) {
        const base = {
          prompt,
          negative_prompt: negative,
          output_format: 'png',
          steps: 28,
          guidance: 4,
          safety_tolerance: 6,
          seed
        };
        try {
          const f1 = await axios.post('https://api.bfl.ai/v1/flux/fill', { ...base, image: imageField, mask: maskField }, { headers, timeout: 120000 });
          return f1.data;
        } catch (e3) {
          console.warn('Fill POST failed (primary):', e3.response?.status, e3.response?.data || e3.message);
          try {
            const f2 = await axios.post('https://api.bfl.ai/v1/flux-fill', { ...base, image: imageField, mask: maskField }, { headers, timeout: 120000 });
            return f2.data;
          } catch (e4) {
            console.warn('Fill POST failed (alt1):', e4.response?.status, e4.response?.data || e4.message);
            try {
              const f3 = await axios.post('https://api.bfl.ai/v1/flux-pro-1.0-fill', { ...base, image: imageField, mask: maskField }, { headers, timeout: 120000 });
              return f3.data;
            } catch (e5) {
              console.warn('Fill POST failed (alt2):', e5.response?.status, e5.response?.data || e5.message);
              return null;
            }
          }
        }
      }

      if (!task) task = await callFill(imgDataUri, maskWhiteEditDataUri);
      if (!task) task = await callFill(imgDataUri, maskWhiteKeepDataUri);
      if (!task) task = await callFill(imgDataUri, maskAlphaHoleDataUri);
      if (!task) continue;

      // Get the image (direct, array, base64, or via polling)
      let fluxBuf = null;
      try {
        fluxBuf = await extractFluxImageBuffer(task);
      } catch (ex) {
        console.warn('extractFluxImageBuffer error:', ex.message);
      }
      if (!fluxBuf) continue;

      // If result looks black, auto-retry with alternate mask polarity/format
      if (await bufferIsMostlyBlack(fluxBuf)) {
        console.warn('[AUTO-RETRY] Result was dark/black; flipping mask polarity...');
        let retryTask = await callFill(imgDataUri, maskWhiteKeepDataUri);
        let retryBuf = retryTask ? await extractFluxImageBuffer(retryTask) : null;

        if (!retryBuf || await bufferIsMostlyBlack(retryBuf)) {
          console.warn('[AUTO-RETRY] Still dark; trying alpha-hole (transparent=edit)...');
          retryTask = await callFill(imgDataUri, maskAlphaHoleDataUri);
          retryBuf = retryTask ? await extractFluxImageBuffer(retryTask) : null;
        }

        if (!retryBuf || await bufferIsMostlyBlack(retryBuf)) {
          console.warn('[AUTO-RETRY] Some endpoints reject data URIs; trying raw base64 with white=edit...');
          retryTask = await callFill(rawImgBase64, rawMaskWhiteEditBase64);
          retryBuf = retryTask ? await extractFluxImageBuffer(retryTask) : null;
        }

        if (!retryBuf || await bufferIsMostlyBlack(retryBuf)) {
          console.warn('[AUTO-RETRY] Trying raw base64 with white=keep...');
          retryTask = await callFill(rawImgBase64, rawMaskWhiteKeepBase64);
          retryBuf = retryTask ? await extractFluxImageBuffer(retryTask) : null;
        }

        if (!retryBuf || await bufferIsMostlyBlack(retryBuf)) {
          console.warn('[AUTO-RETRY] Trying raw base64 with alpha-hole...');
          retryTask = await callFill(rawImgBase64, rawMaskAlphaHoleBase64);
          retryBuf = retryTask ? await extractFluxImageBuffer(retryTask) : null;
        }

        if (retryBuf && !(await bufferIsMostlyBlack(retryBuf))) {
          fluxBuf = retryBuf;
        }
      }

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
