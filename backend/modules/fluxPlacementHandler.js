// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-11-28_FLUX2_MIGRATION');

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
// Behavior flags + knobs
// -----------------------------
const ADAPTIVE_SCALE_ENABLED  = (process.env.ADAPTIVE_SCALE_ENABLED  ?? 'true').toLowerCase() === 'true';
const ADAPTIVE_ENGINE_ENABLED = (process.env.ADAPTIVE_ENGINE_ENABLED ?? 'false').toLowerCase() === 'true'; // Disabled: kontext is only working engine
const GLOBAL_SCALE_UP         = Number(process.env.MODEL_SCALE_UP || '1.5');          // applied always
const FLUX_ENGINE_DEFAULT     = (process.env.FLUX_ENGINE || 'kontext').toLowerCase(); // kontext is the only working BFL endpoint as of Nov 2025

// Engine-specific size bias to counter model shrink
const ENGINE_KONTEXT_SIZE_BIAS = Number(process.env.ENGINE_KONTEXT_SIZE_BIAS || '1.08');
const ENGINE_FILL_SIZE_BIAS    = Number(process.env.ENGINE_FILL_SIZE_BIAS    || '1.02');

// Mask grow (gives the model some “breathing room”)
const MODEL_MASK_GROW_PCT = Number(process.env.MODEL_MASK_GROW_PCT || '0.06'); // 6% of bbox max dim
const MODEL_MASK_GROW_MIN = Number(process.env.MODEL_MASK_GROW_MIN || '4');    // px
const MODEL_MASK_GROW_MAX = Number(process.env.MODEL_MASK_GROW_MAX || '28');   // px
const WHITE_BG_MIN_CHANNEL = Number(process.env.WHITE_BG_MIN_CHANNEL || '215');
const WHITE_BG_CHROMA_MAX  = Number(process.env.WHITE_BG_CHROMA_MAX  || '16');
const BG_COLOR_TOLERANCE   = Number(process.env.BG_COLOR_TOLERANCE   || '28');
const STENCIL_BG_STRIP_ENABLED = (process.env.STENCIL_BG_STRIP_ENABLED ?? 'false').toLowerCase() === 'true';

// --- NEW: baked-guide tuning (neutral; prevents white-out and over-darkening)
const BAKE_TATTOO_BRIGHTNESS   = Number(process.env.BAKE_TATTOO_BRIGHTNESS || '0.96'); // 0.92–1.02 sweet spot for skin absorption
const BAKE_TATTOO_GAMMA        = Number(process.env.BAKE_TATTOO_GAMMA      || '1.00'); // 0.95–1.05
const BAKE_OVERLAY_OPACITY     = Number(process.env.BAKE_OVERLAY_OPACITY   || '0.28');
const BAKE_SOFTLIGHT_OPACITY   = Number(process.env.BAKE_SOFTLIGHT_OPACITY || '0.35');
const BAKE_MULTIPLY_OPACITY    = Number(process.env.BAKE_MULTIPLY_OPACITY  || '0.12');

// FLUX parameters for tattoo inpainting
// Higher fidelity (0.75-0.90) preserves more of the original stencil design
// Lower guidance (2.0-3.5) allows natural skin integration without over-processing
const ENGINE_KONTEXT_FIDELITY  = Number(process.env.ENGINE_KONTEXT_FIDELITY  || '0.82');
const ENGINE_KONTEXT_GUIDANCE  = Number(process.env.ENGINE_KONTEXT_GUIDANCE  || '2.8');
const ENGINE_FILL_GUIDANCE     = Number(process.env.ENGINE_FILL_GUIDANCE     || '2.5'); // Kept for future use

const FLUX_STEPS = Number(process.env.FLUX_STEPS || '50');
const MASK_FEATHER_SIGMA = Number(process.env.MASK_FEATHER_SIGMA || '0.7');
const MASK_CORE_THRESHOLD = Number(process.env.MASK_CORE_THRESHOLD || '210');

