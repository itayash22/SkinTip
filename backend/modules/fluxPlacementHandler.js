// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-10_RUGGED_PIPELINE_V3_ALPHA_MASK');

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

// ---- remove.bg ----
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;

/* ============================== Helpers ============================== */

/** Build a **hard binary mask** (0/255) prioritizing ALPHA channel if present.
 *  If no alpha, auto-choose between luminance and inverted luminance.
 *  Always returned as PNG, single-channel. Optional resize preserves geometry.
 */
async function toHardMaskPngAlphaFirst(buffer, { width, height } = {}) {
  const meta = await sharp(buffer).metadata();

  // Build from ALPHA if available (common case for a transparent canvas with black stroke)
  if (meta.hasAlpha) {
    const m = await sharp(buffer)
      .extractChannel('alpha')
      .resize({ width: width ?? meta.width, height: height ?? meta.height, fit: 'fill', kernel: sharp.kernel.nearest })
      .threshold(8)                     // anything with alpha > 8 becomes mask=white
      .png()
      .toBuffer();
    return m;
  }

  // Otherwise, use luminance and pick polarity with larger area
  const gray = await sharp(buffer)
    .resize({ width: width ?? meta.width, height: height ?? meta.height, fit: 'fill', kernel: sharp.kernel.nearest })
    .grayscale()
    .toBuffer();

  const bin = await sharp(gray).threshold(128).png().toBuffer();
  const inv = await sharp(gray).linear(-1, 255).threshold(128).png().toBuffer();

  const a1 = await areaFromMaskPng(bin);
  const a2 = await areaFromMaskPng(inv);
  return a2 > a1 ? inv : bin;
}

/** Slight Gaussian feather for soft mask edges. */
async function featherMask(maskPng, sigma = 1.0) {
  return sharp(maskPng).blur(sigma).png().toBuffer();
}

/** Read raw single-channel 8-bit from a PNG (grayscale). */
async function toRawGray(buffer) {
  const meta = await sharp(buffer).metadata();
  const raw = await sharp(buffer).grayscale().raw().toBuffer();
  return { raw, width: meta.width, height: meta.height };
}

/** Count white pixels (>127) in a single-channel buffer. */
async function areaFromMaskPng(maskPng) {
  const { raw } = await toRawGray(maskPng);
  let A = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] > 127) A++;
  return A;
}

/** Compute area & 4-neighbor perimeter from hard mask (0/255). */
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

/** Thickness metric: t = 4πA / P^2  (≈0 hairline, →1 solid) */
function thicknessFromAP(A, P) {
  if (P <= 0) return 0;
  return Math.max(0, Math.min(1, (4 * Math.PI * A) / (P * P)));
}

/** Adaptive dilation of a hard mask by integer radius r (≤18). */
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

/* ============================== Core ============================== */

