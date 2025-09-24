// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-09-24_FILL_PRO_MASK_SAFE_AUTOPLACE_V3');

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

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
const FLUX_API_KEY = process.env.FLUX_API_KEY;

// -----------------------------
// Flux Fill settings (exact schema fields)
// -----------------------------
const FLUX_FILL_ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.0-fill'; // native inpaint
const FILL_GUIDANCE = Number(process.env.FILL_GUIDANCE || '40');      // 1.5..100
const FILL_STEPS = Number(process.env.FILL_STEPS || '40');            // 15..50
const FILL_SAFETY = Number(process.env.FILL_SAFETY || '2');
const FILL_PROMPT_UPSAMPLING = (process.env.FILL_PROMPT_UPSAMPLING ?? 'false').toLowerCase() === 'true';
const FILL_OUTPUT_FORMAT = (process.env.FILL_OUTPUT_FORMAT || 'png').toLowerCase(); // 'png'|'jpeg'

// -----------------------------
// Helpers
// -----------------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

async function uploadToSupabaseStorage(imageBuffer, fileName, userId, folder = '', contentType = 'image/png') {
  const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
  const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
    .upload(filePath, imageBuffer, { contentType, upsert: false });
  if (error) throw new Error(`Failed to upload image to storage: ${error.message}`);
  const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
  if (!pub?.publicUrl) throw new Error('Failed to get public URL for uploaded image.');
  return pub.publicUrl;
}