// BFL API Endpoints - as of Nov 2025:
// - flux-fill-pro and flux-fill return 404 (deprecated or access-restricted)
// - flux-kontext-pro is the only working endpoint for image editing
// - FLUX.2 endpoints (flux-pro-1.1-ultra, etc.) may become available later
const FLUX_KONTEXT_ENDPOINTS = (process.env.FLUX_KONTEXT_ENDPOINTS || 'https://api.bfl.ai/v1/flux-kontext-pro')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

// Future FLUX.2 endpoints - set via env var when BFL enables them for your account
// Expected: flux-pro-1.1-ultra, flux-pro-1.1, flux-dev-1.1
const FLUX2_ENDPOINTS = (process.env.FLUX2_ENDPOINTS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

// Legacy fill endpoints - kept for reference but disabled by default (return 404)
const FLUX_FILL_ENDPOINTS = (process.env.FLUX_FILL_ENDPOINTS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

const IMAGE_TTL_SECONDS = Number(process.env.IMAGE_TTL_SECONDS || '300'); // 5 minutes default
const TEMP_IMAGE_TTL_MS = IMAGE_TTL_SECONDS * 1000;
const deletionTimers = new Map();

// -----------------------------
// Small helpers
// -----------------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

let ensureBucketPromise = null;

async function computeAlphaCoverage(buffer) {
  const img = sharp(buffer).ensureAlpha();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) return 0;
  const alpha = await img.extractChannel('alpha').raw().toBuffer();
  let filled = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 8) filled++;
  }
  return filled / alpha.length;
}

async function ensureSupabaseBucket() {
  if (!SUPABASE_STORAGE_BUCKET) {
    throw new Error('Supabase storage bucket name is not configured.');
  }

  if (!ensureBucketPromise) {
    ensureBucketPromise = (async () => {
      try {
        const { data, error } = await supabase.storage.getBucket(SUPABASE_STORAGE_BUCKET);
        if (error) {
          // Supabase returns a 400/404 style error when the bucket does not exist yet.
          if (error.status === 400 || error.status === 404 || /not found/i.test(error.message || '')) {
            const { error: createError } = await supabase.storage.createBucket(SUPABASE_STORAGE_BUCKET, { public: true });
            if (createError && !/already exists/i.test(createError.message || '')) {
              throw createError;
            }
            if (!createError) {
              console.log(`[SUPABASE] Created missing bucket "${SUPABASE_STORAGE_BUCKET}"`);
            }
          } else {
            throw error;
          }
        } else if (!data) {
          // If the SDK returned no data and no error, fall back to creating the bucket.
          const { error: createError } = await supabase.storage.createBucket(SUPABASE_STORAGE_BUCKET, { public: true });
          if (createError && !/already exists/i.test(createError.message || '')) {
            throw createError;
          }
          if (!createError) {
            console.log(`[SUPABASE] Created missing bucket "${SUPABASE_STORAGE_BUCKET}"`);
          }
        }
      } catch (err) {
        console.error('Failed to ensure Supabase bucket exists:', err);
        throw err;
      }
    })();
  }

  return ensureBucketPromise;
}

function scheduleImageDeletion(filePath, label = 'image', ttlMs = TEMP_IMAGE_TTL_MS) {
  if (!filePath || !ttlMs || ttlMs <= 0) return;

  if (deletionTimers.has(filePath)) {
    clearTimeout(deletionTimers.get(filePath));
  }

  console.log(`[TTL] Scheduled deletion for ${filePath} in ${Math.round(ttlMs / 1000)} seconds (${label}).`);

  const timer = setTimeout(() => {
    deletionTimers.delete(filePath);
    (async () => {
      try {
        await ensureSupabaseBucket();
        const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([filePath]);
        if (error) {
          console.warn(`[TTL] Failed to delete ${filePath}: ${error.message}`);
        } else {
          console.log(`[TTL] Deleted ${filePath} after TTL (${label}).`);
        }
      } catch (err) {
        console.warn(`[TTL] Exception while deleting ${filePath}: ${err.message}`);
      }
    })();
  }, ttlMs);

  deletionTimers.set(filePath, timer);
}