const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    if (!REMOVE_BG_API_KEY) {
      console.warn('REMOVE_BG_API_KEY not set. Using original image as PNG.');
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
      console.warn('remove.bg failed:', e.message, '— using original PNG.');
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
      console.error('Watermark error:', e.message);
      return imageBuffer;
    }
  },

  uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
    const path = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(path, imageBuffer, { contentType, upsert: false });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    const { data } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('No public URL from Supabase.');
    console.log('Image uploaded to Supabase:', data.publicUrl);
    return data.publicUrl;
  },

  /**
   * Robust, geometry-preserving pipeline.
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
    console.log(`Skin Image Dims: ${skinW}x${skinH}`);

    const maskOriginal = Buffer.from(maskBase64, 'base64');
    const maskMeta = await sharp(maskOriginal).metadata();
    console.log(`Mask Meta: ${maskMeta.width}x${maskMeta.height}, hasAlpha=${!!maskMeta.hasAlpha}, channels=${maskMeta.channels}`);

    // Build skin-sized hard mask (alpha-first); soft mask for blending
    let maskHardPngSkinSize = await toHardMaskPngAlphaFirst(maskOriginal, { width: skinW, height: skinH });
    let maskSoftPngSkinSize = await featherMask(maskHardPngSkinSize, 1.0);

    // Metrics
    const { raw: mraw, width: mw, height: mh } = await toRawGray(maskHardPngSkinSize);
    let { A, P } = areaPerimeterFromRaw({ raw: mraw, width: mw, height: mh });

    // If area still zero (rare), try inverted luminance as last resort
    if (A === 0) {
      console.warn('Mask area is zero after alpha-first. Trying luminance polarity fallback.');
      const gray = await sharp(maskOriginal)
        .resize({ width: skinW, height: skinH, fit: 'fill', kernel: sharp.kernel.nearest })
        .grayscale()
        .toBuffer();
      const bin = await sharp(gray).threshold(128).png().toBuffer();
      const inv = await sharp(gray).linear(-1, 255).threshold(128).png().toBuffer();
      const a1 = await areaFromMaskPng(bin);
      const a2 = await areaFromMaskPng(inv);
      maskHardPngSkinSize = a2 > a1 ? inv : bin;
      maskSoftPngSkinSize = await featherMask(maskHardPngSkinSize, 1.0);
      const rr = await toRawGray(maskHardPngSkinSize);
      A = areaPerimeterFromRaw(rr).A;
      P = areaPerimeterFromRaw(rr).P;
    }

    const t = thicknessFromAP(A, P);
    const areaRatio = A / (skinW * skinH);
    console.log(`MASK metrics: A=${A}, P=${P}, t=${t.toFixed(4)}, areaRatio=${areaRatio.toFixed(6)}`);

    if (A < 40) {
      throw new Error('Mask too small. Please draw a larger area for the tattoo.');
    }

    // Adaptive dilation for the model’s edit region
    const k = 40, k2 = 8, rmin = 1, rmax = 18;
    const r = Math.max(rmin, Math.min(rmax, Math.round(k * Math.sqrt(Math.max(1e-9, areaRatio)) + k2 * (1 - t))));
    console.log(`Adaptive dilation radius r=${r}px`);

    const maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r);
    const maskForModelSoft = await featherMask(maskForModelHard, 1.2);

    // --- Tattoo design prep & deterministic placement ---
    const tattooOriginal = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooPng = await fluxPlacementHandler.removeImageBackground(tattooOriginal);
    const tatMeta = await sharp(tattooOriginal).metadata();
    console.log(`Tattoo Design Dims: ${tatMeta.width}x${tatMeta.height}`);

    // bbox from hard mask (skin space)
    let minX = mw, minY = mh, maxX = -1, maxY = -1;
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

    // Original silhouette for final clamp
    let originalSilhouette = await sharp(tattooCanvasPlaced)
      .composite([{ input: maskHardPngSkinSize, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // If silhouette empty (shouldn’t happen now), try invert once then minimal widen
    const { raw: silRaw } = await toRawGray(originalSilhouette);
    let sum = 0; for (let i = 0; i < silRaw.length; i++) sum += silRaw[i];
    if (sum < 1) {
      console.warn('Original silhouette empty. Trying invert→ε-widen.');
      const inverted = await sharp(maskHardPngSkinSize).linear(-1, 255).png().toBuffer();
      let retry = await sharp(tattooCanvasPlaced).composite([{ input: inverted, blend: 'dest-in' }]).png().toBuffer();
      const { raw: r2 } = await toRawGray(retry);
      let s2 = 0; for (let i = 0; i < r2.length; i++) s2 += r2[i];
      if (s2 < 1) {
        const widened = await dilateHardMask(maskHardPngSkinSize, 1);
        retry = await sharp(tattooCanvasPlaced).composite([{ input: widened, blend: 'dest-in' }]).png().toBuffer();
      }
      originalSilhouette = retry;
    }

    // --- Build input image for the model (prefill + soft blend) ---
    const prefill = await sharp({ create: { width: skinW, height: skinH, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } } })
      .png()
      .toBuffer();
    const prefillShaped = await sharp(prefill).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();
    const tattooWithinModelMask = await sharp(tattooCanvasPlaced).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();

    const inputImageForModel = await sharp(skinImageBuffer)
      .composite([
        { input: prefillShaped, blend: 'overlay', opacity: 0.65 },
        { input: tattooWithinModelMask, blend: 'over', opacity: 0.85 }
      ])
      .png()
      .toBuffer();

    // --- FLUX calls (constrained) ---
    const generatedImageUrls = [];
    const basePrompt =
      "Preserve the exact silhouette, linework, proportions and interior details of the tattoo. Only relight and blend the existing tattoo into the skin. Add realistic lighting, micro-shadowing, slight ink diffusion, and subtle skin texture. Do not redraw or restyle.";
    const negativePrompt =
      "re-sketch, new lines, restyle, warp, change shape, extra elements, animals, octopus, figurative art, glow, blur, smoothing edges, color shift";

    console.log(`Making ${numVariations} calls to Flux API...`);

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
        guidance_scale: 2.3,
        prompt_upsampling: false,
        safety_tolerance: 2,
        seed: currentSeed
      };

      const headers = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
      let post;
      try {
        post = await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', payload, { headers, timeout: 120000 });
        console.log(`DEBUG: POST status v${i + 1}:`, post.status);
      } catch (e) {
        console.error('Flux POST failed:', e.response?.data || e.message);
        continue;
      }

      const taskId = post.data?.id;
      const polling = post.data?.polling_url;
      if (!taskId || !polling) { console.warn('Missing task/polling'); continue; }

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

          for (const u of urls) {
            try {
              const img = await axios.get(u, { responseType: 'arraybuffer' });
              let out = Buffer.from(img.data);

              // normalize to skin size
              out = await sharp(out).resize({ width: skinW, height: skinH, fit: 'fill' }).png().toBuffer();

              // strict clamp with original silhouette (+small feather)
              const clamped = await sharp(out)
                .composite([{ input: await featherMask(originalSilhouette, 1.0), blend: 'dest-in' }])
                .png()
                .toBuffer();

              // final composite on skin
              const finalComp = await sharp(skinImageBuffer)
                .composite([
                  { input: clamped, blend: 'over', premultiplied: true },
                  { input: originalSilhouette, blend: 'overlay', opacity: 0.30 }
                ])
                .png()
                .toBuffer();

              const watermarked = await fluxPlacementHandler.applyWatermark(finalComp);
              const url = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, `tattoo-${uuidv4()}.png`, userId, '', 'image/png');
              generatedImageUrls.push(url);
            } catch (e) {
              console.error('Postprocess/upload error:', e.message);
            }
          }
          done = true;
        } else if (pol.data?.status === 'Content Moderated') {
          console.warn('Flux moderation:', pol.data?.details || '');
          done = true;
        } else if (pol.data?.status === 'Error') {
          console.error('Flux error during polling:', pol.data);
          done = true;
        }
      }

      if (!done) console.warn('Flux polling timeout.');
    }

    if (generatedImageUrls.length === 0) {
      throw new Error('Flux API: no images generated.');
    }

    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
