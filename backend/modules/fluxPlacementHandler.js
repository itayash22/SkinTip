// backend/modules/fluxPlacementHandler.js

import axios from 'axios';
import sharp from 'sharp'; // Make sure 'sharp' is installed: npm install sharp
import { createClient } from '@supabase/supabase-js'; // Make sure '@supabase/supabase-js' is installed: npm install @supabase/supabase-js

// Initialize Supabase Client
// Ensure these environment variables are set in your Render environment:
// SUPABASE_URL=YOUR_SUPABASE_URL
// SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Helper function for delays (to avoid busy waiting)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Ensure crypto is available (Node.js 15.0.0+ for crypto.randomUUID())
// For older Node.js versions, you might need to install 'uuid': npm install uuid
// import { v4 as uuidv4 } from 'uuid';
const generateUuid = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback for environments where crypto.randomUUID is not available (e.g., older Node.js)
    // In a production environment, it's highly recommended to use a robust UUID library like 'uuid'
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const placeTattooOnSkin = async (skinImageBuffer, tattooDesignBuffer, maskBuffer) => {
    try {
        console.log("Starting Flux tattoo placement process (V1.48 Base with PNG End-to-End)...");

        // --- Step 1: Pre-process images for Flux input ---
        // Your existing image processing logic using sharp, adjusted for clarity and common pitfalls.
        // Ensure inputs are buffers.

        // Get metadata for initial dimensions
        const skinImageMetadata = await sharp(skinImageBuffer).metadata();
        const tattooDesignMetadata = await sharp(tattooDesignBuffer).metadata();
        const maskMetadata = await sharp(maskBuffer).metadata();

        console.log(`Skin Image Dims: ${skinImageMetadata.width}x${skinImageMetadata.height}`);
        console.log(`Tattoo Design Dims: ${tattooDesignMetadata.width}x${tattooDesignMetadata.height}`);
        console.log(`Mask Dims: ${maskMetadata.width}x${maskMetadata.height}`);

        // --- Important: Mask Bounding Box Calculation ---
        // This is a placeholder. You need to implement the actual logic to calculate the bounding box
        // from your maskBuffer. The values below are from your logs but need to be dynamically determined.
        // If your mask is a binary image where white indicates the tattoo area, you'd iterate pixels
        // to find min/max X/Y.
        let maskBoundingBox = {
            minX: 354, // Placeholder from logs
            minY: 296, // Placeholder from logs
            maxX: 603, // Placeholder from logs
            maxY: 576, // Placeholder from logs
            width: 250, // Placeholder from logs (maxX - minX + 1)
            height: 281, // Placeholder from logs (maxY - minY + 1)
            isEmpty: false // Placeholder
        };
        console.log("DEBUG: Calculated Mask Bounding Box:", maskBoundingBox);

        // Ensure tattoo design has an alpha channel. If it doesn't, add one.
        let processedTattooDesignBuffer = tattooDesignBuffer;
        if (tattooDesignMetadata.channels !== 4 && tattooDesignMetadata.hasAlpha !== true) {
            console.log("Tattoo design image does not have an alpha channel. Adding one.");
            processedTattooDesignBuffer = await sharp(tattooDesignBuffer)
                .ensureAlpha() // Add an alpha channel
                .toBuffer();
        } else {
            console.log("Tattoo design image already has an alpha channel.");
        }


        // Resize tattoo design specifically for the mask bounding box dimensions
        const resizedTattooDesignBuffer = await sharp(processedTattooDesignBuffer)
            .resize(maskBoundingBox.width, maskBoundingBox.height, {
                fit: sharp.fit.inside, // Ensures the entire tattoo fits within the bounds
                withoutEnlargement: true // Prevents upscaling if tattoo is smaller than bounding box
            })
            .png() // Ensure output is PNG for compositing
            .toBuffer();
        console.log(`Tattoo design resized specifically for mask bounding box: ${maskBoundingBox.width}x${maskBoundingBox.height}.`);


        // Manually composite tattoo onto the full skin image
        // Using 'over' blend mode is typical for transparent overlays. 'overlay' is more for blending colors.
        const fullCompositeImageBuffer = await sharp(skinImageBuffer)
            .composite([{
                input: resizedTattooDesignBuffer,
                left: maskBoundingBox.minX,
                top: maskBoundingBox.minY,
                // Ensure the tattoo design's alpha channel is used for blending
                // If your tattoo PNG has transparency, 'over' is generally what you want.
                // 'overlay' performs a different kind of blending.
                blend: 'over'
            }])
            .png() // Ensure the final output format is PNG for Flux
            .toBuffer();
        console.log("Tattoo manually composited onto full skin image (PNG format for Flux input).");


        // --- Step 2: Upload composited image to Supabase and get URL for Flux ---
        const fileName = `debug_sharp_full_composite_${generateUuid()}.png`;
        const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('generated-tattoos') // Ensure this bucket exists in Supabase
            .upload(`debug/${fileName}`, fullCompositeImageBuffer, {
                contentType: 'image/png',
                upsert: true, // Overwrite if file with same name exists (optional)
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
        // Ensure process.env.FLUX_API_KEY is set in your Render environment
        if (!process.env.FLUX_API_KEY) {
            throw new Error("FLUX_API_KEY environment variable is not set.");
        }

        // IMPORTANT: Use the exact endpoint provided by Flux documentation for initiation.
        // Your logs suggest a POST to 'api.us1.bfl.ai/v1/generate_tattoo' based on polling_url prefix.
        // Double-check Flux API documentation for the correct initiation endpoint and payload.
        const initialFluxResponse = await axios.post(
            'https://api.us1.bfl.ai/v1/generate_tattoo', // This is an assumed initiation endpoint.
                                                         // Verify this with Flux API documentation.
            {
                input_image_url: imageUrl,
                // Add any other parameters Flux expects for initiating the tattoo placement.
                // Example:
                // mask_url: '...',
                // tattoo_design_url: '...'
                // If Flux expects separate URLs for skin, tattoo, and mask, adjust this payload
                // and the image preprocessing steps accordingly. Based on your logs, you're
                // sending a single composited image, which is simpler for Flux if it accepts that.
            },
            {
                headers: {
                    'x-key': process.env.FLUX_API_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // Timeout for the initial POST request (30 seconds)
            }
        );

        const fluxTaskId = initialFluxResponse.data.id;
        // CRITICAL FIX: Use the exact polling_url returned by Flux
        const pollingUrl = initialFluxResponse.data.polling_url;

        console.log("DEBUG: Initial Flux POST response data:", initialFluxResponse.data);

        if (!fluxTaskId || !pollingUrl) {
            throw new Error("Flux API did not return a valid task ID or polling URL.");
        }

        // --- Step 4: Poll Flux API for results with retry logic and exact URL ---
        const MAX_POLLING_ATTEMPTS = 60; // Increased attempts, adjust based on expected processing time
        let currentAttempt = 0;
        let result = null;
        const initialPollDelayMs = 2000; // Initial delay before first poll (2 seconds)
        const maxPollDelayMs = 10000; // Max delay between polls (10 seconds)
        const totalPollingTimeoutMs = 5 * 60 * 1000; // 5 minutes total polling time
        const pollingStartTime = Date.now();

        while (currentAttempt < MAX_POLLING_ATTEMPTS && (Date.now() - pollingStartTime) < totalPollingTimeoutMs) {
            currentAttempt++;
            // Exponential backoff with a cap
            const delayTime = Math.min(initialPollDelayMs * Math.pow(1.5, currentAttempt - 1), maxPollDelayMs);
            console.log(`Polling Flux API. Attempt ${currentAttempt}/${MAX_POLLING_ATTEMPTS}. Waiting for ${delayTime / 1000} seconds. Total elapsed: ${(Date.now() - pollingStartTime) / 1000}s`);
            await delay(delayTime); // Wait before polling

            try {
                // Use the EXACT pollingUrl returned by Flux
                const pollResponse = await axios.get(pollingUrl, {
                    headers: {
                        'x-key': process.env.FLUX_API_KEY,
                    },
                    timeout: 20000, // Timeout for individual polling request (20 seconds)
                });

                const fluxStatus = pollResponse.data.status;
                console.log(`Flux Poll Status (Attempt ${currentAttempt}): ${fluxStatus}`);

                if (fluxStatus === 'completed') {
                    result = pollResponse.data.result;
                    console.log("Flux task completed successfully. Result:", result);
                    return result; // Return the final result
                } else if (fluxStatus === 'failed' || fluxStatus === 'error') {
                    console.error("Flux task failed or encountered an error:", pollResponse.data.details);
                    throw new Error(`Flux task failed: ${fluxStatus} - ${pollResponse.data.details || 'No details provided.'}`);
                }
                // If status is 'pending', 'processing', etc., continue polling
            } catch (pollError) {
                if (axios.isAxiosError(pollError)) {
                    if (pollError.response) {
                        console.error(`Axios error during Flux polling (Status: ${pollError.response.status}, Data: ${JSON.stringify(pollError.response.data)}):`, pollError.message);
                        if (pollError.response.status === 404 && pollError.response.data?.status === 'Task not found') {
                            // This is the error we previously identified.
                            // If you've ensured the pollingUrl is exact, this points to Flux side issue.
                            console.warn("Flux reported 'Task not found' during polling despite using correct polling URL. This is unexpected for an active task.");
                            // Continue retrying as it might be a temporary state, but be ready to contact Flux.
                        } else if (pollError.response.status >= 500) {
                            console.warn("Flux server error during polling. Retrying...");
                        } else if (pollError.response.status === 401 || pollError.response.status === 403) {
                             console.error("Authentication/Authorization error with Flux API. Check your x-key.");
                             throw new Error("Flux API authentication failed. Check x-key.");
                        }
                    } else if (pollError.request) {
                        console.warn(`Flux polling request timed out or no response (Attempt ${currentAttempt}). Retrying...`);
                    } else {
                        console.error("Error setting up Flux polling request:", pollError.message);
                        throw pollError; // Re-throw if request setup itself failed
                    }
                } else {
                    console.error("Non-Axios error during Flux polling:", pollError);
                    throw pollError; // Re-throw other unexpected errors
                }
            }
        }

        // If loop exits without returning, it means it timed out or hit max attempts
        if ((Date.now() - pollingStartTime) >= totalPollingTimeoutMs) {
            throw new Error(`Flux task did not complete within the total polling timeout of ${totalPollingTimeoutMs / 60000} minutes.`);
        } else {
            throw new Error("Flux task did not complete within the maximum polling attempts.");
        }

    } catch (error) {
        console.error("API Error in /api/generate-final-tattoo:", error);
        // Ensure errors are thrown consistently to be caught by the calling endpoint
        throw error;
    }
};