async function uploadDebug(imageBuffer, userId, name, contentType = 'image/png', folder = 'debug') {
  try {
    await ensureSupabaseBucket();
    const fileName = `${name}_${uuidv4()}.${contentType.startsWith('image/png') ? 'png' : 'jpg'}`;
    const filePath = `${userId}/${folder}/${fileName}`;
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
      .upload(filePath, imageBuffer, { contentType, upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    console.log('[UPLOAD] final URL for client:', pub.publicUrl);
    console.log(`[DEBUG_UPLOAD] ${fileName} => ${pub.publicUrl}`);
    scheduleImageDeletion(filePath, 'debug');
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

  const minMean = Math.min(mean[0], mean[1], mean[2]);
  const maxMean = Math.max(mean[0], mean[1], mean[2]);
  const chroma  = maxMean - minMean;
  const nearWhite = (minMean >= WHITE_BG_MIN_CHANNEL && maxMean >= 240 && chroma <= WHITE_BG_CHROMA_MAX);
  const lowVar    = (std[0] < 3.5 && std[1] < 3.5 && std[2] < 3.5);

  const looksWhite = nearWhite && lowVar;
  console.log('[BG-DETECT] mean=', mean.map(v => v.toFixed(1)).join(','), 'std=', std.map(v => v.toFixed(2)).join(','), 'looksWhite=', looksWhite);
  return { isUniformWhite: looksWhite, bgColor: mean };
}

async function colorToAlphaWhite(buffer, bgColor = [255, 255, 255]) {
  // Gentle white→alpha with decontamination; preserves edges reasonably well
  const img = sharp(buffer).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const raw = await img.raw().toBuffer();

  const soft = 235, hard = 252;
  const ramp = Math.max(1, hard - soft);
  const [bgR, bgG, bgB] = bgColor;
  console.log('[BG-REMOVE] using bgColor=', bgColor.map(v => v.toFixed(1)).join(','));

  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const R = raw[p], G = raw[p + 1], B = raw[p + 2], A = raw[p + 3];
    const wmax = Math.max(R, G, B);
    const wmin = Math.min(R, G, B);
    const chroma = wmax - wmin;
    const looksBackgroundWhite = (wmin >= WHITE_BG_MIN_CHANNEL && chroma <= WHITE_BG_CHROMA_MAX);
    const looksBackgroundColor =
      Math.max(Math.abs(R - bgR), Math.abs(G - bgG), Math.abs(B - bgB)) <= BG_COLOR_TOLERANCE &&
      chroma <= WHITE_BG_CHROMA_MAX + 6;
    let alpha = A;
    if ((wmax >= soft && looksBackgroundWhite) || looksBackgroundColor) {
      const cut = Math.max(0, Math.min(1, (wmax - soft) / ramp));
      alpha = Math.round(A * (1 - cut));
      if (wmax >= hard) alpha = 0;
    }
    // decontaminate white fringe
    if (alpha > 0 && alpha < 255) {
      const a = alpha / 255;
      raw[p]   = clamp(Math.round((R - (1 - a) * 255) / a), 0, 255);
      raw[p+1] = clamp(Math.round((G - (1 - a) * 255) / a), 0, 255);
      raw[p+2] = clamp(Math.round((B - (1 - a) * 255) / a), 0, 255);
    }
    raw[p + 3] = alpha;
  }

  const output = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  console.log('[BG-REMOVE] completed white→alpha conversion');
  return output;
}

// -----------------------------
// Adaptive analysis on tattoo alpha
// -----------------------------
async function analyzeTattooAlpha(pngBuffer) {
  // returns { coverage, thinness, solidity, bbox, width, height }
  const img = sharp(pngBuffer).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width | 0, h = meta.height | 0;

  const alpha = await img.extractChannel('alpha').raw().toBuffer(); // 1 channel
  const N = w * h;

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
  if (area === 0) return { coverage: 0, thinness: 0, solidity: 0, bbox: null, width: w, height: h };

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bboxArea = bboxW * bboxH;
  const coverage = area / N;
  const solidity = bboxArea > 0 ? area / bboxArea : 0;

  // Thinness proxy: edge density via alpha gradient
  let gradAcc = 0, gradCount = 0;
  for (let y = minY + 1; y < maxY; y++) {
    let row = y * w;
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
    coverage, thinness, solidity,
    bbox: { minX, minY, maxX, maxY, w: bboxW, h: bboxH },
    width: w, height: h
  };
}

function chooseAdaptiveScale(stats) {
  const cov = stats.coverage;
  const thn = stats.thinness;
  const sol = stats.solidity;

  const isThinLine     = (cov < 0.12 && thn > 0.10);
  const hasHaloSplash  = (sol < 0.55);

  let scale = 1.0;
  if (isThinLine && !hasHaloSplash) {
    const boost = clamp(1.20 + (0.12 - cov) * 2.5, 1.20, 1.50); // 1.20..1.50
    scale = boost;
  } else if (hasHaloSplash) {
    scale = 1.0;
  } else {
    scale = 1.05;
  }
  return { scale, isThinLine, hasHaloSplash };
}

function pickEngine(baseEngine, adaptiveEnabled, isThinLine) {
  if (!adaptiveEnabled) return baseEngine;
  if (isThinLine) return 'fill';
  return baseEngine;
}

// ------ simple “dilation” for 8-bit gray mask using box-convolve + threshold
async function dilateGrayMaskToPng(grayRawBuffer, w, h, growPx) {
  const img = sharp(grayRawBuffer, { raw: { width: w, height: h, channels: 1 } });
  const r = clamp(growPx, 1, 64);
  const k = 2 * r + 1;
  const kernel = { width: k, height: k, kernel: new Array(k * k).fill(1) };

  const convolved = await img
    .convolve(kernel)
    .threshold(1)                // anything >0 becomes 255
    .toColourspace('b-w')        // single channel
    .png()
    .toBuffer();

  return convolved; // PNG (L)
}

// ------ NEW: Neutral baked guide (overlay + soft-light + tiny multiply)
// Preserves color while creating a subtle guide for FLUX
async function bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvasPNG) {
  const base = sharp(skinImageBuffer).ensureAlpha().toColourspace('srgb');

  // Keep higher saturation to preserve color (was 0.15, now 0.65-0.75)
  // This ensures FLUX sees the color information in the guide
  const tattooPrep = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .toColourspace('srgb')
    .modulate({
      saturation: 0.70, // Increased from 0.15 to preserve color
      brightness: BAKE_TATTOO_BRIGHTNESS
    })
    .gamma(BAKE_TATTOO_GAMMA)
    .png()
    .toBuffer();

  return base
    .composite([
      { input: tattooPrep, blend: 'overlay',    opacity: BAKE_OVERLAY_OPACITY   },
      { input: tattooPrep, blend: 'soft-light', opacity: BAKE_SOFTLIGHT_OPACITY },
      { input: tattooPrep, blend: 'multiply',   opacity: BAKE_MULTIPLY_OPACITY  }
    ])
    .png()
    .toBuffer();
}

// -----------------------------
// Public module
// -----------------------------
const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    if (!STENCIL_BG_STRIP_ENABLED) {
      console.log('[BG] Stripping disabled → returning original stencil with alpha intact.');
      return await sharp(imageBuffer).ensureAlpha().png().toBuffer();
    }

    // 1) If no key, try local white→alpha; if not uniform white, just pass-through
    if (!REMOVE_BG_API_KEY) {
      try {
        const { isUniformWhite, bgColor } = await detectUniformWhiteBackground(imageBuffer);
        if (isUniformWhite) {
          console.log('[BG] Uniform white detected → converting to alpha locally.');
          return await colorToAlphaWhite(imageBuffer, bgColor);
        }
      } catch (e) {
        console.warn('[BG] local white→alpha probe failed, passing-through:', e.message);
      }
      return await sharp(imageBuffer).png().toBuffer();
    }

    // 2) Try remove.bg; if fails, fallback to local logic or passthrough
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
        const { isUniformWhite, bgColor } = await detectUniformWhiteBackground(imageBuffer);
        console.log('[BG] fallback detector result:', { isUniformWhite, bgColor });
        if (isUniformWhite) return await colorToAlphaWhite(imageBuffer, bgColor);
      } catch (e) {}
      return await sharp(imageBuffer).png().toBuffer();
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
    await ensureSupabaseBucket();
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
      .upload(filePath, imageBuffer, { contentType, upsert: false });
    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error(`Failed to upload image to storage: ${error.message}`);
    }
    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    if (!pub?.publicUrl) throw new Error('Failed to get public URL for uploaded image.');
    console.log('Image uploaded to Supabase:', pub.publicUrl);
    scheduleImageDeletion(filePath, 'result');
    const expiresAt = TEMP_IMAGE_TTL_MS > 0 ? new Date(Date.now() + TEMP_IMAGE_TTL_MS).toISOString() : null;
    return {
      url: pub.publicUrl,
      path: filePath,
      expires_at: expiresAt
    };
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

    // --- Ensure proper alpha on tattoo design ---
    await uploadDebug(tattooDesignOriginalBuffer, userId, 'tattoo_design_original');
    const originalAlphaCoverage = await computeAlphaCoverage(tattooDesignOriginalBuffer);
    let tattooDesignPng = await fluxPlacementHandler.removeImageBackground(tattooDesignOriginalBuffer);
    const processedAlphaCoverage = await computeAlphaCoverage(tattooDesignPng);
    console.log(`[STENCIL] alpha coverage original=${(originalAlphaCoverage*100).toFixed(2)}% processed=${(processedAlphaCoverage*100).toFixed(2)}%`);
    if (processedAlphaCoverage < originalAlphaCoverage * 0.95) {
      console.warn('[STENCIL] Processed coverage dropped too much. Reverting to original stencil (no background strip).');
      tattooDesignPng = await sharp(tattooDesignOriginalBuffer).ensureAlpha().png().toBuffer();
    }
    await uploadDebug(tattooDesignPng, userId, 'tattoo_design_processed');

    // --- Analyze tattoo alpha for adaptive decisions ---
    const stats = await analyzeTattooAlpha(tattooDesignPng);
    console.log(`[ADAPT] coverage=${stats.coverage.toFixed(4)} thinness=${stats.thinness.toFixed(4)} solidity=${stats.solidity.toFixed(4)} bbox=${stats.bbox ? stats.bbox.w+'x'+stats.bbox.h : 'NA'}`);

    // --- Adaptive scale & engine pick ---
    const baseEngine = FLUX_ENGINE_DEFAULT;
    const { scale: adaptScale, isThinLine, hasHaloSplash } = ADAPTIVE_SCALE_ENABLED
      ? chooseAdaptiveScale(stats)
      : { scale: 1.0, isThinLine: false, hasHaloSplash: false };
    const engine = pickEngine(baseEngine, ADAPTIVE_ENGINE_ENABLED, isThinLine);

    const ENGINE_SIZE_BIAS = engine === 'kontext' ? ENGINE_KONTEXT_SIZE_BIAS : ENGINE_FILL_SIZE_BIAS;

    // final scale factor used when sizing to mask region
    const EFFECTIVE_SCALE = tattooScale * GLOBAL_SCALE_UP * adaptScale * ENGINE_SIZE_BIAS;
    console.log(`[ENGINE] chosen=${engine} | GLOBAL_SCALE_UP=${GLOBAL_SCALE_UP} | adaptiveScale=${adaptScale.toFixed(3)} | engineBias=${ENGINE_SIZE_BIAS} | effective=${EFFECTIVE_SCALE.toFixed(3)} | thinLine=${isThinLine} halo=${hasHaloSplash}`);

    // --- Prepare mask ---
    const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
    let maskMeta, maskGrayRaw;
    try {
      maskMeta   = await sharp(originalMaskBuffer).metadata();
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
    console.log(`[MASK] bbox=${maskBBox.width}x${maskBBox.height} origin=(${maskBBox.minX},${maskBBox.minY})`);

    // Grow (dilate) the mask for the model so it doesn’t shrink the tattoo
    const growPx = clamp(
      Math.round(MODEL_MASK_GROW_PCT * Math.max(maskBBox.width, maskBBox.height)),
      MODEL_MASK_GROW_MIN,
      MODEL_MASK_GROW_MAX
    );
    const grownMaskPng = await dilateGrayMaskToPng(maskGrayRaw, maskMeta.width, maskMeta.height, growPx);
    await uploadDebug(grownMaskPng, userId, `mask_for_model_grow${growPx}px`);

    // --- Resize/rotate tattoo to fit mask with effective scale ---
    const targetW = Math.round(maskBBox.width  * EFFECTIVE_SCALE);
    const targetH = Math.round(maskBBox.height * EFFECTIVE_SCALE);
    const resizedTattoo = await sharp(tattooDesignPng)
      .resize({ width: targetW, height: targetH, fit: sharp.fit.inside, withoutEnlargement: false })
      .toBuffer();
    await uploadDebug(resizedTattoo, userId, 'tattoo_resized');

    const rotatedTattoo = await sharp(resizedTattoo)
      .rotate(tattooAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    await uploadDebug(rotatedTattoo, userId, 'tattoo_rotated');

    const rotMeta = await sharp(rotatedTattoo).metadata();

    const centeredLeft = maskBBox.minX + (maskBBox.width  - targetW) / 2;
    const centeredTop  = maskBBox.minY + (maskBBox.height - targetH) / 2;
    const placementLeft = Math.round(centeredLeft - (rotMeta.width  - targetW) / 2);
    const placementTop  = Math.round(centeredTop  - (rotMeta.height - targetH) / 2);

    // --- Build positioned tattoo canvas (skin-sized transparent)
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

    // Debug-only: plain overlay preview (not used for FLUX input anymore)
    const compositedForPreview = await sharp(skinImageBuffer)
      .composite([{ input: positionedCanvas, blend: 'over' }])
      .png()
      .toBuffer();

    // NEW: neutral baked guide used as the actual FLUX input
    const guideComposite = await bakeTattooGuideOnSkin(skinImageBuffer, positionedCanvas);

    await uploadDebug(originalMaskBuffer, userId, 'mask_original');
    await uploadDebug(positionedCanvas,   userId, 'tattoo_canvas_positioned');
    await uploadDebug(compositedForPreview, userId, 'debug_preview_input');
    await uploadDebug(guideComposite, userId, 'guide_baked_neutral');

    // -----------------------------
    // FLUX call(s)
    // -----------------------------
    const generatedImageUrls = [];
    
    // Prepare a Flux-friendly mask:
    // - Use the grown mask so the AI has room to blend ink
    // Create a two-stage mask:
    //  - coreMask keeps the exact selection fully white to stop Flux from touching preserved skin
    //  - featherMask blends outward so the tattoo edge can fade naturally
    const coreMaskBuffer = await sharp(originalMaskBuffer)
      .threshold(MASK_CORE_THRESHOLD)
      .toColourspace('b-w')
      .png()
      .toBuffer();

    const featherMaskBuffer = await sharp(grownMaskPng)
      .blur(MASK_FEATHER_SIGMA)
      .toColourspace('b-w')
      .png()
      .toBuffer();

    const fluxMaskBuffer = await sharp(featherMaskBuffer)
      .composite([{ input: coreMaskBuffer, blend: 'lighten' }])
      .png()
      .toBuffer();
    
    await uploadDebug(fluxMaskBuffer, userId, 'mask_flux_final');
    
    const maskB64 = fluxMaskBuffer.toString('base64');
    
    const basePrompt = [
      'Render a realistic healed tattoo integrated into human skin in the masked area.',
      'The tattoo should look like a professional tattoo that has freshly healed and settled into the skin.',
      'Maintain full vibrant colors from the original tattoo design with realistic ink saturation and skin texture showing through.',
      'Preserve the exact stencil linework, proportions, and motifs — only add subtle healed effects, do NOT redraw the artwork.',
      'Keep line edges within 1px of the stencil and limit ink diffusion so the tattoo still reads like the original design.',
      'Include authentic details: subtle ink diffusion at edges, natural skin pores visible through ink, realistic depth and shading.',
      'The tattoo should blend naturally with the surrounding skin tone and lighting while keeping colors rich and vivid.',
      'Maintain the exact artwork, shapes, and layout from the provided tattoo design — do not invent a new motif.',
      'Keep the tattoo looking vibrant and clean, like real ink that healed within the last few weeks.'
    ].join(' ');
    
    const negativePrompt = [
      'black and white, grayscale, desaturated, monochrome, colorless, washed out, faded',
      'fake tattoo, temporary tattoo, sticker, decal, illustration, cartoon, anime, drawing',
      'blurry, low quality, distorted, unrealistic, artificial, digital art',
      'missing tattoo, empty area, no tattoo, blank skin'
    ].join(', ');
    
    const variationDescriptors = [
      'Style A: Fresh, bold tattoo with crisp edges and vibrant saturated colors. Recently healed with minimal ink spread. Keep linework 98% identical to the stencil.',
      'Style B: Balanced healed tattoo with gentle skin diffusion, soft micro-shadows, and preserved color vibrancy. Maintain all original shapes and motifs with only subtle texture.',
      'Style C: Slightly softened tattoo edges with subtle diffusion, but keep colors rich and avoid any faded or aged look. The stencil geometry must remain unchanged.'
    ];

    const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey || FLUX_API_KEY };
    
    // Build available endpoints - prioritize FLUX.2 if configured, then kontext, then fill (legacy)
    const engineEndpoints = {
      flux2: FLUX2_ENDPOINTS,
      kontext: FLUX_KONTEXT_ENDPOINTS,
      fill: FLUX_FILL_ENDPOINTS
    };

    // Determine engine attempt order based on what's available
    const engineAttemptOrder = [];
    if (FLUX2_ENDPOINTS.length > 0) engineAttemptOrder.push('flux2');
    if (FLUX_KONTEXT_ENDPOINTS.length > 0) engineAttemptOrder.push('kontext');
    if (FLUX_FILL_ENDPOINTS.length > 0) engineAttemptOrder.push('fill');
    
    if (engineAttemptOrder.length === 0) {
      throw new Error('No FLUX API endpoints configured. Set FLUX_KONTEXT_ENDPOINTS or FLUX2_ENDPOINTS.');
    }
    
    const preferredEngine = engineAttemptOrder[0]; // Use first available

    // Use the baked guide as the driving input
    const inputBase64 = guideComposite.toString('base64');          // RAW b64 (no data URI)
    // Mask is already blurred above - Flux will modify only the tattoo area

    console.log(`Making ${numVariations} calls to FLUX (preferred engine: ${preferredEngine})...`);

    function randomInRange(min, max) {
      if (min >= max) return min;
      return min + Math.random() * (max - min);
    }

    const baseSeed = Date.now();
    for (let i = 0; i < numVariations; i++) {
      // Add a 1-second delay between API calls to avoid overwhelming the server, but not before the first call.
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const seed = baseSeed + i * 5000 + Math.floor(Math.random() * 2000);

      const prompt = `${basePrompt} ${variationDescriptors[i % variationDescriptors.length]}`;

      // Guidance / fidelity bands tuned for realistic tattoo rendering
      // Higher fidelity = more faithful to original stencil
      // Lower guidance = more natural skin integration, less "AI processed" look
      
      // THREE DISTINCT STYLES with wider parameter spread:
      // Style 1: "Fresh ink" - high fidelity, low guidance (closest to stencil, most natural)
      // Style 2: "Healed realistic" - medium fidelity, medium guidance (balanced look)
      // Style 3: "Artistic interpretation" - lower fidelity, higher guidance (more AI creativity)
      
      const variationStyles = [
        { guidance: [1.8, 2.2], fidelity: [0.88, 0.94], name: 'Fresh ink (closest to stencil)' },
        { guidance: [2.5, 3.0], fidelity: [0.75, 0.82], name: 'Healed realistic' },
        { guidance: [3.2, 3.8], fidelity: [0.62, 0.72], name: 'Artistic interpretation' }
      ];
      
      const style = variationStyles[i % 3];
      const variedKontextGuidance = randomInRange(style.guidance[0], style.guidance[1]);
      const variedKontextFidelity = randomInRange(style.fidelity[0], style.fidelity[1]);
      
      // Legacy fill guidance (kept for future use)
      const variedFillGuidance = randomInRange(2.0, 2.8);
      
      // FLUX.2 guidance (when available) - optimized for multi-reference
      const variedFlux2Guidance = randomInRange(3.0, 4.0);
      
      const variedSafetyTolerance = 2; // Keep consistent for cleaner comparison

      console.log(`[VARIATION ${i + 1}] ${style.name} | seed=${seed} guidance=${variedKontextGuidance.toFixed(2)} fidelity=${variedKontextFidelity.toFixed(3)}`);

      let task = null;
      let engineUsed = null;
      let pollingUrl = null;

      for (const engineCandidate of engineAttemptOrder) {
        const endpoints = engineEndpoints[engineCandidate] || [];
        if (!endpoints.length) continue;

        // Build payload based on engine type
        const payload = {
          prompt,
          negative_prompt: negativePrompt,
          input_image: inputBase64,
          mask_image: maskB64,
          output_format: 'png',
          n: 1,
          prompt_upsampling: true,
          safety_tolerance: variedSafetyTolerance,
          seed,
          steps: FLUX_STEPS
        };
        
        // Engine-specific parameters
        if (engineCandidate === 'kontext') {
          payload.guidance_scale = variedKontextGuidance;
          payload.fidelity = variedKontextFidelity;
        } else if (engineCandidate === 'flux2') {
          payload.guidance_scale = variedFlux2Guidance;
          // FLUX.2 may support additional params like reference images - add when documented
        } else if (engineCandidate === 'fill') {
          payload.guidance_scale = variedFillGuidance;
        }

        let endpointHit = false;
        for (const endpointUrl of endpoints) {
          try {
            const res = await axios.post(endpointUrl, payload, { headers: fluxHeaders, timeout: 120000 });
            task = res.data;
            pollingUrl = task?.polling_url;
            engineUsed = engineCandidate;
            endpointHit = true;
            console.log(`[FLUX] Variation ${i + 1} using ${engineCandidate} (${endpointUrl.split('/').pop()}) status=${res.status} id=${task?.id || 'NA'}`);
            break;
          } catch (e) {
            const status = e.response?.status;
            const detail = e.response?.data?.detail || e.response?.data?.message;
            console.warn(`[FLUX] POST failed via ${endpointUrl}:`, detail || e.message);
            if (status === 404) {
              console.warn(`[FLUX] ${engineCandidate} endpoint returned 404, trying next...`);
              continue;
            }
            // Non-404 errors should break to try the next engine option.
            break;
          }
        }
        if (endpointHit && task) break;
      }

      if (!task || !pollingUrl) {
        console.warn(`[FLUX] Variation ${i + 1}: no task returned after trying all engines.`);
        continue;
      }

      console.log(`[FLUX] Variation ${i + 1} polling via ${engineUsed}`);

      // Poll
      let attempts = 0, done = false;
      while (!done && attempts < 60) {
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        const poll = await axios.get(pollingUrl, { headers: { 'x-key': fluxApiKey || FLUX_API_KEY }, timeout: 15000 });
        const data = poll.data;

        if (data.status === 'Ready') {
          const url = data.result?.sample;
          if (!url) { done = true; break; }
          const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
          const buf = Buffer.from(imgRes.data);
          const watermarked = await fluxPlacementHandler.applyWatermark(buf);
          const fileName = `tattoo-${uuidv4()}.png`;
          const uploadResult = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
          generatedImageUrls.push(uploadResult);
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
export { IMAGE_TTL_SECONDS };
