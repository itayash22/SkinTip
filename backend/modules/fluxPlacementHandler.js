// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-09-23_FLUX_FILL_PRO_NATIVE_INPAINT');

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// -----------------------------
// Supabase setup
// -----------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// -----------------------------
// External API keys
// -----------------------------
const FLUX_API_KEY = process.env.FLUX_API_KEY;

// -----------------------------
// Flux Fill settings
// -----------------------------
const FLUX_FILL_ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.0-fill';
const FILL_GUIDANCE = Number(process.env.FILL_GUIDANCE || '40'); // 1.5–100
const FILL_STEPS = Number(process.env.FILL_STEPS || '40'); // 15–50
const FILL_SAFETY = Number(process.env.FILL_SAFETY || '2');
const FILL_OUTPUT_FORMAT = (
  process.env.FILL_OUTPUT_FORMAT || 'png'
).toLowerCase();

// -----------------------------
// Helpers
// -----------------------------
async function uploadToSupabaseStorage(
  imageBuffer,
  fileName,
  userId,
  folder = '',
  contentType = 'image/png'
) {
  const filePath = folder
    ? `${userId}/${folder}/${fileName}`
    : `${userId}/${fileName}`;
  const { error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(filePath, imageBuffer, { contentType, upsert: false });
  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
  const { data: pub } = supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(filePath);
  if (!pub?.publicUrl) throw new Error('Failed to get public URL.');
  console.log('Image uploaded:', pub.publicUrl);
  return pub.publicUrl;
}

// -----------------------------
// Public module
// -----------------------------
const fluxPlacementHandler = {
  /**
   * Place tattoo strictly inside mask area using FLUX Fill [pro].
   * Outside the mask = untouched original skin (bit-for-bit).
   */
  placeTattooOnSkin: async (
    skinImageBuffer,
    tattooDesignImageBase64,
    maskBase64,
    userId,
    numVariations,
    fluxApiKey,
    tattooPrompt = 'Render the given tattoo sketch as a realistic tattoo on the skin, preserving original colors and proportions. Do not modify any area outside the mask.'
  ) => {
    const skinMeta = await sharp(skinImageBuffer).metadata();
    console.log(
      `Skin image meta: ${skinMeta.width}x${skinMeta.height}, fmt=${skinMeta.format}`
    );

    const tattooBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    const generatedImageUrls = [];

    for (let i = 0; i < numVariations; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 1000)); // polite delay
      }

      const seed = Date.now() + i;
      console.log(`[FLUX] Starting Fill call #${i + 1}, seed=${seed}`);

      const payload = {
        prompt: tattooPrompt,
        image: skinImageBuffer.toString('base64'), // original skin
        mask: maskBuffer.toString('base64'), // white = editable
        guide_image: tattooBuffer.toString('base64'), // sketch or positioned tattoo
        output_format: FILL_OUTPUT_FORMAT,
        n: 1,
        guidance: FILL_GUIDANCE,
        num_inference_steps: FILL_STEPS,
        safety_tolerance: FILL_SAFETY,
        seed
      };

      let task;
      try {
        const res = await axios.post(FLUX_FILL_ENDPOINT, payload, {
          headers: {
            'Content-Type': 'application/json',
            'x-key': fluxApiKey || FLUX_API_KEY
          },
          timeout: 120000
        });
        task = res.data;
        console.log(`DEBUG: FLUX POST status=${res.status} id=${task.id}`);
      } catch (e) {
        console.error('FLUX Fill post failed:', e.response?.data || e.message);
        continue;
      }

      if (!task?.polling_url) {
        console.warn('FLUX Fill: missing polling_url');
        continue;
      }

      // Poll until Ready
      let attempts = 0;
      let done = false;
      while (!done && attempts < 60) {
        attempts++;
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await axios.get(task.polling_url, {
          headers: { 'x-key': fluxApiKey || FLUX_API_KEY },
          timeout: 20000
        });
        const data = poll.data;

        if (data.status === 'Ready') {
          const url = data.result?.sample;
          if (!url) {
            done = true;
            break;
          }
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
      throw new Error(
        'Flux API: No images were generated across all attempts. Please try again.'
      );
    }

    return generatedImageUrls;
  }
};

export default fluxPlacementHandler;
