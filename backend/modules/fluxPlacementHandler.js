// backend/modules/fluxPlacementHandler.js

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid'; // Using uuid package for robust UUID generation

// Initialize Supabase Client
// These environment variables MUST be set in your Render environment.
// e.g., SUPABASE_URL=https://your-project-id.supabase.co
// e.g., SUPABASE_ANON_KEY=your-anon-public-key
const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Helper function for delays (to avoid busy waiting)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const placeTattooOnSkin = async (skinImageBuffer, tattooDesignBuffer, maskBuffer) => {
    try {
        console.log("Starting Flux tattoo placement process (V1.48 Base with PNG End-to-End)...");

        // --- Step 1: Pre-process images for Flux input ---
        // Get metadata for initial dimensions
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
        // A common approach is to analyze the grayscale mask to find the active region.
        // For example, if your mask is a binary image where white (255) means the tattoo goes here.
        // You would load the mask, get its raw pixels, and iterate to find the extents.
        //
        // Example (Conceptual - needs actual implementation based on your mask format):
        // const { data: maskPixels, info: maskInfo } = await sharp(maskBuffer).raw().toBuffer({ resolveWithObject: true });
        // let minX = maskInfo.width, minY = maskInfo.height, maxX = 0, maxY = 0;
        // let foundPixel = false;
        // for (let y = 0; y < maskInfo.height; y++) {
        //     for (let x = 0; x < maskInfo.width; x++) {
        //         const i = (y * maskInfo.width + x) * maskInfo.channels;
        //         if (maskPixels[i] > 0) { // Assuming non-zero for active mask area
        //             minX = Math.min(minX, x);
        //             minY = Math.min(minY, y);
        //             maxX = Math.max(maxX, x);
        //             maxY = Math.max(maxY, y);
        //             foundPixel = true;
        //         }
        //     }
        // }
        // const maskBoundingBox = foundPixel ?
        //     { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, isEmpty: false } :
        //     { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, isEmpty: true };
        //
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
        if (tattooDesignMetadata.channels < 4) { // If it's RGB or grayscale, add alpha
            console.log("Tattoo design image does not have an alpha channel. Adding one.");
            processedTattooDesignBuffer = await sharp(tattooDesignBuffer)
                .ensureAlpha()
                .toBuffer();
        } else {
            console.log("Tattoo design image already has an alpha channel.");
        }

        // Resize tattoo design specifically for the mask bounding box dimensions
        const resizedTattooDesignBuffer = await sharp(processedTattooDesignBuffer)
            .resize(maskBoundingBox.width, maskBoundingBox.height, {
                fit: sharp.fit.inside, // Ensures the entire tattoo fits within the bounds without stretching
                withoutEnlargement: true, // Prevents upscaling if tattoo is smaller than bounding box
                kernel: sharp.kernel.lanczos3 // Good quality resizing
            })
            .png() // Ensure output is PNG for compositing
            .toBuffer();
        console.log(`Tattoo design resized specifically for mask bounding box: ${maskBoundingBox.width}x${maskBoundingBox.height}.`);

        // Manually composite tattoo onto the full skin image
        // 'over' blend mode is for regular alpha blending (tattoo over skin)
        const fullCompositeImageBuffer = await sharp(skinImageBuffer)
            .composite([{
                input: resizedTattooDesignBuffer,
                left: maskBoundingBox.minX,
                top: maskBoundingBox.minY,
                blend: 'over'
            }])
            .png() // Ensure the final output format is PNG for Flux input
            .toBuffer();
        console.log("Tattoo manually composited onto full skin image (PNG format for Flux input).");


        // --- Step 2: Upload composited image to Supabase and get URL for Flux ---
        const fileName = `debug_sharp_full_composite_${uuidv4()}.png`;
        const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('generated-tattoos') // Ensure this bucket exists in your Supabase project
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
        // Ensure process.env.FLUX_API_KEY is set in your Render environment variables.
        if (!process.env.FLUX_API_KEY) {
            throw new Error("FLUX_API_KEY environment variable is not set. Cannot proceed with Flux API call.");
        }

        // IMPORTANT: Verify this initiation endpoint ('/v1/generate_tattoo') and the payload
        // with the official Flux API documentation. This is an assumption based on your polling URL.
        const initialFluxResponse = await axios.post(
            'https://api.us1.bfl.ai/v1/generate_tattoo', // <-- Verify this exact endpoint for POST
            {
                input_image_url: imageUrl,
                // Add any other specific parameters Flux requires for this operation.
                // If Flux needs separate skin, tattoo, and mask URLs, adjust this payload
                // and the image preprocessing steps accordingly.
            },
            {
                headers: {
                    'x-key': process.env.FLUX_API_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30 seconds timeout for the initial POST request
            }
        );

        const fluxTaskId = initialFluxResponse.data.id;
        const pollingUrl = initialFluxResponse.data.polling_url; // CRITICAL: Use this exact URL for polling!

        console.log("DEBUG: Initial Flux POST response data:", initialFluxResponse.data);

        if (!fluxTaskId || !pollingUrl) {
            throw new Error("Flux API did not return a valid task ID or polling URL in its initial response.");
        }

        // --- Step 4: Poll Flux API for results with retry logic and exact URL ---
        const MAX_POLLING_ATTEMPTS = 60; // Max polling attempts
        const POLLING_INTERVAL_MS = 2000; // Initial delay of 2 seconds
        const MAX_POLLING_INTERVAL_MS = 10000; // Max delay between polls (10 seconds)
        const TOTAL_POLLING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total polling time
        const pollingStartTime = Date.now();
        let currentAttempt = 0;
        let result = null;

        while (currentAttempt < MAX_POLLING_ATTEMPTS && (Date.now() - pollingStartTime) < TOTAL_POLLING_TIMEOUT_MS) {
            currentAttempt++;
            // Exponential backoff with a cap: 2s, 3s, 4.5s, 6.75s, 10s, 10s, ...
            const currentDelay = Math.min(POLLING_INTERVAL_MS * Math.pow(1.5, currentAttempt - 1), MAX_POLLING_INTERVAL_MS);
            console.log(`Polling Flux API. Attempt ${currentAttempt}/${MAX_POLLING_ATTEMPTS}. Next poll in ${currentDelay / 1000}s.`);
            await delay(currentDelay); // Wait before the next poll request

            try {
                // Use the EXACT pollingUrl returned by Flux, including the 'us1' subdomain
                const pollResponse = await axios.get(pollingUrl, {
                    headers: {
                        'x-key': process.env.FLUX_API_KEY,
                    },
                    timeout: 20000, // 20 seconds timeout for each polling request
                });

                const fluxStatus = pollResponse.data.status;
                console.log(`Flux Poll Status (Attempt ${currentAttempt}): ${fluxStatus}`);

                if (fluxStatus === 'completed') {
                    result = pollResponse.data.result;
                    console.log("Flux task completed successfully. Result:", result);
                    return result; // Task finished, return result
                } else if (fluxStatus === 'failed' || fluxStatus === 'error') {
                    console.error("Flux task failed or encountered an error:", pollResponse.data.details || 'No details provided.');
                    throw new Error(`Flux task failed: ${fluxStatus} - ${pollResponse.data.details || 'Check Flux logs for more info.'}`);
                }
                // If status is 'pending', 'processing', etc., the loop will continue.

            } catch (pollError) {
                if (axios.isAxiosError(pollError)) {
                    if (pollError.response) {
                        console.error(`Axios error during Flux polling (Status: ${pollError.response.status}, Data: ${JSON.stringify(pollError.response.data)}): ${pollError.message}`);
                        if (pollError.response.status === 404 && pollError.response.data?.status === 'Task not found') {
                            // This is the specific 404 we identified. If pollingUrl is correct, this
                            // indicates the task may have expired or was never valid on Flux's end.
                            console.warn("Flux reported 'Task not found' during polling. This is unexpected for an active task ID, but continuing retry.");
                        } else if (pollError.response.status === 401 || pollError.response.status === 403) {
                            console.error("Authentication/Authorization error with Flux API. Check your x-key environment variable.");
                            throw new Error("Flux API authentication/authorization failed. Please verify your FLUX_API_KEY.");
                        } else if (pollError.response.status >= 500) {
                            console.warn("Flux server error (5xx) during polling. Retrying...");
                        }
                    } else if (pollError.request) {
                        // The request was made but no response was received (e.g., network issue, timeout)
                        console.warn(`Flux polling request timed out or network error (Attempt ${currentAttempt}). Retrying...`);
                    } else {
                        // Something happened in setting up the request that triggered an Error
                        console.error("Error setting up Flux polling request:", pollError.message);
                        throw pollError; // Re-throw fatal setup errors
                    }
                } else {
                    console.error("Non-Axios error during Flux polling:", pollError);
                    throw pollError; // Re-throw other unexpected errors
                }
            }
        }

        // If the loop finishes without returning a result (i.e., task didn't complete)
        if ((Date.now() - pollingStartTime) >= TOTAL_POLLING_TIMEOUT_MS) {
            throw new Error(`Flux task did not complete within the total polling timeout of ${TOTAL_POLLING_TIMEOUT_MS / 60000} minutes.`);
        } else {
            throw new Error("Flux task did not complete within the maximum polling attempts.");
        }

    } catch (error) {
        console.error("Error in placeTattooOnSkin function:", error);
        // Ensure errors are re-thrown so the calling API endpoint can handle them
        throw error;
    }
};
