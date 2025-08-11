// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-11_SIZE+MASK_V1');

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

// ---- Supabase ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';

// ---- Engine flag ----
// kontext (default) | fill
const FLUX_ENGINE = (process.env.FLUX_ENGINE || 'kontext').toLowerCase();

// Debug uploads toggle (default ON)
const DEBUG_UPLOADS = (process.env.DEBUG_UPLOADS ?? '1') !== '0';

// ---- remove.bg ----
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;

// ---- tattoo scale-up for model ----
// 1.2 = +20% size sent to FLUX (can override with env if needed)
const MODEL_SCALE_UP = parseFloat(process.env.MODEL_SCALE_UP || '1.2');

/* ============================== Helpers ============================== */

async function uploadDebug(buffer, name, userId, contentType = 'image/png') {
  if (!DEBUG_UPLOADS) return null;
  try {
    const url = await fluxPlacementHandler.uploadToSupabaseStorage(
      buffer, `${name}`, userId, 'debug', contentType
    );
    console.log(`[DEBUG_UPLOAD] ${name} => ${url}`);
    return url;
  } catch (e) {
    console.warn('[DEBUG_UPLOAD] failed:', name, e.message);
    return null;
  }
}

/** Read raw single-channel gray. */
async function toRawGray(buffer) {
  const meta = await sharp(buffer).metadata();
  const raw = await sharp(buffer).grayscale().raw().toBuffer();
  return { raw, width: meta.width, height: meta.height };
}

/** Count white pixels (>127). */
async function areaFromMaskPng(maskPng) {
  const { raw } = await toRawGray(maskPng);
  let A = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] > 127) A++;
  return A;
}

/** Area & 4-neighbor perimeter. */
function areaPerimeterFromRaw({ raw, width, height }) {
  let A = 0, P = 0;
  const idx = (x, y) => y * width + x;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = raw[idx(x, y)] > 127;
      if (!on) continue;
      A++;
      if (x === 0 || raw[idx(x - 1, y)] <= 127) P++;
      if (x === width - 1 || raw[idx(x + 1, y)] <= 127) P++;
      if (y === 0 || raw[idx(x, y - 1)] <= 127) P++;
      if (y === height - 1 || raw[idx(x, y + 1)] <= 127) P++;
    }
  }
  return { A, P };
}

/** Thickness metric: t = 4πA / P²  (0≈hairline, →1≈solid). */
function thicknessFromAP(A, P) {
  if (P <= 0) return 0;
  return Math.max(0, Math.min(1, (4 * Math.PI * A) / (P * P)));
}

/** Feather for soft edges. */
async function featherMask(maskPng, sigma = 0.3) {
  return sharp(maskPng).blur(sigma).png().toBuffer();
}

/** Dilate a hard mask by integer radius (cap bumped to 64px to allow +20% growth). */
async function dilateHardMask(hardMaskPng, radiusPx) {
  const r = Math.max(0, Math.min(64, Math.round(radiusPx)));
  if (r === 0) return hardMaskPng;

  const k = 2 * r + 1;
  const kernel = { width: k, height: k, kernel: Array(k * k).fill(1) };

  const meta = await sharp(hardMaskPng).metadata();
  const summed = await sharp(hardMaskPng)
    .removeAlpha()
    .convolve(kernel)
    .normalize()
    .threshold(1)
    .png()
    .toBuffer();

  return sharp(summed).resize({ width: meta.width, height: meta.height, fit: 'fill' }).png().toBuffer();
}

