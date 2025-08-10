// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-10_DIAG_V1');

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

// Debug uploads toggle (default ON)
const DEBUG_UPLOADS = (process.env.DEBUG_UPLOADS ?? '1') !== '0';

// ---- remove.bg ----
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;

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

/** Dilate a hard mask by integer radius (≤18). */
async function dilateHardMask(hardMaskPng, radiusPx) {
  const r = Math.max(0, Math.min(18, Math.round(radiusPx)));
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

/** Build a smart hard mask (0/255), choose ALPHA vs LUMA automatically & polarity by area.
 *  Also returns diagnostics.
 */
async function buildSmartMask(maskBuffer, skinW, skinH) {
  const meta = await sharp(maskBuffer).metadata();
  console.log(`[MASK] Input meta: ${meta.width}x${meta.height}, hasAlpha=${!!meta.hasAlpha}, channels=${meta.channels}`);

  // Try ALPHA path if alpha exists
  let chosen = null;
  let strategy = 'none';
  if (meta.hasAlpha) {
    const alpha = await sharp(maskBuffer).extractChannel('alpha')
      .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
      .raw()
      .toBuffer();
    let sum = 0, nz = 0, minA = 255, maxA = 0;
    for (let i = 0; i < alpha.length; i++) {
      const v = alpha[i];
      sum += v;
      if (v > 0) nz++;
      if (v < minA) minA = v;
      if (v > maxA) maxA = v;
    }
    const mean = sum / alpha.length;
    const percentNonZero = nz / alpha.length;
    console.log(`[MASK] Alpha stats: mean=${mean.toFixed(2)} nz%=${(percentNonZero*100).toFixed(2)} min=${minA} max=${maxA}`);

    // If alpha is informative (not ~0% and not ~100% everywhere), use it.
    if (percentNonZero > 0.01 && percentNonZero < 0.95) {
      chosen = await sharp(maskBuffer)
        .extractChannel('alpha')
        .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
        .threshold(8)
        .png()
        .toBuffer();
      strategy = 'alpha';
    } else {
      console.log('[MASK] Alpha not informative → falling back to luminance.');
    }
  }

  // LUMA path (if we didn’t pick alpha)
  if (!chosen) {
    const gray = await sharp(maskBuffer)
      .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
      .grayscale()
      .toBuffer();
    const bin = await sharp(gray).threshold(128).png().toBuffer();
    const inv = await sharp(gray).linear(-1, 255).threshold(128).png().toBuffer();
    const a1 = await areaFromMaskPng(bin);
    const a2 = await areaFromMaskPng(inv);
    const areaImg = skinW * skinH;
    const r1 = a1 / areaImg;
    const r2 = a2 / areaImg;

    // Prefer the polarity with smaller but non-trivial area (avoid "all white" or "all black")
    const pickInv = (r2 <= 0.90 && r2 >= 0.00005 && (r2 < r1 || r1 > 0.90 || r1 < 0.00005));
    chosen = pickInv ? inv : bin;
    strategy = `luma${pickInv ? '-inv' : ''}`;
    console.log(`[MASK] Luma areas: r1=${r1.toFixed(6)} r2=${r2.toFixed(6)} → strategy=${strategy}`);
  }

  const hard = chosen;
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

  uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
    const path = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(path, imageBuffer, { contentType, upsert: false });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    const { data } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('No public URL from Supabase.');
    console.log('[UPLOAD] →', data.publicUrl);
    return data.publicUrl;
  },

  /**
   * Diagnostic-first, geometry-safe pipeline.
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
    // --- Canonicalize inputs ---
    const skinMeta = await sharp(skinImageBuffer).metadata();
    const skinW = skinMeta.width, skinH = skinMeta.height;
    console.log(`[INIT] Skin=${skinW}x${skinH}`);

    const maskOriginal = Buffer.from(maskBase64, 'base64');
    await uploadDebug(maskOriginal, `mask_original_${uuidv4()}.png`, userId);

    // Build smart mask (logs inside)
    const { hard: maskHardPngSkinSize, soft: maskSoftPngSkinSize, A, P, t, areaRatio, width: mw, height: mh, strategy } =
      await buildSmartMask(maskOriginal, skinW, skinH);
    await uploadDebug(maskHardPngSkinSize, `mask_hard_${strategy}_${uuidv4()}.png`, userId);
    await uploadDebug(maskSoftPngSkinSize, `mask_soft_${strategy}_${uuidv4()}.png`, userId);

    if (A < 40) {
      throw new Error('Mask too small. Please draw a larger area for the tattoo.');
    }

    // Adaptive dilation for the model’s editable region (r_model)
    const k = 40, k2 = 8, rmin = 1, rmax = 18;
    let r_model = Math.max(rmin, Math.min(rmax, Math.round(k * Math.sqrt(Math.max(1e-9, areaRatio)) + k2 * (1 - t))));
    console.log(`[DILATION] initial r_model=${r_model}`);

    // Build model mask, clamp if it balloons to cover too much (>25% of image)
    let maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r_model);
    let areaModel = (await areaFromMaskPng(maskForModelHard)) / (skinW * skinH);
    if (areaModel > 0.25) {
      const scale = Math.max(0.2, Math.sqrt(0.25 / areaModel)); // pull back
      const r2 = Math.max(1, Math.round(r_model * scale));
      console.log(`[DILATION] area too large (${(areaModel*100).toFixed(2)}%), reducing r_model → ${r2}`);
      r_model = r2;
      maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r_model);
      areaModel = (await areaFromMaskPng(maskForModelHard)) / (skinW * skinH);
    }
    const maskForModelSoft = await featherMask(maskForModelHard, 0.3);
    await uploadDebug(maskForModelHard, `mask_for_model_hard_r${r_model}_${uuidv4()}.png`, userId);

    // --- Tattoo design prep & deterministic placement ---
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

    const targetW = Math.max(1, Math.round(bboxW * tattooScale));
    const targetH = Math.max(1, Math.round(bboxH * tattooScale));

    const resizedTattoo = await sharp(tattooPng)
      .resize({ width: targetW, height: targetH, fit: sharp.fit.inside, kernel: sharp.kernel.lanczos3 })
      .toBuffer();
    const rotatedTattoo = await sharp(resizedTattoo)
      .rotate(tattooAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const rotMeta = await sharp(rotatedTattoo).metadata();

    const left = Math.round(minX + (bboxW - rotMeta.width) / 2);
    const top  = Math.round(minY + (bboxH - rotMeta.height) / 2);

    const tattooCanvasPlaced = await sharp({
      create: { width: skinW, height: skinH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([{ input: rotatedTattoo, left, top }])
      .png()
      .toBuffer();
    await uploadDebug(tattooCanvasPlaced, `tattoo_canvas_placed_${uuidv4()}.png`, userId);

    // ORIGINAL silhouette (exact geometry)
    let originalSilhouette = await sharp(tattooCanvasPlaced)
      .composite([{ input: maskHardPngSkinSize, blend: 'dest-in' }])
      .png()
      .toBuffer();
    await uploadDebug(originalSilhouette, `original_silhouette_${uuidv4()}.png`, userId);

    // --- Build input image for the model (prefill & line art) ---
    // Prefill strength: if model mask covers a lot (>10%), drop prefill to avoid global darkening
    const prefillOpacity = areaModel > 0.10 ? 0.0 : 0.8;
    console.log(`[PREFILL] areaModel=${(areaModel*100).toFixed(2)}% opacity=${prefillOpacity}`);

    let inputImageForModel = skinImageBuffer;
    if (prefillOpacity > 0) {
      const prefill = await sharp({ create: { width: skinW, height: skinH, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } } })
        .png()
        .toBuffer();
      const prefillShaped = await sharp(prefill).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();
      const tattooWithinModelMask = await sharp(tattooCanvasPlaced).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();

      inputImageForModel = await sharp(skinImageBuffer)
        .composite([
          { input: prefillShaped, blend: 'multiply', opacity: prefillOpacity },
          { input: tattooWithinModelMask, blend: 'over', opacity: 0.95 }
        ])
        .png()
        .toBuffer();
    } else {
      // no prefill – still include line art within model mask
      const tattooWithinModelMask = await sharp(tattooCanvasPlaced).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();
      inputImageForModel = await sharp(skinImageBuffer)
        .composite([{ input: tattooWithinModelMask, blend: 'over', opacity: 0.95 }])
        .png()
        .toBuffer();
    }
    await uploadDebug(inputImageForModel, `input_for_model_${uuidv4()}.png`, userId);

    // --- FLUX calls (constrained) ---
    const generatedImageUrls = [];
    const basePrompt =
      "Preserve the exact silhouette, linework, proportions and interior details of the tattoo. Only relight and blend the existing tattoo into the skin. Add realistic lighting, micro-shadowing, slight ink diffusion, and subtle skin texture. Do not redraw or restyle.";
    const negativePrompt =
      "re-sketch, new lines, restyle, warp, change shape, extra elements, animals, octopus, figurative art, glow, blur, smoothing edges, color shift";

    console.log(`[FLUX] Calling ${numVariations}×, each n=3`);

    for (let i = 0; i < numVariations; i++) {
      const currentSeed = Date.now() + i;

      const payload = {
        prompt: basePrompt,
        negative_prompt: negativePrompt,
        input_image: inputImageForModel.toString('base64'),
        mask_image: (await sharp(maskForModelHard).png().toBuffer()).toString('base64'),
        n: 3,
        output_format: 'png',
        fidelity: 0.8,
        guidance_scale: 3.0,
        prompt_upsampling: false,
        safety_tolerance: 2,
        seed: currentSeed
      };

      const headers = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
      let post;
      try {
        post = await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', payload, { headers, timeout: 120000 });
        console.log(`[FLUX] POST status #${i + 1}:`, post.status);
      } catch (e) {
        console.error('[FLUX] POST failed:', e.response?.data || e.message);
        continue;
      }

      const taskId = post.data?.id;
      const polling = post.data?.polling_url;
      if (!taskId || !polling) { console.warn('[FLUX] Missing task/polling'); continue; }

      let tries = 0, done = false;
      while (tries < 60 && !done) {
        tries++;
        await new Promise(r => setTimeout(r, 2000));
        const pol = await axios.get(polling, { headers: { 'x-key': fluxApiKey }, timeout: 15000 });
        if (pol.data?.status === 'Ready') {
          const r = pol.data.result || {};
          const urls = [];
          if (typeof r.sample === 'string') urls.push(r.sample);
          if (Array.isArray(r.samples)) urls.push(...r.samples.filter(s => typeof s === 'string'));
          if (Array.isArray(r.images)) urls.push(...r.images.filter(s => typeof s === 'string'));
          if (Array.isArray(r.output)) urls.push(...r.output.filter(s => typeof s === 'string'));

          // ---- POST-PROCESS (adaptive clamp + base-ink floor) ----
          const TAU = 0.05; // thinness reference
          const r_final = Math.max(1, Math.min(6, Math.round(1 + 10 * Math.max(0, TAU - t))));
          console.log(`[CLAMP] r_final=${r_final} (t=${t.toFixed(4)})`);

          const silhouetteHard = await sharp(originalSilhouette).threshold(8).png().toBuffer();
          const clampMaskHard = await dilateHardMask(silhouetteHard, r_final);
          const clampMaskSoft = await featherMask(clampMaskHard, 0.3);
          await uploadDebug(clampMaskHard, `clamp_mask_r${r_final}_${uuidv4()}.png`, userId);

          for (const u of urls) {
            try {
              const img = await axios.get(u, { responseType: 'arraybuffer' });
              let out = Buffer.from(img.data);

              // Normalize to skin size BEFORE clamp
              out = await sharp(out).resize({ width: skinW, height: skinH, fit: 'fill' }).png().toBuffer();

              // strict clamp with adaptive epsilon
              const clamped = await sharp(out)
                .composite([{ input: clampMaskSoft, blend: 'dest-in' }])
                .png()
                .toBuffer();

              // base ink floor inside clamp
              const darkFill = await sharp({ create: { width: skinW, height: skinH, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } } })
                .png()
                .toBuffer();
              const darkFillShaped = await sharp(darkFill).composite([{ input: clampMaskSoft, blend: 'dest-in' }]).png().toBuffer();

              const finalComp = await sharp(skinImageBuffer)
                .composite([
                  { input: darkFillShaped, blend: 'multiply', opacity: 0.65 },
                  { input: clamped, blend: 'over', premultiplied: true },
                  { input: originalSilhouette, blend: 'overlay', opacity: 0.25 }
                ])
                .png()
                .toBuffer();

              await uploadDebug(finalComp, `final_preview_${uuidv4()}.png`, userId);

              const watermarked = await fluxPlacementHandler.applyWatermark(finalComp);
              const url = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, `tattoo-${uuidv4()}.png`, userId, '', 'image/png');
              generatedImageUrls.push(url);
            } catch (e) {
              console.error('[FINAL] postprocess/upload error:', e.message);
            }
          }
          done = true;
        } else if (pol.data?.status === 'Content Moderated') {
          console.warn('[FLUX] moderation:', pol.data?.details || '');
          done = true;
        } else if (pol.data?.status === 'Error') {
          console.error('[FLUX] polling error:', pol.data);
          done = true;
        }
      }

      if (!done) console.warn('[FLUX] polling timeout');
    }

    if (generatedImageUrls.length === 0) {
      throw new Error('Flux API: no images generated.');
    }

    console.log(`[FINAL] Generated ${generatedImageUrls.length} image(s).`);
    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
