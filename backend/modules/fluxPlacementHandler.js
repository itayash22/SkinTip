// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-23_V1.28_CONDITIONAL_BG_HANDLING'); // UPDATED VERSION LOG

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

// HELPER FUNCTION: To find the bounding box of the white area in a raw grayscale mask buffer
async function getMaskBoundingBox(maskBuffer, width, height) {
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let foundWhite = false;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixelValue = maskBuffer[y * width + x];
            if (pixelValue > 0) { // Assuming mask is grayscale where 0 is black and >0 is white/drawn area
                foundWhite = true;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }

    if (!foundWhite) {
        console.warn('WARNING: No white pixels found in mask. Bounding box is empty.');
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, isEmpty: true };
    }

    const padding = 0; // Keeping padding at 0 for now for exact fit
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width, maxX + padding);
    maxY = Math.min(height, maxY + padding);

    return {
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        isEmpty: false
    };
}


const fluxPlacementHandler = {

    /**
     * Inverts the colors of a Base64 encoded PNG mask image.
     */
    invertMask: async (maskBase64) => {
        const buffer = Buffer.from(maskBase64, 'base64');
        try {
            const invertedBuffer = await sharp(buffer)
                .ensureAlpha()
                .negate({ alpha: false })
                .png()
                .toBuffer();
            return invertedBuffer.toString('base64');
        } catch (error) {
            console.error('Error inverting mask:', error);
            throw new Error('Failed to invert mask image for Flux API. Make sure mask is a valid PNG.');
        }
    },

    /**
     * Applies a watermark to an image buffer and returns the watermarked image as a buffer.
     * Output format depends on the input image, so ensure it supports transparency if needed.
     */
    applyWatermark: async (imageBuffer) => {
        try {
            const watermarkText = 'SkinTip.AI';
            const watermarkSvg = `<svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
                                    <text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" fill-opacity="0.5">${watermarkText}</text>
                                    </svg>`;
            const svgBuffer = Buffer.from(watermarkSvg);

            const metadata = await sharp(imageBuffer).metadata();
            const imageWidth = metadata.width;
            const imageHeight = metadata.height;

            const svgWidth = 200;
            const svgHeight = 30;
            const padding = 15;

            const left = Math.max(0, imageWidth - svgWidth - padding);
            const top = Math.max(0, imageHeight - svgHeight - padding);

            const watermarkedSharp = sharp(imageBuffer)
                .composite([{
                    input: svgBuffer,
                    top: top,
                    left: left,
                    blend: 'over'
                }]);

            // Determine output format based on whether the original image had alpha
            if (metadata.hasAlpha) {
                return await watermarkedSharp.png().toBuffer(); // Preserve transparency
            } else {
                return await watermarkedSharp.jpeg({ quality: 90 }).toBuffer(); // Default to JPEG if no alpha
            }

        } catch (error) {
            console.error('Error applying watermark (caught):', error);
            return imageBuffer;
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     */
    // Adjusted to accept contentType for flexibility
    uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
        const filePath = `${userId}/${folder ? folder + '/' : ''}${fileName}`;
        const { data, error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType: contentType, // Use provided content type
                upsert: false
            });

        if (error) {
            console.error('Supabase upload error:', error);
            throw new Error(`Failed to upload image to storage: ${error.message}`);
        }

        const { data: publicUrlData } = supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .getPublicUrl(filePath);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            console.error('Supabase getPublicUrl error: No public URL returned', publicUrlData);
            throw new Error('Failed to get public URL for uploaded image.');
        }

        console.log('Image uploaded to Supabase:', publicUrlData.publicUrl);
        return publicUrlData.publicUrl;
    },

    /**
     * Calls the Flux Kontext API to place a tattoo design onto a skin image.
     * Handles all image preprocessing (resizing, mask inversion, watermarking, storage).
     * Now makes multiple Flux API calls to get multiple variations.
     */
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userPrompt, userId, numVariations, fluxApiKey) => {
        console.log('Starting Flux tattoo placement process...');

        // 1. Convert tattoo design Base64 to Buffer.
        let tattooDesignBuffer;
        let tattooMeta; // Declare tattooMeta here for broader scope
        try {
            tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
            tattooMeta = await sharp(tattooDesignBuffer).metadata(); // Get metadata early
            console.log(`Tattoo design original format: ${tattooMeta.format}, channels: ${tattooMeta.channels}, hasAlpha: ${tattooMeta.hasAlpha}`);

            // Ensure it's a PNG for consistent internal processing, even if input was JPG
            tattooDesignBuffer = await sharp(tattooDesignBuffer).png().toBuffer();
            console.log('Tattoo design image converted to PNG buffer for internal processing.');
        } catch (error) {
            console.error('Error processing tattoo design image base64:', error);
            throw new Error('Invalid tattoo design image data provided.');
        }

        // 2. Prepare Mask Buffer. Frontend mask is white for tattoo area, black elsewhere.
        const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
        let maskBuffer;
        let maskMetadata;
        try {
            maskMetadata = await sharp(originalMaskBuffer).metadata();
            maskBuffer = await sharp(originalMaskBuffer)
                .grayscale() // Ensure it's grayscale (1 channel)
                .raw()       // Get raw pixel data
                .toBuffer();
            console.log(`Mask buffer converted to raw grayscale. Dims: ${maskMetadata.width}x${maskMetadata.height}, channels: 1.`);
        } catch (error) {
            console.error('Error processing mask for Sharp composition:', error);
            throw new Error(`Failed to prepare mask for composition: ${error.message}`);
        }

        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;

        // --- Step 2.1: Determine the bounding box of the drawn mask area ---
        const maskBoundingBox = await getMaskBoundingBox(maskBuffer, maskMetadata.width, maskMetadata.height);
        if (maskBoundingBox.isEmpty) {
            throw new Error('Drawn mask area is too small or empty. Please draw a visible area.');
        }

        // --- Step 2.2: Conditional Transparency Handling for Tattoo Design ---
        let tattooDesignForComposition = tattooDesignBuffer; // This is now always a PNG buffer
        try {
            // Check original metadata for true alpha status, before any Sharp ops that add alpha
            if (tattooMeta.hasAlpha && tattooMeta.channels === 4) {
                 console.log('Tattoo design already has an explicit alpha channel. Preserving transparency.');
                 // No need for ensureAlpha() as it's already PNG with alpha.
                 // We simply use the already processed tattooDesignBuffer.
            } else {
                console.warn('Tattoo design does NOT have inherent transparency (e.g., JPG or opaque PNG). Attempting background removal heuristic.');

                // Get original pixel data to sample background color
                const { data: originalPixels, info: originalInfo } = await sharp(Buffer.from(tattooDesignImageBase64, 'base64'))
                    .raw()
                    .toBuffer({ resolveWithObject: true });

                const pixelSize = originalInfo.channels;
                const topLeftPixel = [];
                for (let c = 0; c < Math.min(pixelSize, 3); c++) { // Only check RGB for color detection
                    topLeftPixel.push(originalPixels[c]);
                }

                console.log('Top-left pixel of original tattoo design for background heuristic:', topLeftPixel);

                let isLikelyBlackBackground = false;
                let isLikelyWhiteBackground = false;

                if (pixelSize >= 3) { // Check RGB values
                    if (topLeftPixel[0] < 10 && topLeftPixel[1] < 10 && topLeftPixel[2] < 10) {
                        isLikelyBlackBackground = true;
                    }
                    if (topLeftPixel[0] > 245 && topLeftPixel[1] > 245 && topLeftPixel[2] > 245) {
                        isLikelyWhiteBackground = true;
                    }
                } else if (pixelSize === 1) { // Grayscale
                    if (topLeftPixel[0] < 10) {
                        isLikelyBlackBackground = true;
                    }
                    if (topLeftPixel[0] > 245) {
                        isLikelyWhiteBackground = true;
                    }
                }


                if (isLikelyBlackBackground || isLikelyWhiteBackground) {
                    console.log(`Detected a likely ${isLikelyBlackBackground ? 'black' : 'white'} background. Attempting to key it out.`);
                    tattooDesignForComposition = await sharp(tattooDesignBuffer) // Use the already PNG-converted buffer
                        .removeAlpha() // Remove any temporary alpha added by .png() if it was JPG initially
                        .toColourspace('srgb') // Ensure sRGB color space for consistent comparison
                        .ensureAlpha(isLikelyBlackBackground ? { background: { r: 0, g: 0, b: 0, alpha: 0 } } : { background: { r: 255, g: 255, b: 255, alpha: 0 } }) // Key out black or white with 0 alpha
                        .toBuffer();
                    console.log('Solid background removal applied using color keying.');
                } else {
                    console.warn('No common solid background (black/white) detected or background is not uniform. Tattoo will retain opaque background.');
                    tattooDesignForComposition = await sharp(tattooDesignBuffer).ensureAlpha().toBuffer(); // Just ensure alpha without removing background
                }
            }
        } catch (bgRemovalError) {
            console.error('ERROR: Failed during conditional background removal processing. Proceeding with original opaque PNG buffer.', bgRemovalError.message);
            tattooDesignForComposition = await sharp(tattooDesignBuffer).ensureAlpha().toBuffer(); // Fallback: just ensure alpha, keep opaque background
        }
        // --- END Step 2.2 ---

        // --- Step 2.3: Resize the tattoo design to fit the mask's bounding box and prepare for placement ---
        let tattooForPlacement;
        try {
            tattooForPlacement = await sharp(tattooDesignForComposition) // Use the conditionally processed buffer
                .resize(maskBoundingBox.width, maskBoundingBox.height, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 } // Ensures transparent background if tattoo is smaller than bounding box
                })
                .toBuffer();
            console.log(`Tattoo design resized specifically for mask bounding box: ${maskBoundingBox.width}x${maskBoundingBox.height}.`);
        } catch (error) {
            console.error('Error resizing tattoo design for placement:', error);
            throw new Error('Failed to resize tattoo design for placement within mask area.');
        }

        // 3. **Manual Composition with Sharp (Hybrid Approach Step 1)**
        let compositedImageBuffer;
        try {
            compositedImageBuffer = await sharp(skinImageBuffer)
                .composite([
                    {
                        input: tattooForPlacement,
                        blend: 'over',
                        tile: false,
                        left: maskBoundingBox.minX,
                        top: maskBoundingBox.minY,
                        mask: maskBuffer // Apply the drawn mask here
                    }
                ])
                .png() // <--- OUTPUT AS PNG TO PRESERVE FINAL TRANSPARENCY!
                .toBuffer();
            console.log('Tattoo manually composited onto skin image with correct sizing, positioning, and clipping. Output format: PNG.');

            // --- DEBUGGING STEP: UPLOAD AND LOG INTERMEDIATE IMAGE ---
            try {
                const debugFileName = `debug_sharp_composite_${uuidv4()}.png`; // Changed file extension
                const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                    compositedImageBuffer,
                    debugFileName,
                    userId,
                    'debug',
                    'image/png' // Changed content type for debugging output
                );
                console.log(`--- DEBUG: SHARP COMPOSITED IMAGE URL: ${debugPublicUrl} ---`);
                console.log('^ Please check this URL in your browser to verify Sharp\'s output.');
            } catch (debugUploadError) {
                console.error('DEBUG ERROR: Failed to upload intermediate Sharp composite image:', debugUploadError);
            }
            // --- END DEBUGGING STEP ---

        } catch (error) {
            console.error('Error during manual image composition (Phase 1) with positioning:', error);
            throw new Error(`Failed to composite tattoo onto skin with correct positioning: ${error.message}`);
        }

        // 4. Prepare for multiple Flux API calls
        const generatedImageUrls = [];
        const basePrompt = `Make the tattoo look naturally placed on the skin, blend seamlessly, adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`;

        console.log(`Making ${numVariations} calls to Flux API...`);

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i; // Vary seed for different results

            const fluxPayload = {
                prompt: basePrompt,
                // Pass the *composited* image (now a PNG with potentially transparent background) to Flux
                input_image: compositedImageBuffer.toString('base64'),
                mask_image: '', // Flux API uses the mask for inpainting, but here we provide a full background image
                n: 1, // Request 1 variation per call
                output_format: 'jpeg', // Flux API might still prefer JPEG as output for final result
                fidelity: 0.5, // Adjusted fidelity for more blending
                guidance_scale: 8.0, // Adjusted guidance_scale
                seed: currentSeed
            };

            const fluxHeaders = {
                'Content-Type': 'application/json',
                'x-key': fluxApiKey
            };

            let fluxResponse;
            try {
                fluxResponse = await axios.post(
                    'https://api.bfl.ai/v1/flux-kontext-pro',
                    fluxPayload,
                    {
                        headers: fluxHeaders,
                        timeout: 90000
                    }
                );
                console.log(`DEBUG: Initial Flux POST response status for variation ${i+1}: ${fluxResponse.status}`);
                console.log(`DEBUG: Initial Flux POST response data for variation ${i+1}:`, JSON.stringify(fluxResponse.data, null, 2));

            } catch (error) {
                console.error(`Flux API call for variation ${i + 1} failed:`, error.response?.data || error.message);
                console.warn(`Skipping variation ${i + 1} due to API call failure.`);
                continue;
            }

            const taskId = fluxResponse.data.id;
            const pollingUrl = fluxResponse.data.polling_url;
            if (!taskId || !pollingUrl) {
                console.error(`Flux API for variation ${i + 1} did not return a task ID or polling URL:`, fluxResponse.data);
                console.warn(`Skipping variation ${i + 1} due to missing task ID or polling URL.`);
                continue;
            }

            // Poll for results for THIS specific task ID and URL
            let attempts = 0;
            let currentImageReady = false;
            while (attempts < 60 && !currentImageReady) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));

                const result = await axios.get(
                    pollingUrl,
                    {
                        headers: { 'x-key': fluxApiKey },
                        timeout: 10000
                    }
                );

                console.log(`Flux Polling Result Data for Task ${taskId} (Attempt ${attempts}):`, JSON.stringify(result.data, null, 2));

                if (result.data.status === 'Content Moderated') {
                    const moderationReason = result.data.details && result.data.details['Moderation Reasons'] ?
                                            result.data.details['Moderation Reasons'].join(', ') : 'Unknown reason';
                    console.error(`Flux API Polling terminated for Task ${taskId}: Content Moderated. Reason: ${moderationReason}`);
                    console.warn(`Skipping variation ${i + 1} due to content moderation.`);
                    currentImageReady = true;
                } else if (result.data.status === 'Error') {
                    console.error(`Flux API Polling Error for Task ${taskId}:`, result.data);
                    console.warn(`Skipping variation ${i + 1} due to Flux API error during polling.`);
                    currentImageReady = true;
                } else if (result.data.status === 'Ready') {
                    const imageUrlFromFlux = result.data.result && result.data.result.sample;

                    if (imageUrlFromFlux) {
                        let imageBuffer;
                        try {
                            const imageResponse = await axios.get(imageUrlFromFlux, { responseType: 'arraybuffer' });
                            imageBuffer = Buffer.from(imageResponse.data);
                            console.log(`Successfully downloaded image from Flux URL for Task ${taskId}: ${imageUrlFromFlux.substring(0, 50)}...`);
                        } catch (downloadError) {
                            console.error(`Error downloading image from Flux URL for Task ${taskId}:`, imageUrlFromFlux, downloadError.message);
                            console.warn(`Skipping variation ${i + 1} due to download error.`);
                            currentImageReady = true;
                            continue;
                        }

                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
                        const fileName = `tattoo-${uuidv4()}.jpeg`; // File extension still JPEG for final result from Flux
                        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId, '', 'image/jpeg'); // Flux outputs JPEG, so save as JPEG
                        generatedImageUrls.push(publicUrl);
                        console.log(`Successfully generated and watermarked 1 image for variation ${i + 1}.`);
                        currentImageReady = true;
                    } else {
                        console.warn(`Flux API for Task ${taskId} returned Ready status but no valid image URL found in "sample".`, result.data);
                        console.warn(`Skipping variation ${i + 1} due to malformed Flux output.`);
                        currentImageReady = true;
                    }
                } else {
                    console.log(`Polling attempt ${attempts}: ${result.data.status} for Task ${taskId}.`);
                }
            }

            if (!currentImageReady) {
                console.warn(`Refinement timeout for variation ${i + 1}: No image was generated within the time limit.`);
            }
        } // End of for loop for multiple variations

        if (generatedImageUrls.length === 0) {
            throw new Error('Flux API: No images were generated across all attempts. Please try again or with a different design.');
        }

        return generatedImageUrls;
    }
};

export default fluxPlacementHandler;