/** Build a smart hard mask (0/255), prefer ALPHA; fallback to LUMA with safe polarity. */
async function buildSmartMask(maskBuffer, skinW, skinH) {
  const meta = await sharp(maskBuffer).metadata();
  console.log(`[MASK] Input meta: ${meta.width}x${meta.height}, hasAlpha=${!!meta.hasAlpha}, channels=${meta.channels}`);

  const EXT_LOW = 0.00001;   // 0.001% of image
  const EXT_HIGH = 0.995;    // 99.5%

  // 1) Try ALPHA path first if present
  if (meta.hasAlpha) {
    const alphaRaw = await sharp(maskBuffer).extractChannel('alpha')
      .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
      .raw()
      .toBuffer();

    let nz = 0, sum = 0, minA = 255, maxA = 0;
    for (let i = 0; i < alphaRaw.length; i++) {
      const v = alphaRaw[i];
      sum += v;
      if (v > 0) nz++;
      if (v < minA) minA = v;
      if (v > maxA) maxA = v;
    }
    const mean = sum / alphaRaw.length;
    const nzRatio = nz / alphaRaw.length;

    console.log(`[MASK] Alpha stats: mean=${mean.toFixed(2)} nz%=${(nzRatio*100).toFixed(4)} min=${minA} max=${maxA}`);

    if (nzRatio >= EXT_LOW && nzRatio <= EXT_HIGH) {
      const hard = await sharp(maskBuffer)
        .extractChannel('alpha')
        .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
        .threshold(8)
        .png()
        .toBuffer();
      const soft = await featherMask(hard, 0.3);

      const { raw, width, height } = await toRawGray(hard);
      const { A, P } = areaPerimeterFromRaw({ raw, width, height });
      const t = thicknessFromAP(A, P);
      const areaRatio = A / (skinW * skinH);

      console.log(`[MASK] Strategy=alpha | A=${A} areaRatio=${areaRatio.toFixed(6)} t=${t.toFixed(4)}`);
      return { hard, soft, A, P, t, areaRatio, width, height, strategy: 'alpha' };
    } else {
      console.log('[MASK] Alpha not informative (empty or full) → try luminance.');
    }
  }

  // 2) LUMA path
  const gray = await sharp(maskBuffer)
    .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
    .grayscale()
    .toBuffer();
  const bin = await sharp(gray).threshold(128).png().toBuffer();
  const inv = await sharp(gray).linear(-1, 255).threshold(128).png().toBuffer();

  const areaImg = skinW * skinH;
  const a1 = await areaFromMaskPng(bin);
  const a2 = await areaFromMaskPng(inv);
  const r1 = a1 / areaImg;
  const r2 = a2 / areaImg;
  console.log(`[MASK] Luma areas: r1=${r1.toFixed(6)} r2=${r2.toFixed(6)}`);

  const meta2 = await sharp(maskBuffer).metadata();
  if (meta2.hasAlpha && (r1 <= EXT_LOW || r1 >= EXT_HIGH || r2 <= EXT_LOW || r2 >= EXT_HIGH)) {
    console.log('[MASK] Luma extreme. Falling back to alpha-sparse.');
    const hard = await sharp(maskBuffer)
      .extractChannel('alpha')
      .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
      .threshold(8)
      .png()
      .toBuffer();
    const soft = await featherMask(hard, 0.3);
    const { raw, width, height } = await toRawGray(hard);
    const { A, P } = areaPerimeterFromRaw({ raw, width, height });
    const t = thicknessFromAP(A, P);
    const areaRatio = A / (skinW * skinH);
    console.log(`[MASK] Strategy=alpha-sparse | A=${A} areaRatio=${areaRatio.toFixed(6)} t=${t.toFixed(4)}`);
    return { hard, soft, A, P, t, areaRatio, width, height, strategy: 'alpha-sparse' };
  }

  const ok1 = r1 >= EXT_LOW && r1 <= 0.95;
  const ok2 = r2 >= EXT_LOW && r2 <= 0.95;
  let hard = (ok1 && (!ok2 || r1 <= r2)) ? bin : inv;
  let strategy = (hard === bin) ? 'luma' : 'luma-inv';

  const soft = await featherMask(hard, 0.3);
  const { raw, width, height } = await toRawGray(hard);
  const { A, P } = areaPerimeterFromRaw({ raw, width, height });
  const t = thicknessFromAP(A, P);
  const areaRatio = A / (skinW * skinH);
  console.log(`[MASK] Strategy=${strategy} | A=${A} areaRatio=${areaRatio.toFixed(6)} t=${t.toFixed(4)}`);

  return { hard, soft, A, P, t, areaRatio, width, height, strategy };
}

/* ============================== Core ============================== */

