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
const FLUX_PROVIDER = (process.env.FLUX_PROVIDER || 'bfl').toLowerCase();

// Candidate endpoints (newer first, legacy second)
const FLUX_ENDPOINTS = {
  fill: [
    'https://api.bfl.ai/v1/flux/inpaint',  // newer naming on many accounts
    'https://api.bfl.ai/v1/flux-fill'      // legacy naming
  ],
  kontext: [
    'https://api.bfl.ai/v1/flux/kontext-pro', // newer naming
    'https://api.bfl.ai/v1/flux-kontext-pro'  // legacy naming
  ]
};

// Unified headers: send both styles
function fluxHeaders(key) {
  const h = { 'Content-Type': 'application/json' };
  if (key) {
    h['x-key'] = key;
    h['Authorization'] = `Bearer ${key}`;
  }
  return h;
}

// Build payloads for both “new” and “legacy” field names
function buildFillPayloads({ prompt, inputBase64, maskBase64, seed, guidance=5.5 }) {
  // “new style” (image/mask) first
  const p1 = {
    prompt,
    image: inputBase64,         // PNG/JPG base64 (no data: prefix)
    mask: maskBase64,           // PNG base64 (no data: prefix)
    output_format: 'png',
    n: 1,
    guidance_scale: guidance,
    prompt_upsampling: true,
    safety_tolerance: 2,
    seed
  };
  // “legacy style”
  const p2 = {
    prompt,
    input_image: inputBase64,
    mask_image: maskBase64,
    output_format: 'png',
    n: 1,
    guidance_scale: guidance,
    prompt_upsampling: true,
    safety_tolerance: 2,
    seed
  };
  return [p1, p2];
}

