// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-10_RUGGED_PIPELINE_V4');

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

/** Build a hard binary mask (0/255) preferring ALPHA channel; fallback to luminance with polarity choice. */
async function toHardMaskPngAlphaFirst(buffer, { width, height } = {}) {
  const meta = await sharp(buffer).metadata();

  if (meta.hasAlpha) {
    return sharp(buffer)
      .extractChannel('alpha')
      .resize({ width: width ?? meta.width, height: height ?? meta.height, fit: 'fill', kernel: sharp.kernel.nearest })
      .threshold(8)
      .png()
      .toBuffer();
  }

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

/** Feather for soft edges. */
async function featherMask(maskPng, sigma = 0.3) {
  return sharp(maskPng).blur(sigma).png().toBuffer();
}

/** Raw single-channel gray. */
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

/* ============================== Core ============================== */

const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    if (!REMOVE_BG_API_KEY) {
      console.warn('REMOVE_BG_API_KEY not set. Using original PNG.');
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
   * Geometry-preserving, model-agnostic placement + constrained edit.
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
    const maskHardPngSkinSize = await toHardMaskPngAlphaFirst(maskOriginal, { width: skinW, height: skinH }); // binary 0/255
    const maskSoftPngSkinSize = await featherMask(maskHardPngSkinSize, 0.3); // gentle feather

    // Metrics
    const { raw: mraw, width: mw, height: mh } = await toRawGray(maskHardPngSkinSize);
    let { A, P } = areaPerimeterFromRaw({ raw: mraw, width: mw, height: mh });
    const t = thicknessFromAP(A, P);
    const areaRatio = A / (skinW * skinH);
    console.log(`MASK metrics: A=${A}, P=${P}, t=${t.toFixed(4)}, areaRatio=${areaRatio.toFixed(6)}`);

    if (A < 40) {
      throw new Error('Mask too small. Please draw a larger area for the tattoo.');
    }

    // Adaptive dilation for the model’s editable region (r_model)
    const k = 40, k2 = 8, rmin = 1, rmax = 18;
    const r_model = Math.max(rmin, Math.min(rmax, Math.round(k * Math.sqrt(Math.max(1e-9, areaRatio)) + k2 * (1 - t))));
    console.log(`Adaptive r_model=${r_model}px`);

    const maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r_model);
    const maskForModelSoft = await featherMask(maskForModelHard, 0.3);

    // --- Tattoo design prep & deterministic placement ---
    const tattooOriginal = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooPng = await fluxPlacementHandler.removeImageBackground(tattooOriginal);

    // BBox from mask (skin space)
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

    // ORIGINAL silhouette (exact geometry)
    let originalSilhouette = await sharp(tattooCanvasPlaced)
      .composite([{ input: maskHardPngSkinSize, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // ---  Build input image for the model (prefill & line art) ---
    // Stronger prefill so the model “sees ink” on light skin.
    const prefill = await sharp({ create: { width: skinW, height: skinH, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } } })
      .png()
      .toBuffer();
    const prefillShaped = await sharp(prefill).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();
    const tattooWithinModelMask = await sharp(tattooCanvasPlaced).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer();

    const inputImageForModel = await sharp(skinImageBuffer)
      .composite([
        { input: prefillShaped, blend: 'multiply', opacity: 0.8 },       // <-- stronger than overlay
        { input: tattooWithinModelMask, blend: 'over', opacity: 0.95 }   // <-- include actual line art
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
        guidance_scale: 3.0,        // slightly higher for lines, still conservative
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

          // ---- POST-PROCESS (adaptive r_final + base ink floor) ----
          // Compute adaptive final clamp radius from thickness
          const TAU = 0.05; // threshold-ish for “thin”
          const r_final = Math.max(1, Math.min(6, Math.round(1 + 10 * Math.max(0, TAU - t))));
          console.log(`Adaptive r_final=${r_final}px`);

          // Build clamp mask from the original silhouette alpha, dilated by r_final
          const silhouetteHard = await toHardMaskPngAlphaFirst(originalSilhouette);
          const clampMaskHard = await dilateHardMask(silhouetteHard, r_final);
          const clampMaskSoft = await featherMask(clampMaskHard, 0.3);

          for (const u of urls) {
            try {
              const img = await axios.get(u, { responseType: 'arraybuffer' });
              let out = Buffer.from(img.data);

              // normalize to skin size BEFORE clamp
              out = await sharp(out).resize({ width: skinW, height: skinH, fit: 'fill' }).png().toBuffer();

              // strict clamp with adaptive epsilon
              const clamped = await sharp(out)
                .composite([{ input: clampMaskSoft, blend: 'dest-in' }])
                .png()
                .toBuffer();

              // base ink floor inside the same clamp (prevents vanishing)
              const darkFill = await sharp({ create: { width: skinW, height: skinH, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } } })
                .png()
                .toBuffer();
              const darkFillShaped = await sharp(darkFill)
                .composite([{ input: clampMaskSoft, blend: 'dest-in' }])
                .png()
                .toBuffer();

              // final composite on skin: base ink (multiply) → clamped FLUX → crisp edges
              const finalComp = await sharp(skinImageBuffer)
                .composite([
                  { input: darkFillShaped, blend: 'multiply', opacity: 0.65 },
                  { input: clamped, blend: 'over', premultiplied: true },
                  { input: originalSilhouette, blend: 'overlay', opacity: 0.25 }
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
