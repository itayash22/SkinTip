// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-10_RUGGED_PIPELINE_V2'); // wide, geometry-safe pipeline

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key (backend only)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';

// Remove.bg API
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;

/* ------------------------- helpers (metrics & masks) ------------------------ */

/** threshold to hard binary (0/255) */
async function toHardMaskPng(buffer, { width, height } = {}) {
  let pipe = sharp(buffer).grayscale();
  if (width && height) pipe = pipe.resize({ width, height, fit: 'fill' });
  return pipe
    .threshold(128)        // binarize
    .png()
    .toBuffer();
}

/** read raw 8-bit gray (1 channel) */
async function toRawGray(buffer) {
  const meta = await sharp(buffer).metadata();
  const raw = await sharp(buffer).grayscale().raw().toBuffer();
  return { raw, width: meta.width, height: meta.height };
}

/** compute area (#white pixels) and 4-neighbor perimeter from hard mask (0/255) */
function areaPerimeterFromRaw({ raw, width, height }) {
  let A = 0;
  let P = 0;
  const idx = (x, y) => y * width + x;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = raw[idx(x, y)] > 127;
      if (!on) continue;
      A++;
      // perimeter if any 4-neighbor is off or out of bounds
      if (x === 0 || raw[idx(x - 1, y)] <= 127) P++;
      if (x === width - 1 || raw[idx(x + 1, y)] <= 127) P++;
      if (y === 0 || raw[idx(x, y - 1)] <= 127) P++;
      if (y === height - 1 || raw[idx(x, y + 1)] <= 127) P++;
    }
  }
  return { A, P };
}

/** continuous thickness metric: t = 4πA / P^2 (0=hairline, ->1=solid) */
function thicknessFromAP(A, P) {
  if (P <= 0) return 0;
  return Math.max(0, Math.min(1, (4 * Math.PI * A) / (P * P)));
}

/** adaptive dilation: convolve with k×k ones then threshold>0; k derived from radius r */
async function dilateHardMask(hardMaskPng, radiusPx) {
  const r = Math.max(0, Math.min(18, Math.round(radiusPx))); // clamp to safe bounds
  if (r === 0) return hardMaskPng;

  // odd kernel size
  const k = Math.max(1, 2 * r + 1);
  const size = k * k;
  const kernel = {
    width: k,
    height: k,
    // ones kernel -> any overlap >0 becomes white after threshold
    kernel: Array(size).fill(1)
  };

  const meta = await sharp(hardMaskPng).metadata();
  const summed = await sharp(hardMaskPng)
    .removeAlpha()
    .convolve(kernel)
    .normalize() // scale sums into 0..255
    .threshold(1) // any positive -> white
    .png()
    .toBuffer();

  // Ensure final size matches original
  return await sharp(summed).resize({ width: meta.width, height: meta.height, fit: 'fill' }).png().toBuffer();
}

/** slight feather for soft edge (1..2 px) */
async function featherMask(maskPng, sigma = 1.0) {
  return sharp(maskPng).blur(sigma).png().toBuffer();
}

/* ------------------------------- main object ------------------------------- */