// Try a list of endpoints and payload shapes until one works
async function callFluxFillTryAll({ key, endpoints, payloads }) {
  const headers = fluxHeaders(key);
  let lastErr;
  for (const url of endpoints) {
    for (const body of payloads) {
      try {
        const res = await axios.post(url, body, { headers, timeout: 90000 });
        return { url, data: res.data };
      } catch (e) {
        const code = e.response?.status;
        const msg  = e.response?.data || e.message;
        console.warn('FLUX post failed', url, code, msg);
        lastErr = e;
        // only continue on 404/405/400; throw on 401/403/5xx to surface auth/net issues quickly
        if (![400,404,405].includes(code)) throw e;
      }
    }
  }
  throw lastErr || new Error('All FLUX fill endpoints rejected the request.');
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

async function makeBinaryBWMask(maskPNGBuffer) {
  const meta = await sharp(maskPNGBuffer).metadata();
  const w = meta.width|0, h = meta.height|0;
  const alpha = await sharp(maskPNGBuffer).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const N = w*h;

  // Build solid black/white RGBA (opaque)
  const rgba = Buffer.alloc(N*4);
  for (let i=0; i<N; i++) {
    const a = alpha[i] > 0 ? 255 : 0;
    const p = i*4;
    rgba[p] = a ? 255 : 0;         // R
    rgba[p+1] = a ? 255 : 0;       // G
    rgba[p+2] = a ? 255 : 0;       // B
    rgba[p+3] = 255;               // fully opaque
  }
  return await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function featherMask(maskPNGBuffer, sigma = 0.8) {
  return sharp(maskPNGBuffer).blur(sigma).png().toBuffer();
}

async function buildEdgeRingMaskPNG(maskPNGBuffer, ringPx = 2) {
  const m = await sharp(maskPNGBuffer).metadata();
  const w = m.width|0, h = m.height|0;

  // binary core (1 inside, 0 outside)
  const alpha = await sharp(maskPNGBuffer).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const N = w*h; const core = new Uint8Array(N);
  for (let i=0;i<N;i++) core[i] = alpha[i] > 0 ? 1 : 0;

  // cheap dilation by r
  function dilate(src, r){
    let cur = Uint8Array.from(src);
    for (let pass=0; pass<r; pass++){
      const nxt = Uint8Array.from(cur);
      for (let y=0;y<h;y++){
        for (let x=0;x<w;x++){
          const i = y*w+x;
          if (cur[i]) continue;
          for (let yy=-1;yy<=1;yy++){
            const ny=y+yy; if(ny<0||ny>=h) continue;
            for (let xx=-1;xx<=1;xx++){
              const nx=x+xx; if(nx<0||nx>=w) continue;
              if (cur[ny*w+nx]) { nxt[i]=1; yy=2; break; }
            }
          }
        }
      }
      cur = nxt;
    }
    return cur;
  }

  const dil = dilate(core, Math.max(1, Math.round(ringPx)));
  const ring = Buffer.alloc(N*4); // RGBA
  for (let i=0;i<N;i++){
    const on = dil[i] && !core[i] ? 255 : 0;
    const p=i*4;
    ring[p]=255; ring[p+1]=255; ring[p+2]=255; ring[p+3]=on;
  }
  return sharp(ring, { raw: { width:w, height:h, channels:4 } }).png().toBuffer();
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

    // --- Remove background (ensure alpha) ---
    const tattooDesignPng = await fluxPlacementHandler.removeImageBackground(tattooDesignOriginalBuffer);

    // --- Analyze tattoo alpha for adaptive decisions ---
    const stats = await analyzeTattooAlpha(tattooDesignPng);
    console.log(`[ADAPT] coverage=${stats.coverage.toFixed(4)} thinness=${stats.thinness.toFixed(4)} solidity=${stats.solidity.toFixed(4)} bbox=${stats.bbox ? stats.bbox.w+'x'+stats.bbox.h : 'NA'}`);

    // --- Adaptive scale & engine pick ---
    const { scale: adaptScale, isThinLine, hasHaloSplash } =
      ADAPTIVE_SCALE_ENABLED ? chooseAdaptiveScale(stats) : { scale: 1.00, isThinLine: false, hasHaloSplash: false };

    const LOCK_SILHOUETTE = (process.env.LOCK_SILHOUETTE ?? 'false').toLowerCase() === 'true';
    let engine = LOCK_SILHOUETTE ? 'fill' : pickEngine(FLUX_ENGINE_DEFAULT, ADAPTIVE_ENGINE_ENABLED, isThinLine);
    // For this “edit tattoo but keep silhouette” flow, force fill:
    engine = 'fill';

    // final scale factor used when sizing to mask region
    const shrinkFixUsed = RESPECT_MASK_SIZE ? 1.00 : FLUX_SHRINK_FIX;
    const adaptScaleUsed = RESPECT_MASK_SIZE ? 1.00 : adaptScale;
    const EFFECTIVE_SCALE = tattooScale * GLOBAL_SCALE_UP * shrinkFixUsed * adaptScaleUsed;
    console.log(`[ENGINE] chosen=${engine} | tattooScale=${tattooScale.toFixed(3)} | GLOBAL_SCALE_UP=${GLOBAL_SCALE_UP} | FLUX_SHRINK_FIX=${shrinkFixUsed.toFixed(3)} | adaptiveScale=${adaptScaleUsed.toFixed(3)} | EFFECTIVE_SCALE=${EFFECTIVE_SCALE.toFixed(3)} | thinLine=${isThinLine} halo=${hasHaloSplash}`);

    // --- Prepare mask ---
    const originalMaskBuffer = Buffer.from(maskBase64, 'base64');

    // Solid BW + small feather
    const bwMask = await makeBinaryBWMask(originalMaskBuffer);

    let maskMeta, maskGrayRaw;
    try {
      maskMeta   = await sharp(originalMaskBuffer).metadata();
      maskGrayRaw = await sharp(originalMaskBuffer).grayscale().raw().toBuffer();
      console.log(`Mask meta: ${maskMeta.width}x${maskMeta.height}`);
    } catch (e) {
      throw new Error(`Failed to read mask: ${e.message}`);
    }

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
    const targetW = Math.round(maskBBox.width  * EFFECTIVE_SCALE);
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
      'Do not move the tattoo boundary; keep the exact silhouette and footprint. Only change ink texture, tone, and slight feathering at the edge.';

    for (let i = 0; i < numVariations; i++) {
      const seed = Date.now() + i;

      // ---- FLUX call(s) (replace your current endpoint/payload build) ----
      const inputBase64 = compositedForPreview.toString('base64');
      const fillPayloads = buildFillPayloads({
        prompt: basePrompt,
        inputBase64,
        maskBase64: maskBase64,
        seed,
        guidance: 5.5
      });

      // prefer inpaint/fill. If you still want kontext fallback, try that afterward.
      const endpoints = FLUX_ENDPOINTS.fill;

      const r = await callFluxFillTryAll({
        key: fluxApiKey || FLUX_API_KEY,
        endpoints,
        payloads: fillPayloads
      });
      const task = r.data;
      console.log(`DEBUG: FLUX POST ok via ${r.url} id=${task.id || '(no id)'}`);

      if (task?.result?.sample) {
        const url = task.result.sample;
        const fluxOutputBuffer = Buffer.from(await (await axios.get(url, { responseType: 'arraybuffer' })).data);
        const ringMask = await buildEdgeRingMaskPNG(bwMask, 2);
        const precompositeRing = await sharp(compositedForPreview).composite([{ input: ringMask, blend: 'dest-in' }]).png().toBuffer();
        const fluxWithAnchoredEdge = await sharp(fluxOutputBuffer).composite([{ input: precompositeRing, blend: 'over' }]).png().toBuffer();
        const watermarked = await fluxPlacementHandler.applyWatermark(fluxWithAnchoredEdge);
        const fileName = `tattoo-${uuidv4()}.png`;
        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
        generatedImageUrls.push(publicUrl);

      } else if (task?.polling_url) {
        // your existing polling loop
        let attempts = 0, done = false;
        while (!done && attempts < 60) {
          attempts++;
          await new Promise(r => setTimeout(r, 2000));
          const poll = await axios.get(task.polling_url, { headers: fluxHeaders(fluxApiKey || FLUX_API_KEY), timeout: 15000 });
          const data = poll.data;

          if (data.status === 'Ready') {
            const url = data.result?.sample;
            if (!url) { done = true; break; }
            const fluxOutputBuffer = Buffer.from(await (await axios.get(url, { responseType: 'arraybuffer' })).data);

            const ringMask = await buildEdgeRingMaskPNG(bwMask, 2);
            const precompositeRing = await sharp(compositedForPreview).composite([{ input: ringMask, blend: 'dest-in' }]).png().toBuffer();
            const fluxWithAnchoredEdge = await sharp(fluxOutputBuffer).composite([{ input: precompositeRing, blend: 'over' }]).png().toBuffer();
            const watermarked = await fluxPlacementHandler.applyWatermark(fluxWithAnchoredEdge);

            const fileName = `tattoo-${uuidv4()}.png`;
            const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
            generatedImageUrls.push(publicUrl);
            done = true;
          } else if (data.status === 'Error' || data.status === 'Content Moderated') {
            console.warn('FLUX polling end:', data.status, data.details || '');
            done = true;
          }
        }
      } else {
        console.warn('FLUX: neither result.sample nor polling_url returned.');
        continue;
      }
    }

    if (generatedImageUrls.length === 0) {
      throw new Error('Flux API: No images were generated across all attempts. Please try again.');
    }

    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
