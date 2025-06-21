// backend/modules/fluxPlacementHandler.js

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase Client for backend operations
// IMPORTANT: Use SUPABASE_SERVICE_KEY here for full RLS bypass on the backend.
// This key should NEVER be exposed to the frontend.
const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // Changed to SUPABASE_SERVICE_KEY
);

// Helper function for delays (to avoid busy waiting)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const placeTattooOnSkin = async (skinImageBuffer, tattooDesignBuffer, maskBuffer) => {
    try {
        console.log("Starting Flux tattoo placement process (V1.48 Base with PNG End-to-End)...");

        // --- Step 1: Pre-process images for Flux input ---
        const skinImageMetadata = await sharp(skinImageBuffer).metadata();
        const tattooDesignMetadata = await sharp(tattooDesignBuffer).metadata();
        const maskMetadata = await sharp(maskBuffer).metadata();

        console.log(`Skin Image Dims: ${skinImageMetadata.width}x${skinImageMetadata.height}`);
        console.log(`Tattoo Design Dims: ${tattooDesignMetadata.width}x${tattooDesignMetadata.height}`);
        console.log(`Mask Dims: ${maskMetadata.width}x${maskMetadata.height}`);

        // --- IMPORTANT: Mask Bounding Box Calculation ---
        // This is a CRITICAL PLACEHOLDER. You MUST implement the actual logic
        // to calculate the minX, minY, maxX, maxY, width, and height
        // from your `maskBuffer`. The values below are hardcoded from your logs
        // and WILL NOT work for different masks.
        // For now, using your log values:
        const maskBoundingBox = {
            minX: 354,
            minY: 296,
            maxX: 603,
            maxY: 576,
            width: 250,
            height: 281,
            isEmpty: false
        };
        console.log("DEBUG: Calculated Mask Bounding Box:", maskBoundingBox);

        if (maskBoundingBox.isEmpty) {
            throw new Error("Mask bounding box is empty. No area for tattoo placement.");
        }

        // Ensure tattoo design has an alpha channel for proper compositing.
        let processedTattooDesignBuffer = tattooDesignBuffer;
        if (tattooDesignMetadata.channels < 4) {
            console.log("Tattoo design image does not have an alpha channel. Adding one.");
            processedTattooDesignBuffer = await sharp(tattooDesignBuffer)
                .ensureAlpha()
                .toBuffer();
        } else {
            console.log("Tattoo design image already has an alpha channel.");
        }

        let resizedTattooDesignBuffer;
        try {
            // Resize tattoo design specifically for the mask bounding box dimensions
            resizedTattooDesignBuffer = await sharp(processedTattooDesignBuffer)
                .resize(maskBoundingBox.width, maskBoundingBox.height, {
                    fit: sharp.fit.inside,
                    withoutEnlargement: true,
                    kernel: sharp.kernel.lanczos3
                })
                .png()
                .toBuffer();
            console.log(`Tattoo design resized specifically for mask bounding box: ${maskBoundingBox.width}x${maskBoundingBox.height}.`);
        } catch (sharpError) {
            console.error("Error during Sharp tattoo design resizing:", sharpError);
            throw new Error(`Failed to resize tattoo design image with Sharp: ${sharpError.message}`);
        }


        // Manually composite tattoo onto the full skin image
        // NOTE: If Flux Kontext expects original image + mask + tattoo for true inpainting,
        // this compositing step might need to change, and the mask/tattoo sent separately.
        const fullCompositeImageBuffer = await sharp(skinImageBuffer)
            .composite([{
                input: resizedTattooDesignBuffer,
                left: maskBoundingBox.minX,
                top: maskBoundingBox.minY,
                blend: 'over'
            }])
            .png()
            .toBuffer();
        console.log("Tattoo manually composited onto full skin image (PNG format for Flux input).");


        // --- Step 2: Upload composited image to Supabase and get URL for Flux ---
        const fileName = `debug_sharp_full_composite_${uuidv4()}.png`;
        const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('generated-tattoos')
            .upload(`debug/${fileName}`, fullCompositeImageBuffer, {
                contentType: 'image/png',
                upsert: true,
            });

        if (uploadError) {
            console.error("Supabase upload error:", uploadError);
            throw new Error(`Failed to upload image to Supabase: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabaseClient
            .storage
            .from('generated-tattoos')
            .getPublicUrl(uploadData.path);
        const imageUrl = publicUrlData.publicUrl;

        console.log(`Image uploaded to Supabase: ${imageUrl}`);
        console.log(`--- DEBUG: SHARP FULL COMPOSITED IMAGE URL (SENT TO FLUX AS PNG): ${imageUrl} ---`);
        console.log("^ Please check this URL in your browser to verify Sharp's PNG output.");


        // --- Step 3: Call Flux API to initiate tattoo placement ---
        if (!process.env.FLUX_API_KEY) {
            throw new Error("FLUX_API_KEY environment variable is not set. Cannot proceed with Flux API call.");
        }

        let initialFluxResponse;
        try {
            // Updated Flux API endpoint based on Fal.ai documentation for Kontext models
            initialFluxResponse = await axios.post(
                'https://queue.fal.run/fal-ai/flux-pro/kontext', // <--- UPDATED ENDPOINT
                {
                    input_image_url: imageUrl,
                    // You might need to add a 'prompt' or 'instruction' here for Flux Kontext
                    // e.g., 'prompt': 'place the tattoo on the marked area naturally'
                    // And potentially a separate 'mask_image_url' if the model expects it for inpainting.
                    // The 'maskBoundingBox' is currently only used for Sharp compositing.
                },
                {
                    headers: {
                        'Authorization': `Key ${process.env.FLUX_API_KEY}`,
      'Content-Type': 'application/json'
                    },
                    timeout: 60000, // Increased timeout for potentially longer AI generation
                }
            );
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const responseData = error.response?.data;
                console.error(`Axios error during initial Flux POST. Status: ${status}. Data: ${JSON.stringify(responseData)}. Error message: ${error.message}`);
                throw new Error(`Flux API initial call failed: ${status} - ${responseData?.message || JSON.stringify(responseData) || error.message}`);
            }
            throw error; // Re-throw non-Axios errors
        }

        const {
  request_id: fluxTaskId,
  status_url: pollingUrl,
  response_url: responseUrl,
  status
} = initialFluxResponse.data;

if (status !== 'IN_QUEUE' || !fluxTaskId || !pollingUrl || !responseUrl) {
  console.error("Full initial response:", initialFluxResponse.data);
  throw new Error(
    "Flux queue API didn’t return the expected request_id/status_url/response_url."
  );
}

        // --- Step 4: Poll Flux API for results with retry logic and exact URL ---
        const MAX_POLLING_ATTEMPTS = 90; // Increased attempts
        const POLLING_INTERVAL_MS = 3000; // Increased interval
        const MAX_POLLING_INTERVAL_MS = 15000; // Increased max interval
        const TOTAL_POLLING_TIMEOUT_MS = 8 * 60 * 1000; // Increased total timeout
        const pollingStartTime = Date.now();
        let currentAttempt = 0;
        let result = null;

        while (currentAttempt < MAX_POLLING_ATTEMPTS && (Date.now() - pollingStartTime) < TOTAL_POLLING_TIMEOUT_MS) {
            currentAttempt++;
            const currentDelay = Math.min(POLLING_INTERVAL_MS * Math.pow(1.5, currentAttempt - 1), MAX_POLLING_INTERVAL_MS);
            console.log(`Polling Flux API. Attempt ${currentAttempt}/${MAX_POLLING_ATTEMPTS}. Next poll in ${currentDelay / 1000}s.`);
            await delay(currentDelay);

            try {
                const pollResponse = await axios.get(pollingUrl, {
                headers: { 'Authorization': `Key ${process.env.FLUX_API_KEY}` },
                timeout: 25000,
                });

                const fluxStatus = pollResponse.data.status;
                console.log(`Flux Poll Status (Attempt ${currentAttempt}): ${fluxStatus}`);

                if (fluxStatus === 'completed') {
                    result = pollResponse.data.result;
                    console.log("Flux task completed successfully. Result:", result);
                    // You might need to add watermarking here if Flux doesn't do it
                    return result;
                } else if (fluxStatus === 'failed' || fluxStatus === 'error') {
                    console.error("Flux task failed or encountered an error:", pollResponse.data.details || 'No details provided.');
                    throw new Error(`Flux task failed: ${fluxStatus} - ${pollResponse.data.details || 'Check Flux logs for more info.'}`);
                }

            } catch (pollError) {
                if (axios.isAxiosError(pollError)) {
                    if (pollError.response) {
                        console.error(`Axios error during Flux polling (Status: ${pollError.response.status}, Data: ${JSON.stringify(pollError.response.data)}): ${pollError.message}`);
                        if (pollError.response.status === 404 && pollError.response.data?.status === 'Task not found') {
                            console.warn("Flux reported 'Task not found' during polling. This is unexpected for an active task ID, but continuing retry.");
                        } else if (pollError.response.status === 401 || pollError.response.status === 403) {
                            console.error("Authentication/Authorization error with Flux API. Check your x-key environment variable.");
                            throw new Error("Flux API authentication/authorization failed. Please verify your FLUX_API_KEY.");
                        } else if (pollError.response.status >= 500) {
                            console.warn("Flux server error (5xx) during polling. Retrying...");
                        }
                    } else if (pollError.request) {
                        console.warn(`Flux polling request timed out or network error (Attempt ${currentAttempt}). Retrying...`);
                    } else {
                        console.error("Error setting up Flux polling request:", pollError.message);
                        throw pollError;
                    }
                } else {
                    console.error("Non-Axios error during Flux polling:", pollError);
                    throw pollError;
                }
            }
        }

        if ((Date.now() - pollingStartTime) >= TOTAL_POLLING_TIMEOUT_MS) {
            throw new Error(`Flux task did not complete within the total polling timeout of ${TOTAL_POLLING_TIMEOUT_MS / 60000} minutes.`);
        } else {
            throw new Error("Flux task did not complete within the maximum polling attempts.");
        }

    } catch (error) {
        console.error("Error in placeTattooOnSkin function:", error);
        throw error;
    }
};
