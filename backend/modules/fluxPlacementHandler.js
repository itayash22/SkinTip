// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-23_V1.38_FINAL_ALL_FIXES'); // UPDATED VERSION LOG

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data'; // Important for Node.js environments when sending FormData with axios

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

// Get Remove.bg API Key
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY; // Make sure to set this in Render environment variables!

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
     * Calls Remove.bg API to remove background from an image buffer.
     * Returns a buffer of the image with background removed (always PNG).
     */
    removeImageBackground: async (imageBuffer) => {
        if (!REMOVE_BG_API_KEY) {
            console.warn('REMOVE_BG_API_KEY is not set. Skipping background removal and returning original image as PNG.');
            return await sharp(imageBuffer).png().toBuffer(); // Ensure it's PNG even if no removal
        }

        try {
            console.log('Calling Remove.bg API for background removal...');
            const formData = new FormData();
            // Keep as-is (relevant changes are elsewhere)
            formData.append('image_file', new Blob([imageBuffer], { type: 'image/png' }), 'tattoo_design.png'); // Send as PNG
            formData.append('size', 'auto');
            formData.append('format', 'png'); // Request PNG output from remove.bg

            const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
                headers: {
                    'X-Api-Key': REMOVE_BG_API_KEY,
                    ...formData.getHeaders() // Important for FormData
                },
                responseType: 'arraybuffer' // To get the image data as a buffer
            });

            if (response.status === 200) {
                console.log('Background removed successfully by Remove.bg.');
                return Buffer.from(response.data); // Returns PNG buffer from remove.bg
            } else {
                const errorResponseData = response.data.toString();
                console.error('Remove.bg API error:', response.status, response.statusText, errorResponseData);
                throw new Error(`Remove.bg API failed with status ${response.status}: ${errorResponseData.substring(0, 100)}`);
            }
        } catch (error) {
            console.error('Error calling Remove.bg API:', error.response?.data?.toString() || error.message);
            // If remove.bg fails, proceed with the original image but ensure it's a PNG
            console.warn('Background removal failed. Proceeding with original tattoo design (may have background).');
            return await sharp(imageBuffer).png().toBuffer();
        }
    },

    /**
     * Applies a watermark to an image buffer and returns the watermarked image as a buffer.
     * Always outputs PNG to preserve transparency.
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

            // Force output to PNG to always preserve transparency
            return await sharp(imageBuffer)
                .composite([{
                    input: svgBuffer,
                    top: top,
                    left: left,
                    blend: 'over'
                }])
                .png() // Always output as PNG
                .toBuffer();

        } catch (error) {
            console.error('Error applying watermark (caught):', error);
            return imageBuffer; // Return original if error
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     */
    uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
        // Ensure correct path construction without double slashes
        const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
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
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, numVariations, fluxApiKey, tattooAngle = 0, tattooScale = 1.0) => {
        // 1. Convert tattoo design Base64 to Buffer.
        let tattooDesignOriginalBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
        let tattooMeta = await sharp(tattooDesignOriginalBuffer).metadata();
        console.log(`Original tattoo design input meta: format=${tattooMeta.format}, channels=${tattooMeta.channels}, hasAlpha=${tattooMeta.hasAlpha}`);

        // --- Step 2.2: Perform Background Removal using Remove.bg API (always outputs PNG with alpha) ---
        let tattooDesignPngWithRemovedBackground = await fluxPlacementHandler.removeImageBackground(tattooDesignOriginalBuffer);

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
        console.log(`Skin image meta: format=${skinMetadata.format}, channels=${skinMetadata.channels}, hasAlpha=${skinMetadata.hasAlpha}`);

        // --- Normalize mask -> skin size for consistent coordinates ---
        const maskPngSameAsSkin = await sharp(originalMaskBuffer)
            .resize({ width: skinWidth, height: skinHeight })
            .grayscale()
            .png()
            .toBuffer();

        // --- Step 2.1: Determine the bounding box of the drawn mask area (original coords) ---
        const maskBoundingBox = await getMaskBoundingBox(maskBuffer, maskMetadata.width, maskMetadata.height);
        if (maskBoundingBox.isEmpty) {
            throw new Error('Drawn mask area is too small or empty. Please draw a visible area.');
        }

        // --- Recompute bbox in skin-space using scale factors ---
        const scaleX = skinWidth / maskMetadata.width;
        const scaleY = skinHeight / maskMetadata.height;
        const bboxSkin = {
            minX: Math.round(maskBoundingBox.minX * scaleX),
            minY: Math.round(maskBoundingBox.minY * scaleY),
            width: Math.round(maskBoundingBox.width * scaleX),
            height: Math.round(maskBoundingBox.height * scaleY)
        };

        // --- Step 2.3: Resize, Rotate, and Position the tattoo to match frontend preview ---
        let tattooForPlacement;
        let placementLeft;
        let placementTop;

        try {
            console.log(`--- TATTOO TRANSFORM DEBUG START ---`);
            console.log(`LOG: tattooAngle=${tattooAngle}, tattooScale=${tattooScale}`);
            console.log(`LOG: BBOX (skin space): x=${bboxSkin.minX}, y=${bboxSkin.minY}, w=${bboxSkin.width}, h=${bboxSkin.height}`);

            // Remove arbitrary magnification; rely on tattooScale and bbox size only
            const targetWidth = Math.round(bboxSkin.width * tattooScale);
            const targetHeight = Math.round(bboxSkin.height * tattooScale);

            // Step 1: Resize the tattoo (single high-quality resize)
            const resizedTattooBuffer = await sharp(tattooDesignPngWithRemovedBackground)
                .resize({
                    width: targetWidth,
                    height: targetHeight,
                    fit: sharp.fit.inside,
                    withoutEnlargement: false,
                    kernel: sharp.kernel.lanczos3 // swap to sharp.kernel.nearest for very line-art designs
                })
                .toBuffer();
            const resizedMeta = await sharp(resizedTattooBuffer).metadata();
            console.log(`LOG: RESIZED (pre-rotation): ${resizedMeta.width}x${resizedMeta.height}`);

            // Step 2: Rotate the resized tattoo (expand canvas)
            const rotatedTattooBuffer = await sharp(resizedTattooBuffer)
                .rotate(tattooAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toBuffer();
            const rotatedMeta = await sharp(rotatedTattooBuffer).metadata();
            tattooForPlacement = rotatedTattooBuffer;
            console.log(`LOG: ROTATED (final): ${rotatedMeta.width}x${rotatedMeta.height}`);

            // Step 3: Calculate final position in skin-space (center within bbox)
            placementLeft = Math.round(bboxSkin.minX + (bboxSkin.width - rotatedMeta.width) / 2);
            placementTop = Math.round(bboxSkin.minY + (bboxSkin.height - rotatedMeta.height) / 2);

            // Clamp placement to ensure some overlap with the canvas (prevents total cut-away)
            placementLeft = Math.max(-rotatedMeta.width, Math.min(placementLeft, skinWidth));
            placementTop  = Math.max(-rotatedMeta.height, Math.min(placementTop,  skinHeight));

            console.log(`LOG: FINAL PLACEMENT: top=${placementTop}, left=${placementLeft}`);
            console.log(`--- TATTOO TRANSFORM DEBUG END ---`);

        } catch (error) {
            console.error('Error resizing or positioning tattoo design:', error);
            throw new Error('Failed to resize tattoo design for placement within the mask area.');
        }

        // --- Deterministic composition with proper masking and premultiplication ---
        let compositedImageBuffer;
        let tattooMaskedSharp; // keep for post-FLUX clamp
        try {
            // 1) Place the rotated tattoo on a transparent full-size canvas
            const tattooCanvas = await sharp({
                create: {
                    width: skinWidth,
                    height: skinHeight,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
                .composite([
                    {
                        input: tattooForPlacement,
                        left: placementLeft,
                        top: placementTop
                    }
                ])
                .png()
                .toBuffer();

            // 2) Punch the canvas with the (resized) mask so the tattoo is confined to the user-painted region
            const tattooMasked = await sharp(tattooCanvas)
                .composite([{ input: maskPngSameAsSkin, blend: 'dest-in' }]) // keep only where mask is white
                .png()
                .toBuffer();

            // --- AUTO-RECOVERY: detect inverted/empty mask and retry with inverted mask if needed ---
            let needInvert = false;
            const metaMasked = await sharp(tattooMasked).metadata();
            if (metaMasked.channels === 4) {
                const raw = await sharp(tattooMasked).ensureAlpha().raw().toBuffer();
                let alphaSum = 0;
                for (let i = 3; i < raw.length; i += 4) alphaSum += raw[i];
                const alphaAvg = alphaSum / (metaMasked.width * metaMasked.height);
                if (alphaAvg < 1) {
                    console.warn('Mask likely inverted or empty. Alpha average ≈ 0 after dest-in. Will try inverted mask.');
                    needInvert = true;
                }
            }

            let tattooMaskedFixed = tattooMasked;
            if (needInvert) {
                const invertedMask = await sharp(maskPngSameAsSkin)
                    .linear(-1, 255) // invert grayscale: new = -old + 255
                    .png()
                    .toBuffer();

                tattooMaskedFixed = await sharp(tattooCanvas)
                    .composite([{ input: invertedMask, blend: 'dest-in' }])
                    .png()
                    .toBuffer();

                // Sanity check again (log only)
                const raw2 = await sharp(tattooMaskedFixed).ensureAlpha().raw().toBuffer();
                let alphaSum2 = 0;
                for (let i = 3; i < raw2.length; i += 4) alphaSum2 += raw2[i];
                const alphaAvg2 = alphaSum2 / (metaMasked.width * metaMasked.height);
                console.log(`Alpha avg after inverted dest-in: ${alphaAvg2.toFixed(2)}`);

                // Optional: upload debug layers
                try {
                    const maskUrl = await fluxPlacementHandler.uploadToSupabaseStorage(maskPngSameAsSkin, `debug_mask_${uuidv4()}.png`, userId, 'debug', 'image/png');
                    const invUrl  = await fluxPlacementHandler.uploadToSupabaseStorage(invertedMask, `debug_mask_inverted_${uuidv4()}.png`, userId, 'debug', 'image/png');
                    const canvasUrl = await fluxPlacementHandler.uploadToSupabaseStorage(tattooCanvas, `debug_tattoo_canvas_${uuidv4()}.png`, userId, 'debug', 'image/png');
                    console.log('DEBUG URLs:', { maskUrl, invUrl, canvasUrl });
                } catch (e) {
                    console.warn('DEBUG upload failed:', e.message);
                }
            }

            // 3) Optional micro-sharpen to keep edges from getting mushy after rotations/resizes
            tattooMaskedSharp = await sharp(needInvert ? tattooMaskedFixed : tattooMasked)
                .sharpen(0.5)
                .png()
                .toBuffer();

            // 4) Over-composite onto the skin with premultiplied alpha to create the preview input for FLUX
            compositedImageBuffer = await sharp(skinImageBuffer)
                .composite([{ input: tattooMaskedSharp, blend: 'over', premultiplied: true }])
                .png()
                .toBuffer();

            console.log('Tattoo deterministically composited onto skin (pre-FLUX). Output format: PNG.');

            // --- DEBUGGING STEP: UPLOAD AND LOG INTERMEDIATE IMAGE ---
            try {
                const debugFileName = `debug_sharp_composite_${uuidv4()}.png`;
                const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                    compositedImageBuffer,
                    debugFileName,
                    userId,
                    'debug',
                    'image/png' // Content type for debug output
                );
                console.log(`--- DEBUG: SHARP COMPOSITED IMAGE URL: ${debugPublicUrl} ---`);
            } catch (debugUploadError) {
                console.error('DEBUG ERROR: Failed to upload intermediate Sharp composite image:', debugUploadError);
            }
            // --- END DEBUGGING STEP ---

        } catch (error) {
            console.error('Error during deterministic image composition with positioning:', error);
            throw new Error(`Failed to composite tattoo onto skin with correct positioning: ${error.message}`);
        }

        // 4. Prepare for multiple Flux API calls
        const generatedImageUrls = [];

        // Tightened prompt to preserve silhouette; add negative prompt; lower guidance; disable upsampling
        const basePrompt =
            "Preserve the exact silhouette, linework, proportions and interior details of the tattoo. Only relight and blend the existing tattoo into the skin. Add realistic lighting, micro-shadowing, slight ink diffusion, and subtle skin texture. Do not redraw or restyle.";
        const negativePrompt =
            "re-sketch, new lines, restyle, warp, change shape, extra elements, animals, octopus, figurative art, glow, blur, smoothing edges, color shift";

        console.log(`Making ${numVariations} calls to Flux API...`);

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i; // Vary seed for different results

            const fluxPayload = {
                prompt: basePrompt,
                negative_prompt: negativePrompt,
                input_image: compositedImageBuffer.toString('base64'),
                // ensure mask matches input_image size (skin size)
                mask_image: maskPngSameAsSkin.toString('base64'),
                n: 3,                                // <-- restore 3 options per call
                output_format: 'png',
                fidelity: 0.8,
                guidance_scale: 2.2,                 // lower to reduce creative drift
                prompt_upsampling: false,            // prevent model from amplifying/rewriting
                safety_tolerance: 2,
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
                console.log(`DEBUG: Initial Flux POST response status for variation ${i + 1}: ${fluxResponse.status}`);
                console.log(`DEBUG: Initial Flux POST response data for variation ${i + 1}:`, JSON.stringify(fluxResponse.data, null, 2));

            } catch (error) {
                const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
                console.error(`Flux API call for variation ${i + 1} failed:`, errorDetail);
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
                    const r = result.data.result || {};
                    const candidateUrls = [];

                    // Collect whatever the API returns (sample, samples[], images[], output[], etc.)
                    if (typeof r.sample === 'string') candidateUrls.push(r.sample);
                    if (Array.isArray(r.samples)) candidateUrls.push(...r.samples.filter(s => typeof s === 'string'));
                    if (Array.isArray(r.images)) candidateUrls.push(...r.images.filter(s => typeof s === 'string'));
                    if (Array.isArray(r.output)) candidateUrls.push(...r.output.filter(s => typeof s === 'string'));

                    // Fallback: if nothing recognized, log and skip
                    if (candidateUrls.length === 0) {
                        console.warn(`Flux API Ready but no image URLs found for Task ${taskId}.`, r);
                        currentImageReady = true;
                        continue;
                    }

                    // Process each returned image
                    for (const imageUrlFromFlux of candidateUrls) {
                        let imageBuffer;
                        try {
                            const imageResponse = await axios.get(imageUrlFromFlux, { responseType: 'arraybuffer' });
                            imageBuffer = Buffer.from(imageResponse.data);
                            console.log(`Downloaded image from Flux URL for Task ${taskId}: ${imageUrlFromFlux.substring(0, 80)}...`);
                        } catch (downloadError) {
                            console.error(`Error downloading image from Flux URL for Task ${taskId}:`, imageUrlFromFlux, downloadError.message);
                            continue; // attempt next url
                        }

                        // ---------- POST-FLUX SILHOUETTE CLAMP ----------
                        // Keep only pixels within the original tattoo silhouette (pre-FLUX), so geometry cannot drift.
                        const fluxClampedToShape = await sharp(imageBuffer)
                            .composite([{ input: tattooMaskedSharp, blend: 'dest-in' }]) // tattooMaskedSharp carries the exact alpha silhouette
                            .png()
                            .toBuffer();

                        // Optionally boost line crispness by lightly overlaying the original masked tattoo
                        const relitPreservingShape = await sharp(skinImageBuffer)
                            .composite([
                                { input: fluxClampedToShape, blend: 'over', premultiplied: true },
                                { input: tattooMaskedSharp, blend: 'overlay', opacity: 0.35 } // keeps fine edges
                            ])
                            .png()
                            .toBuffer();
                        // -----------------------------------------------

                        // Watermark final composite (PNG)
                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(relitPreservingShape);
                        const fileName = `tattoo-${uuidv4()}.png`; // PNG
                        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId, '', 'image/png');
                        generatedImageUrls.push(publicUrl);
                    }

                    currentImageReady = true;
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