function getMaskBBoxFromRawGray(grayRaw, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1, found = false;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (grayRaw[row + x] > 0) {
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

/**
 * Build an INPUT image for Fill:
 * - Resize mask to skin size, force binary (0/255).
 * - If tattoo sketch is not skin-sized, auto-place it to fit the mask bbox (centered, fit=inside).
 * - Clip the placed tattoo by the mask (so guidance exists only where edit is allowed).
 * - Composite over original skin to produce the guided INPUT for Fill.
 */
async function bakeGuideIntoInputWithinMask(skinImageBuffer, tattooAnyBuffer, maskAnyBuffer) {
  const skinMeta = await sharp(skinImageBuffer).metadata();
  const skinW = skinMeta.width | 0, skinH = skinMeta.height | 0;

  // 1) Strict BW mask the same size as the skin
  const maskBinPNG = await sharp(maskAnyBuffer)
    .resize({ width: skinW, height: skinH, fit: 'fill' })
    .grayscale()
    .threshold(1)  // >0 -> 255
    .png()
    .toBuffer();

  // Grab raw gray for bbox calc
  const maskGrayRaw = await sharp(maskBinPNG).removeAlpha().raw().toBuffer({ resolveWithObject: false });
  const bbox = getMaskBBoxFromRawGray(maskGrayRaw, skinW, skinH);
  if (bbox.isEmpty) throw new Error('Mask area is empty.');

  // 2) Create a skin-sized transparent canvas and place the tattoo inside the mask bbox
  // If incoming tattoo is already skin-sized positioned canvas, we’ll use it directly.
  const tatMeta = await sharp(tattooAnyBuffer).metadata();
  let tattooPlacedCanvas;

  if ((tatMeta.width === skinW) && (tatMeta.height === skinH)) {
    // Assume already positioned over a transparent canvas the size of skin.
    tattooPlacedCanvas = await sharp(tattooAnyBuffer)
      .ensureAlpha()
      .toColourspace('srgb')
      .png()
      .toBuffer();
  } else {
    // Treat as raw design; resize to fit mask bbox and center it there.
    const targetW = bbox.width;
    const targetH = bbox.height;

    const resizedTattoo = await sharp(tattooAnyBuffer)
      .ensureAlpha()
      .toColourspace('srgb')
      .resize({ width: targetW, height: targetH, fit: sharp.fit.inside, withoutEnlargement: false })
      .png()
      .toBuffer();

    const resizedMeta = await sharp(resizedTattoo).metadata();
    const left = Math.round(bbox.minX + (bbox.width  - resizedMeta.width)  / 2);
    const top  = Math.round(bbox.minY + (bbox.height - resizedMeta.height) / 2);

    // Skin-sized transparent canvas with the tattoo placed at (left, top)
    tattooPlacedCanvas = await sharp({
      create: {
        width: skinW,
        height: skinH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: resizedTattoo, left, top }])
      .png()
      .toBuffer();
  }

  // 3) Clip tattoo by the mask (so guide pixels exist only where editable)
  // Using 'dest-in' to keep only where mask is white.
  const tattooClippedToMask = await sharp(tattooPlacedCanvas)
    .composite([{ input: maskBinPNG, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 4) Bake guide into the skin input (only inside mask there are non-zero pixels)
  const guidedInputPNG = await sharp(skinImageBuffer)
    .composite([{ input: tattooClippedToMask, blend: 'over' }])
    .png()
    .toBuffer();

  return { guidedInputPNG, binaryMaskPNG: maskBinPNG };
}

// -----------------------------
// Public module
// -----------------------------
const fluxPlacementHandler = {
  /**
   * STRICT inpainting with FLUX.1 Fill [pro]:
   * - We DO NOT paste after generation. We upload FLUX output as-is.
   * - Input image already contains your (colored) sketch *inside the mask region only*,
   *   giving the model a precise target while preserving the rest as untouched.
   */
  placeTattooOnSkin: async (
    skinImageBuffer,
    tattooDesignImageBase64,  // may be raw design or a positioned skin-sized canvas (we handle both)
    maskBase64,               // white=editable, black=preserve
    userId,
    numVariations,
    fluxApiKey,
    tattooPrompt = 'Render the provided sketch as a realistic tattoo precisely within the masked region. Preserve original colors and proportions. Do not modify any pixel outside the mask.'
  ) => {
    const skinMeta = await sharp(skinImageBuffer).metadata();
    console.log(`Skin Image Dims: ${skinMeta.width}x${skinMeta.height}`);

    const tattooBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    // Build guided INPUT (auto-place if needed)
    const { guidedInputPNG, binaryMaskPNG } = await bakeGuideIntoInputWithinMask(
      skinImageBuffer,
      tattooBuffer,
      maskBuffer
    );

    const generatedImageUrls = [];

    for (let i = 0; i < numVariations; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1000));
      const seed = Date.now() + i;
      console.log(`[FLUX] Fill call #${i + 1}, seed=${seed}`);

      // EXACT Fill schema
      const payload = {
        image: guidedInputPNG.toString('base64'),
        mask: binaryMaskPNG.toString('base64'),
        prompt: tattooPrompt,
        steps: FILL_STEPS,
        prompt_upsampling: FILL_PROMPT_UPSAMPLING,
        seed,
        guidance: FILL_GUIDANCE,
        output_format: FILL_OUTPUT_FORMAT,
        safety_tolerance: FILL_SAFETY
      };

      let task;
      try {
        const res = await axios.post(FLUX_FILL_ENDPOINT, payload, {
          headers: { 'Content-Type': 'application/json', 'x-key': fluxApiKey || FLUX_API_KEY },
          timeout: 120000
        });
        task = res.data;
        console.log(`FLUX Fill POST ok, id=${task?.id}`);
      } catch (e) {
        console.error('FLUX Fill POST failed:', e.response?.data || e.message);
        continue;
      }

      if (!task?.polling_url) {
        console.warn('FLUX Fill: missing polling_url');
        continue;
      }

      // Poll for completion
      let attempts = 0;
      let done = false;
      while (!done && attempts < 60) {
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        const poll = await axios.get(task.polling_url, {
          headers: { 'x-key': fluxApiKey || FLUX_API_KEY },
          timeout: 20000
        });
        const data = poll.data;

        if (data.status === 'Ready') {
          const url = data.result?.sample;
          if (!url) { done = true; break; }
          const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
          const buf = Buffer.from(imgRes.data);
          const fileName = `tattoo-${uuidv4()}.${FILL_OUTPUT_FORMAT}`;
          const publicUrl = await uploadToSupabaseStorage(
            buf, fileName, userId, '', `image/${FILL_OUTPUT_FORMAT}`
          );
          generatedImageUrls.push(publicUrl);
          done = true;
        } else if (data.status === 'Error' || data.status === 'Content Moderated') {
          console.warn('FLUX Fill ended:', data.status, data.details || '');
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