const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    if (!REMOVE_BG_API_KEY) {
      console.warn('[remove.bg] key not set → using original PNG');
      return sharp(imageBuffer).png().toBuffer();
    }
    try {
      const formData = new FormData();
      formData.append('image_file', new Blob([imageBuffer], { type: 'image/png' }), 'tattoo_design.png');
      formData.append('size', 'auto');
      formData.append('format', 'png');

      const res = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
        headers: { 'X-Api-Key': REMOVE_BG_API_KEY, ...formData.getHeaders() },
        responseType: 'arraybuffer'
      });
      if (res.status === 200) return Buffer.from(res.data);
      throw new Error(`remove.bg ${res.status}`);
    } catch (e) {
      console.warn('[remove.bg] failed:', e.message, '— using original PNG');
      return sharp(imageBuffer).png().toBuffer();
    }
  },

  applyWatermark: async (imageBuffer) => {
    try {
      const watermarkText = 'SkinTip.AI';
      const svg = Buffer.from(
        `<svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
          <text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" fill-opacity="0.5">${watermarkText}</text>
        </svg>`
      );
      const { width, height } = await sharp(imageBuffer).metadata();
      const left = Math.max(0, width - 200 - 15);
      const top = Math.max(0, height - 30 - 15);

      return sharp(imageBuffer).composite([{ input: svg, left, top, blend: 'over' }]).png().toBuffer();
    } catch (e) {
      console.error('[WATERMARK] error:', e.message);
      return imageBuffer;
    }
  },

  /**
   * Verifies public URL; if not reachable, returns signed URL fallback.
   */
  uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
    const path = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;

    const { error: upErr } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(path, imageBuffer, {
        contentType,
        upsert: false,
        cacheControl: '3600',
      });

    if (upErr) {
      console.error('Supabase upload error:', upErr);
      throw new Error(`Failed to upload image to storage: ${upErr.message}`);
    }

    // Get the nominal public URL
    const { data: pub } = supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(path);

    let url = pub?.publicUrl || null;
    console.log('[UPLOAD] tentative publicUrl:', url);

    // Verify reachability; if not 2xx, create a signed URL fallback
    try {
      if (!url) throw new Error('No publicUrl returned');
      const head = await axios.head(url, { validateStatus: () => true });
      if (head.status < 200 || head.status >= 300) {
        throw new Error(`HEAD ${head.status}`);
      }
    } catch (e) {
      console.warn('[UPLOAD] publicUrl not accessible → creating signed URL fallback:', e.message);
      const { data: signed, error: signErr } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 days
      if (signErr || !signed?.signedUrl) {
        throw new Error(`Failed to create signed URL: ${signErr?.message || 'unknown error'}`);
      }
      url = signed.signedUrl;
    }

    console.log('[UPLOAD] final URL for client:', url);
    return url;
  },

  /**
   * Geometry-safe pipeline + FLUX engine flag + 20% scale-up for model.
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
    console.log(`[ENGINE] FLUX_ENGINE=${FLUX_ENGINE} | MODEL_SCALE_UP=${MODEL_SCALE_UP}`);

    // --- Canonicalize inputs ---
    const skinMeta = await sharp(skinImageBuffer).metadata();
    const skinW = skinMeta.width, skinH = skinMeta.height;
    console.log(`[INIT] Skin=${skinW}x${skinH}`);

    const maskOriginal = Buffer.from(maskBase64, 'base64');
    await uploadDebug(maskOriginal, `mask_original_${uuidv4()}.png`, userId);

    // Smart mask
    const { hard: maskHardPngSkinSize, soft: maskSoftPngSkinSize, A, P, t, areaRatio, width: mw, height: mh, strategy } =
      await buildSmartMask(maskOriginal, skinW, skinH);
    await uploadDebug(maskHardPngSkinSize, `mask_hard_${strategy}_${uuidv4()}.png`, userId);
    await uploadDebug(maskSoftPngSkinSize, `mask_soft_${strategy}_${uuidv4()}.png`, userId);

    if (A < 40) {
      throw new Error('Mask too small. Please draw a larger area for the tattoo.');
    }

    // Initial adaptive dilation for model region
    const k = 40, k2 = 8, rmin = 1, rmax = 36; // rmax bumped to allow growth coverage
    let r_model = Math.max(rmin, Math.min(rmax, Math.round(k * Math.sqrt(Math.max(1e-9, areaRatio)) + k2 * (1 - t))));
    console.log(`[DILATION] initial r_model=${r_model}`);

    // Build model mask (initial)
    let maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r_model);
    let areaModel = (await areaFromMaskPng(maskForModelHard)) / (skinW * skinH);
    if (areaModel > 0.25) {
      const scale = Math.max(0.2, Math.sqrt(0.25 / areaModel));
      const r2 = Math.max(1, Math.round(r_model * scale));
      console.log(`[DILATION] area too large (${(areaModel*100).toFixed(2)}%), reducing r_model → ${r2}`);
      r_model = r2;
      maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r_model);
      areaModel = (await areaFromMaskPng(maskForModelHard)) / (skinW * skinH);
    }
    let maskForModelSoft = await featherMask(maskForModelHard, 0.3);
    await uploadDebug(maskForModelHard, `mask_for_model_hard_r${r_model}_${uuidv4()}.png`, userId);

    // --- Tattoo design prep & deterministic placement (with +20% scale-up) ---
    const tattooOriginal = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooPng = await fluxPlacementHandler.removeImageBackground(tattooOriginal);
    const tatMeta = await sharp(tattooOriginal).metadata();
    console.log(`[PLACE] TattooDesign=${tatMeta.width}x${tatMeta.height}`);

    // BBox from mask (skin space)
    let minX = mw, minY = mh, maxX = -1, maxY = -1;
    const { raw: mraw } = await toRawGray(maskHardPngSkinSize);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (mraw[y * mw + x] > 127) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) throw new Error('Empty bbox from mask.');
    const bboxW = maxX - minX + 1, bboxH = maxY - minY + 1;
    console.log(`[PLACE] BBOX(skin): x=${minX}, y=${minY}, w=${bboxW}, h=${bboxH}`);

    // Scale up by 2
