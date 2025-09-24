// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-09-24_FILL_PRO_STRICT_SCHEMA_COLOR_GUIDED_V2');

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
const FLUX_FILL_ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.0-fill'; // Fill [pro] inpaint
const FILL_GUIDANCE = Number(process.env.FILL_GUIDANCE || '40');      // 1.5..100
const FILL_STEPS = Number(process.env.FILL_STEPS || '40');            // 15..50
const FILL_SAFETY = Number(process.env.FILL_SAFETY || '2');
const FILL_PROMPT_UPSAMPLING = (process.env.FILL_PROMPT_UPSAMPLING ?? 'false').toLowerCase() === 'true';
const FILL_OUTPUT_FORMAT = (process.env.FILL_OUTPUT_FORMAT || 'png').toLowerCase(); // 'png'|'jpeg'

// -----------------------------
// Helpers
// -----------------------------
async function uploadToSupabaseStorage(imageBuffer, fileName, userId, folder = '', contentType = 'image/png') {
  const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
  const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
    .upload(filePath, imageBuffer, { contentType, upsert: false });
  if (error) throw new Error(`Failed to upload image to storage: ${error.message}`);
  const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
  if (!pub?.publicUrl) throw new Error('Failed to get public URL for uploaded image.');
  return pub.publicUrl;
}

/**
 * Build an INPUT image for Fill:
 * - Start with the original skin (base)
 * - Place the tattoo (already positioned/rotated to the right spot) BUT only inside the editable mask
 *   (so the guide pixels sit exactly where Fill is allowed to change)
 * Outside the mask, pixels remain identical to the original skin.
 */
async function bakeGuideIntoInputWithinMask(skinImageBuffer, positionedTattooPngBuffer, maskPngBuffer) {
  // 1) Ensure mask is grayscale, sized to skin, and force binary 0/255
  const skinMeta = await sharp(skinImageBuffer).metadata();
  const maskBin = await sharp(maskPngBuffer)
    .resize({ width: skinMeta.width, height: skinMeta.height, fit: 'fill' })
    .grayscale()
    .threshold(1) // any >0 becomes 255 (white=editable)
    .png()
    .toBuffer();

  // 2) Constrain the positioned tattoo to the white region of the mask (as alpha)
  const maskAlphaRaw = await sharp(maskBin).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const tatMeta = await sharp(positionedTattooPngBuffer).metadata();
  // re-raster tattoo to have alpha = mask (so it only exists where editable)
  const tattooRGB = await sharp(positionedTattooPngBuffer).removeAlpha().toBuffer();
  const tattooMasked = await sharp(tattooRGB)
    .joinChannel(maskAlphaRaw, { raw: { width: skinMeta.width, height: skinMeta.height, channels: 1 } })
    .png()
    .toBuffer();

  // 3) Composite over the original skin (only inside mask there are non-zero tattoo pixels)
  const guidedInput = await sharp(skinImageBuffer)
    .composite([{ input: tattooMasked, blend: 'over' }])
    .png()
    .toBuffer();

  return { guidedInputPNG: guidedInput, binaryMaskPNG: maskBin };
}

// -----------------------------
// Public module
// -----------------------------
const fluxPlacementHandler = {
  /**
   * STRICT inpainting with FLUX.1 Fill [pro]:
   * - We DO NOT paste after generation. We upload FLUX output as-is.
   * - Input image already contains your colored sketch *inside the mask region only*,
   *   giving the model a precise visual target while preserving the rest as the original.
   */
  placeTattooOnSkin: async (
    skinImageBuffer,
    tattooDesignImageBase64,  // positioned + rotated PNG on a skin-sized transparent canvas
    maskBase64,               // white=editable, black=preserve; same dims as skin
    userId,
    numVariations,
    fluxApiKey,
    tattooPrompt = 'Render the provided sketch as a realistic tattoo precisely within the masked region. Preserve original colors and proportions. Do not modify any pixel outside the mask.'
  ) => {
    const tattooPositionedCanvas = Buffer.from(tattooDesignImageBase64, 'base64');
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    // Build the guided INPUT (skin + tattoo only inside mask)
    const { guidedInputPNG, binaryMaskPNG } = await bakeGuideIntoInputWithinMask(
      skinImageBuffer,
      tattooPositionedCanvas,
      maskBuffer
    );

    const generatedImageUrls = [];
    for (let i = 0; i < numVariations; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1000)); // polite rate limiting
      const seed = Date.now() + i;

      // **** EXACT Fill schema ****
      const payload = {
        image: guidedInputPNG.toString('base64'),         // base64 string
        mask: binaryMaskPNG.toString('base64'),           // base64 string (BW, same size)
        prompt: tattooPrompt,                             // string
        steps: FILL_STEPS,                                // integer
        prompt_upsampling: FILL_PROMPT_UPSAMPLING,        // boolean
        seed,                                             // integer
        guidance: FILL_GUIDANCE,                          // number
        output_format: FILL_OUTPUT_FORMAT,                // 'png' | 'jpeg'
        safety_tolerance: FILL_SAFETY                     // integer 0..6
      };

      // Submit task
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
            buf,
            fileName,
            userId,
            '',
            `image/${FILL_OUTPUT_FORMAT}`
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