const fluxPlacementHandler = {

  removeImageBackground: async (imageBuffer) => {
    if (!REMOVE_BG_API_KEY) {
      console.warn('REMOVE_BG_API_KEY not set. Returning original as PNG.');
      return await sharp(imageBuffer).png().toBuffer();
    }

    try {
      console.log('Calling Remove.bg API...');
      const formData = new FormData();
      formData.append('image_file', new Blob([imageBuffer], { type: 'image/png' }), 'tattoo_design.png');
      formData.append('size', 'auto');
      formData.append('format', 'png');

      const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
        headers: { 'X-Api-Key': REMOVE_BG_API_KEY, ...formData.getHeaders() },
        responseType: 'arraybuffer'
      });

      if (response.status === 200) {
        console.log('Remove.bg ok.');
        return Buffer.from(response.data);
      }
      const errData = response.data?.toString?.() || '';
      throw new Error(`remove.bg status ${response.status} ${errData.slice(0, 120)}`);
    } catch (e) {
      console.warn('remove.bg failed, using original PNG:', e.message);
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

      const { width, height } = await sharp(imageBuffer).metadata();
      const left = Math.max(0, width - 200 - 15);
      const top = Math.max(0, height - 30 - 15);

      return await sharp(imageBuffer)
        .composite([{ input: svgBuffer, top, left, blend: 'over' }])
        .png()
        .toBuffer();

    } catch (error) {
      console.error('Watermark error:', error.message);
      return imageBuffer;
    }
  },

  uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
    const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(filePath, imageBuffer, {
      contentType, upsert: false
    });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);

    const { data: publicUrlData } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    if (!publicUrlData?.publicUrl) throw new Error('Supabase public URL missing.');
    console.log('Image uploaded to Supabase:', publicUrlData.publicUrl);
    return publicUrlData.publicUrl;
  },

  /**
   * Main flow (robust, geometry-preserving)
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
    // --- 0) Canonicalize inputs ---
    const skinMeta = await sharp(skinImageBuffer).metadata();
    const skinW = skinMeta.width, skinH = skinMeta.height;

    const maskOriginalPng = Buffer.from(maskBase64, 'base64');
    const maskHardPngSkinSize = await toHardMaskPng(maskOriginalPng, { width: skinW, height: skinH }); // binary, skin-sized
    const maskSoftPngSkinSize = await featherMask(maskHardPngSkinSize, 1.0); // for soft blending edges

    // Metrics for adaptive behavior
    const { raw: maskRaw, width: mw, height: mh } = await toRawGray(maskHardPngSkinSize);
    const { A, P } = areaPerimeterFromRaw({ raw: maskRaw, width: mw, height: mh });
    const t = thicknessFromAP(A, P);
    const areaRatio = A / (skinW * skinH);

    console.log(`MASK metrics: A=${A}, P=${P}, t=${t.toFixed(4)}, areaRatio=${areaRatio.toFixed(6)}`);

    // If truly trivial, fail fast with a helpful message
    if (A < 40) {
      throw new Error('Mask too small. Please draw a larger area for the tattoo.');
    }

    // Adaptive dilation radius (continuous, no switches)
    // More dilation for smaller areas and thinner strokes; almost none for big/solid masks.
    const k = 40;           // area term scaler
    const k2 = 8;           // thinness bonus
    const rmin = 1, rmax = 18;
    const r = Math.max(rmin, Math.min(rmax, Math.round(k * Math.sqrt(Math.max(1e-9, areaRatio)) + k2 * (1 - t))));
    console.log(`Adaptive dilation radius r=${r}px`);

    // Build model mask (dilated), and a slightly feathered version for preblend/prefill
    const maskForModelHard = await dilateHardMask(maskHardPngSkinSize, r);
    const maskForModelSoft = await featherMask(maskForModelHard, 1.2);

    // --- 1) Tattoo design prep & deterministic placement (single resize + rotate) ---
    const tattooDesignOriginalBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
    const tattooPng = await fluxPlacementHandler.removeImageBackground(tattooDesignOriginalBuffer);

    // Use bbox directly from the hard mask (skin space already)
    // Compute bbox quickly reusing maskRaw
    let minX = mw, minY = mh, maxX = -1, maxY = -1;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (maskRaw[y * mw + x] > 127) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) throw new Error('Computed empty bbox from mask.');
    const bboxW = maxX - minX + 1, bboxH = maxY - minY + 1;
    console.log(`BBOX(skin): x=${minX}, y=${minY}, w=${bboxW}, h=${bboxH}`);

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

    // Full-canvas placed tattoo
    const tattooCanvasPlaced = await sharp({
      create: { width: skinW, height: skinH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([{ input: rotatedTattoo, left, top }])
      .png()
      .toBuffer();

    // ORIGINAL silhouette alpha (exact geometry) to be used for final clamp
    const originalSilhouette = await sharp(tattooCanvasPlaced)
      .composite([{ input: maskHardPngSkinSize, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // sanity check: if silhouette is empty, auto-invert once, else widen minimally
    const { raw: silRaw, width: sw, height: sh } = await toRawGray(originalSilhouette);
    let alphaSum = 0;
    for (let i = 0; i < silRaw.length; i++) alphaSum += silRaw[i];
    if (alphaSum < 1) {
      console.warn('Original silhouette empty after dest-in. Trying inverted mask once.');
      const invertedMask = await sharp(maskHardPngSkinSize).linear(-1, 255).png().toBuffer();
      const retrySil = await sharp(tattooCanvasPlaced).composite([{ input: invertedMask, blend: 'dest-in' }]).png().toBuffer();
      const { raw: rraw } = await toRawGray(retrySil);
      let rsum = 0; for (let i = 0; i < rraw.length; i++) rsum += rraw[i];
      if (rsum > 0) {
        // use inverted as silhouette, but keep model masks based on hard/soft (not inverted)
        console.warn('Using inverted mask for geometry clamp.');
        // overwrite originalSilhouette
        // eslint-disable-next-line no-var
        var _tmpSil = retrySil; // workaround for const
        // @ts-ignore
        originalSilhouette = _tmpSil;
      } else {
        console.warn('Still empty. Applying minimal widen (ε=1px).');
        const widened = await dilateHardMask(maskHardPngSkinSize, 1);
        // recompute silhouette
        // eslint-disable-next-line no-var
        var _tmpSil2 = await sharp(tattooCanvasPlaced).composite([{ input: widened, blend: 'dest-in' }]).png().toBuffer();
        // @ts-ignore
        originalSilhouette = _tmpSil2;
      }
    }

    // --- 2) Build the model input (photometric preblend + prefill inside dilated mask) ---
    // Prefill (dark gray ink) where mask_for_model_soft is present; this helps the model "see" tattoo ink
    const prefill = await sharp({
      create: { width: skinW, height: skinH, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } }
    }).png().toBuffer();

    const prefillShaped = await sharp(prefill)
      .composite([{ input: maskForModelSoft, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // Compose: skin + (prefill × soft mask) + (placed tattoo lightly to cue shape)
    const inputImageForModel = await sharp(skinImageBuffer)
      .composite([
        { input: prefillShaped, blend: 'overlay', opacity: 0.65 },                        // subtle ink tone
        { input: await sharp(tattooCanvasPlaced).composite([{ input: maskForModelSoft, blend: 'dest-in' }]).png().toBuffer(), blend: 'over', opacity: 0.85 }
      ])
      .png()
      .toBuffer();

    // --- 3) Call FLUX (constrained) ---
    const generatedImageUrls = [];
    const basePrompt =
      "Preserve the exact silhouette, linework, proportions and interior details of the tattoo. Only relight and blend the existing tattoo into the skin. Add realistic lighting, micro-shadowing, slight ink diffusion, and subtle skin texture. Do not redraw or restyle.";
    const negativePrompt =
      "re-sketch, new lines, restyle, warp, change shape, extra elements, animals, octopus, figurative art, glow, blur, smoothing edges, color shift";

    console.log(`Making ${numVariations} calls to Flux API...`);

    for (let i = 0; i < numVariations; i++) {
      const currentSeed = Date.now() + i;

      const fluxPayload = {
        prompt: basePrompt,
        negative_prompt: negativePrompt,
        input_image: inputImageForModel.toString('base64'),              // prefilled composite
        mask_image: (await sharp(maskForModelHard).png().toBuffer()).toString('base64'), // dilated mask for the model
        n: 3,                                      // three options per call
        output_format: 'png',
        fidelity: 0.8,
        guidance_scale: 2.3,                       // low to avoid creative redraw
        prompt_upsampling: false,
        safety_tolerance: 2,
        seed: currentSeed
      };

      const headers = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
      let fluxResponse;
      try {
        fluxResponse = await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', fluxPayload, { headers, timeout: 120000 });
        console.log(`DEBUG: POST status for variation ${i + 1}: ${fluxResponse.status}`);
      } catch (err) {
        console.error(`Flux POST failed (variation ${i + 1}):`, err.response?.data || err.message);
        continue;
      }

      const taskId = fluxResponse.data?.id;
      const pollingUrl = fluxResponse.data?.polling_url;
      if (!taskId || !pollingUrl) {
        console.warn(`Missing taskId/pollingUrl on variation ${i + 1}`);
        continue;
      }

      let attempts = 0, ready = false;
      while (attempts < 60 && !ready) {
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        const res = await axios.get(pollingUrl, { headers: { 'x-key': fluxApiKey }, timeout: 15000 });
        if (res.data?.status === 'Ready') {
          const r = res.data.result || {};
          const urls = [];
          if (typeof r.sample === 'string') urls.push(r.sample);
          if (Array.isArray(r.samples)) urls.push(...r.samples.filter(s => typeof s === 'string'));
          if (Array.isArray(r.images)) urls.push(...r.images.filter(s => typeof s === 'string'));
          if (Array.isArray(r.output)) urls.push(...r.output.filter(s => typeof s === 'string'));

          // Process each returned image
          for (const u of urls) {
            try {
              const imgRes = await axios.get(u, { responseType: 'arraybuffer' });
              let outBuf = Buffer.from(imgRes.data);

              // Normalize to skin size
              outBuf = await sharp(outBuf).resize({ width: skinW, height: skinH, fit: 'fill' }).png().toBuffer();

              // Strict geometry clamp: dest-in with the ORIGINAL silhouette (exact alpha)
              const clamped = await sharp(outBuf)
                .composite([
                  { input: await featherMask(originalSilhouette, 1.0), blend: 'dest-in' } // tiny feather to avoid jaggies
                ])
                .png()
                .toBuffer();

              // Final blend on skin (premultiplied), plus a faint overlay of original lines for crispness
              const finalComposite = await sharp(skinImageBuffer)
                .composite([
                  { input: clamped, blend: 'over', premultiplied: true },
                  { input: originalSilhouette, blend: 'overlay', opacity: 0.30 }
                ])
                .png()
                .toBuffer();

              // Watermark + upload
              const watermarked = await fluxPlacementHandler.applyWatermark(finalComposite);
              const fileName = `tattoo-${uuidv4()}.png`;
              const url = await fluxPlacementHandler.uploadToSupabaseStorage(watermarked, fileName, userId, '', 'image/png');
              generatedImageUrls.push(url);
            } catch (e) {
              console.error('Postprocess/upload error:', e.message);
            }
          }

          ready = true;
        } else if (res.data?.status === 'Content Moderated') {
          console.warn('Flux moderation:', res.data?.details || '');
          ready = true;
        } else if (res.data?.status === 'Error') {
          console.error('Flux error during polling:', res.data);
          ready = true;
        } // else Pending/Processing → continue loop
      }

      if (!ready) console.warn(`Timeout waiting for result (variation ${i + 1})`);
    } // variations loop

    if (generatedImageUrls.length === 0) {
      throw new Error('Flux API: no images generated.');
    }

    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
