// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-16_V1.40_CONDITIONAL_FLUX_METHODS_FINAL'); // UPDATED VERSION LOG

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

// CONSTANT: Padding around the mask bounding box for the area sent to Flux (in pixels)
const CROP_PADDING = 20; // Used for the 'new method' (cropped image to Flux)

// CONSTANT: Feathering radius for the reassembly mask (in pixels)
const REASSEMBLY_FEATHER_RADIUS = 18; // Used for the 'new method' (cropped image to Flux)

// HELPER FUNCTION: To find the bounding box of the white area in a raw grayscale mask buffer
async function getMaskBoundingBox(maskBuffer, width, height) {
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let foundWhite = false;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixelValue = maskBuffer[y * width + x];
            if (pixelValue > 0) {
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

    const padding = 0;
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
            console.log('Mask Invert DEBUG: Attempting inversion...');
            const invertedBuffer = await sharp(buffer)
                .ensureAlpha()
                .negate({ alpha: false })
                .png()
                .toBuffer();
            console.log('Mask successfully inverted.');
            const outputMaskMetadata = await sharp(invertedBuffer).metadata();
            console.log('Mask Invert DEBUG: Output inverted mask format:', outputMaskMetadata.format, 'channels:', outputMaskMetadata.channels);
            console.log('Mask Invert DEBUG: Output inverted mask first 20 bytes (hex):', invertedBuffer.toString('hex', 0, 20));
            return invertedBuffer.toString('base64');
        } catch (error) {
            console.error('Error inverting mask:', error);
            throw new Error('Failed to invert mask image for Flux API. Make sure mask is a valid PNG.');
        }
    },

    /**
     * Applies a watermark to an image buffer and returns the watermarked image as a buffer.
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

            const watermarkedBuffer = await sharp(imageBuffer)
                .composite([{
                    input: svgBuffer,
                    top: top,
                    left: left,
                    blend: 'over'
                }])
                .jpeg({ quality: 90 })
                .toBuffer();

            return watermarkedBuffer;
        } catch (error) {
            console.error('Error applying watermark (caught):', error);
            return imageBuffer;
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     */
    uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '') => {
        const filePath = `${userId}/${folder ? folder + '/' : ''}${fileName}`;
        const { data, error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType: 'image/jpeg',
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
     * Common Flux API polling logic. This function is called by both _executePreviousMethod and _executeNewMethod.
     */
    _pollFluxResult: async (taskId, fluxApiKey, userId, numExpectedImages, isCroppedMethod, basePrompt, skinImageBuffer, cropArea) => {
        let attempts = 0;
        const generatedImageUrls = []; // Collects URLs for this specific method call

        while (attempts < 60 && generatedImageUrls.length < numExpectedImages) { // Poll until we get expected number of images
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));

            const result = await axios.get(
                `https://api.bfl.ai/v1/get_result?id=${taskId}`,
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
                // Throw specific error to be caught by main function for method switching or overall error handling
                throw new Error(`Flux API: Content Moderated - The image or request triggered a moderation filter. Reason: ${moderationReason}.`);
            }

            if (result.data.status === 'Error') {
                console.error(`Flux API Polling Error for Task ${taskId}:`, result.data);
                throw new Error('Image refinement failed during polling: ' + JSON.stringify(result.data));
            }

            if (result.data.status === 'Ready') {
                const imageUrlFromFlux = result.data.result && result.data.result.sample;

                if (imageUrlFromFlux) {
                    let imageBuffer;
                    try {
                        const imageResponse = await axios.get(imageUrlFromFlux, { responseType: 'arraybuffer' });
                        imageBuffer = Buffer.from(imageResponse.data);
                        console.log(`Successfully downloaded image from Flux URL for Task ${taskId}: ${imageUrlFromFlux.substring(0, 50)}...`);
                    } catch (downloadError) {
                        console.error(`Error downloading image from Flux URL for Task ${taskId}:`, imageUrlFromFlux, downloadError.message);
                        throw new Error(`Failed to download image from Flux URL: ${downloadError.message}`);
                    }

                    let finalResultBuffer = imageBuffer; // Default if no reassembly is needed or fails

                    if (isCroppedMethod) {
                        // Reassembly for 'new method' (cropped image was sent to Flux)
                        try {
                            const fluxImageMetadata = await sharp(imageBuffer).metadata();
                            let fluxProcessedResizedForReassembly = imageBuffer;
                            if (fluxImageMetadata.width !== cropArea.width || fluxImageMetadata.height !== cropArea.height) {
                                console.warn(`Flux image dimensions (${fluxImageMetadata.width}x${fluxImageMetadata.height}) do not exactly match cropArea (${cropArea.width}x${cropArea.height}). Resizing for reassembly.`);
                                fluxProcessedResizedForReassembly = await sharp(imageBuffer)
                                    .resize(cropArea.width, cropArea.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
                                    .toBuffer();
                            } else {
                                console.log(`Flux image dimensions match cropArea: ${cropArea.width}x${cropArea.height}. No resize needed for reassembly.`);
                            }

                            // Generate feathered alpha mask
                            const featherMaskBuffer = await sharp({
                                create: { width: cropArea.width, height: cropArea.height, channels: 3, background: { r: 255, g: 255, b: 255 } }
                            })
                            .blur(REASSEMBLY_FEATHER_RADIUS)
                            .grayscale()
                            .raw()
                            .toBuffer();
                            console.log(`Generated feathered mask of ${cropArea.width}x${cropArea.height} with radius ${REASSEMBLY_FEATHER_RADIUS}.`);

                            // Apply feathered mask to Flux-processed image
                            const featheredFluxImage = await sharp(fluxProcessedResizedForReassembly)
                                .ensureAlpha()
                                .joinChannel(featherMaskBuffer, { raw: { width: cropArea.width, height: cropArea.height, channels: 1 } })
                                .toBuffer();
                            console.log('Applied feathered mask to Flux image.');

                            // Composite feathered Flux image onto original full skin image
                            finalResultBuffer = await sharp(skinImageBuffer)
                                .composite([{ input: featheredFluxImage, left: cropArea.left, top: cropArea.top, blend: 'over' }])
                                .jpeg({ quality: 90 })
                                .toBuffer();
                            console.log(`Flux-generated image reassembled onto full skin image (New Method).`);
                        } catch (reassemblyError) {
                            console.error(`ERROR: Failed to reassemble Flux image onto full skin (New Method): ${reassemblyError.message}. Using cropped Flux image for watermark/upload.`);
                            finalResultBuffer = imageBuffer; // Fallback to just the cropped image
                        }
                    } else {
                        // For 'previous method', imageBuffer is already the full image.
                        finalResultBuffer = imageBuffer;
                    }

                    const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(finalResultBuffer);
                    const fileName = `tattoo-${uuidv4()}.jpeg`;
                    const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
                    generatedImageUrls.push(publicUrl);
                    console.log(`Successfully generated and watermarked 1 image for variation.`);
                    // If Flux returns multiple samples in one 'Ready' state, this loop needs to handle it.
                    // For now, assuming one sample per 'Ready' state, so continue polling for more if needed.
                } else {
                    console.warn(`Flux API for Task ${taskId} returned Ready status but no valid image URL found in "sample".`, result.data);
                    throw new Error('Flux API returned no images or malformed output.');
                }
            }
            console.log(`Polling attempt ${attempts}: ${result.data.status} for Task ${taskId}.`);
        } // End while loop

        if (generatedImageUrls.length === 0) {
            throw new Error('Refinement timeout: No images were generated within the time limit.');
        }

        return generatedImageUrls;
    },

    /**
     * Executes the 'previous method': Composites tattoo onto full skin image, sends full image to Flux.
     */
    _executePreviousMethod: async (skinImageBuffer, tattooDesignWithAlphaBuffer, maskBoundingBox, maskBuffer, userPrompt, userId, numVariations, fluxApiKey, maskMetadata) => {
        console.log('DEBUG: Executing Previous Flux Method (Full Image Composite)...');
        let compositedImageBuffer;
        try {
            const tattooRelativeLeft = maskBoundingBox.minX; // Directly use absolute mask pos
            const tattooRelativeTop = maskBoundingBox.minY;

            const tattooForPlacement = await sharp(tattooDesignWithAlphaBuffer)
                .resize(maskBoundingBox.width, maskBoundingBox.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toBuffer();
            console.log(`Tattoo design resized for previous method: ${maskBoundingBox.width}x${maskBoundingBox.height}.`);

            compositedImageBuffer = await sharp(skinImageBuffer)
                .composite([
                    {
                        input: tattooForPlacement,
                        blend: 'over',
                        tile: false,
                        left: tattooRelativeLeft,
                        top: tattooRelativeTop,
                        mask: maskBuffer // Apply original full-size mask
                    }
                ])
                .jpeg({ quality: 90 })
                .toBuffer();
            console.log('Tattoo manually composited onto full skin image for previous method.');

            // DEBUGGING: Upload and log intermediate image
            try {
                const debugFileName = `debug_sharp_full_composite_${uuidv4()}.jpeg`;
                const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                    compositedImageBuffer, debugFileName, userId, 'debug');
                console.log(`--- DEBUG: SHARP FULL COMPOSITED IMAGE URL (SENT TO FLUX - Previous Method): ${debugPublicUrl} ---`);
            } catch (debugUploadError) { console.error('DEBUG ERROR: Failed to upload intermediate full composite image:', debugUploadError); }

        } catch (error) {
            console.error('Error during previous method Sharp composition:', error);
            throw new Error(`Failed to composite tattoo onto full skin for previous method: ${error.message}`);
        }

        const generatedImageUrls = [];
        const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
        // PROMPT FOR PREVIOUS METHOD
        const basePrompt = `Make the tattoo look naturally placed on the skin, blend seamlessly, adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`;
        
        // PARAMETERS FOR PREVIOUS METHOD
        const FLUX_FIDELITY_PREVIOUS = 0.5;
        const FLUX_GUIDANCE_SCALE_PREVIOUS = 8.0;

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i;
            const fluxPayload = {
                prompt: basePrompt,
                input_image: compositedImageBuffer.toString('base64'),
                mask_image: '',
                n: 1, // Request 1 variation per call
                output_format: 'jpeg',
                fidelity: FLUX_FIDELITY_PREVIOUS,
                guidance_scale: FLUX_GUIDANCE_SCALE_PREVIOUS,
                seed: currentSeed
            };

            let fluxResponse;
            try {
                fluxResponse = await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', fluxPayload, { headers: fluxHeaders, timeout: 90000 });
            } catch (error) {
                console.error(`Flux API call for variation ${i + 1} (Previous Method) failed:`, error.response?.data || error.message);
                throw new Error(`Flux API generation error (Previous Method): ${error.response?.data?.detail || error.message}`); // Throw immediately to trigger fallback
            }

            const taskId = fluxResponse.data.id;
            if (!taskId) { throw new Error('Flux API did not return a task ID for previous method.'); }

            try {
                const urls = await fluxPlacementHandler._pollFluxResult(taskId, fluxApiKey, userId, 1, false, basePrompt, skinImageBuffer, null); // Pass isCroppedMethod=false
                generatedImageUrls.push(...urls);
            } catch (pollError) {
                // If polling results in moderation, we catch it here to potentially trigger fallback.
                if (pollError.message.includes('Content Moderated')) {
                    throw pollError; // Re-throw to be caught by the main placeTattooOnSkin for method switch
                }
                console.warn(`Polling failed for variation ${i + 1} (Previous Method): ${pollError.message}`);
            }
        }
        if (generatedImageUrls.length === 0) { throw new Error('Flux API: No images generated by Previous Method.'); }
        return generatedImageUrls;
    },

    /**
     * Executes the 'new method': Composites tattoo onto cropped skin, sends cropped image to Flux, reassembles.
     */
    _executeNewMethod: async (skinImageBuffer, tattooDesignWithAlphaBuffer, maskBoundingBox, maskBuffer, userPrompt, userId, numVariations, fluxApiKey, maskMetadata) => {
        console.log('DEBUG: Executing New Flux Method (Cropped Image Composite)...');

        // Define the cropped area to send to Flux
        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;

        const cropArea = {
            left: Math.max(0, maskBoundingBox.minX - CROP_PADDING),
            top: Math.max(0, maskBoundingBox.minY - CROP_PADDING),
            width: Math.min(skinWidth - Math.max(0, maskBoundingBox.minX - CROP_PADDING), maskBoundingBox.width + 2 * CROP_PADDING),
            height: Math.min(skinHeight - Math.max(0, maskBoundingBox.minY - CROP_PADDING), maskBoundingBox.height + 2 * CROP_PADDING),
        };
        cropArea.width = Math.min(skinWidth - cropArea.left, cropArea.width);
        cropArea.height = Math.min(skinHeight - cropArea.top, cropArea.height);
        cropArea.width = Math.max(1, cropArea.width); // Ensure minimum dimensions
        cropArea.height = Math.max(1, cropArea.height);
        console.log('DEBUG: Cropping area for Flux API (New Method):', cropArea);

        // Crop images for local composite
        let croppedSkinBuffer;
        try { croppedSkinBuffer = await sharp(skinImageBuffer).extract(cropArea).toBuffer(); }
        catch (skinCropError) { throw new Error(`Failed to crop skin image (New Method): ${skinCropError.message}`); }

        let croppedMaskBuffer;
        try { croppedMaskBuffer = await sharp(maskBuffer, { raw: { width: maskMetadata.width, height: maskMetadata.height, channels: 1 }}).extract(cropArea).toBuffer(); }
        catch (maskCropError) { throw new Error(`Failed to crop mask image (New Method): ${maskCropError.message}`); }
       
        const tattooRelativeLeft = maskBoundingBox.minX - cropArea.left;
        const tattooRelativeTop = maskBoundingBox.minY - cropArea.top;

        let tattooForPlacement;
        try { tattooForPlacement = await sharp(tattooDesignWithAlphaBuffer).resize(maskBoundingBox.width, maskBoundingBox.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(); }
        catch (error) { throw new Error('Failed to resize tattoo design (New Method).'); }

        let compositedCroppedImageBuffer;
        try { compositedCroppedImageBuffer = await sharp(croppedSkinBuffer).composite([{ input: tattooForPlacement, blend: 'over', tile: false, left: tattooRelativeLeft, top: tattooRelativeTop, mask: croppedMaskBuffer }]).jpeg({ quality: 90 }).toBuffer(); }
        catch (error) { throw new Error(`Failed to composite tattoo onto cropped skin (New Method): ${error.message}`); }

        // DEBUGGING: Upload and log intermediate cropped image
        try {
            const debugFileName = `debug_sharp_cropped_composite_${uuidv4()}.jpeg`;
            const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                compositedCroppedImageBuffer, debugFileName, userId, 'debug');
            console.log(`--- DEBUG: SHARP CROPPED COMPOSITED IMAGE URL (SENT TO FLUX - New Method): ${debugPublicUrl} ---`);
        } catch (debugUploadError) { console.error('DEBUG ERROR: Failed to upload intermediate cropped image (New Method):', debugUploadError); }

        const generatedImageUrls = [];
        const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
        // PROMPT FOR NEW METHOD
        const basePrompt = `Achieve an ultra-realistic skin integration where the tattoo appears to exist *beneath* the skin's surface. Blend seamlessly with the skin's natural texture, observing and subtly influencing the appearance of pores and fine lines across the tattooed area. Simulate the way the skin's undertones and blood flow would naturally interact with the tattoo's ink, creating a believable subsurface effect. The lighting and shadows must be indistinguishable from those on the surrounding untouched skin, enhancing the three-dimensionality and the sense that the tattoo is an intrinsic part of the body. Hyper-detailed photograph, expert-level realism in tattoo application and skin integration, organic and natural appearance, no suggestion of a superficial application. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`;
        
        // PARAMETERS FOR NEW METHOD
        const FLUX_FIDELITY_NEW = 0.38;
        const FLUX_GUIDANCE_SCALE_NEW = 10.5;

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i;
            const fluxPayload = {
                prompt: basePrompt,
                input_image: compositedCroppedImageBuffer.toString('base64'),
                mask_image: '',
                n: 1, // Request 1 variation per call
                output_format: 'jpeg',
                fidelity: FLUX_FIDELITY_NEW,
                guidance_scale: FLUX_GUIDANCE_SCALE_NEW,
                seed: currentSeed
            };

            let fluxResponse;
            try { fluxResponse = await axios.post('https://api.bfl.ai/v1/flux-kontext-pro', fluxPayload, { headers: fluxHeaders, timeout: 90000 }); }
            catch (error) { throw new Error(`Flux API call (New Method) for variation ${i + 1} failed: ${error.response?.data?.detail || error.message}`); }

            const taskId = fluxResponse.data.id;
            if (!taskId) { throw new Error('Flux API did not return a task ID (New Method).'); }

            try {
                const urls = await fluxPlacementHandler._pollFluxResult(taskId, fluxApiKey, userId, 1, true, basePrompt, skinImageBuffer, cropArea); // Pass isCroppedMethod=true
                generatedImageUrls.push(...urls);
            } catch (pollError) {
                 if (pollError.message.includes('Content Moderated')) {
                    throw pollError; // Re-throw to be caught by the main placeTattooOnSkin for general error
                }
                console.warn(`Polling failed for variation ${i + 1} (New Method): ${pollError.message}`);
            }
        }
        if (generatedImageUrls.length === 0) { throw new Error('Flux API: No images generated by New Method.'); }
        return generatedImageUrls;
    },

    /**
     * Main function to place a tattoo on skin, with conditional method selection.
     */
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userPrompt, userId, numVariations, fluxApiKey) => {
        console.log('Starting Flux tattoo placement process...');

        // Image preprocessing steps common to both methods
        let tattooDesignBuffer;
        try {
            tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
            tattooDesignBuffer = await sharp(tattooDesignBuffer).png().toBuffer();
            console.log('Tattoo design image converted to PNG buffer.');
        } catch (error) { throw new Error('Invalid tattoo design image data provided.'); }

        const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
        let maskBuffer;
        let maskMetadata;
        try {
            maskMetadata = await sharp(originalMaskBuffer).metadata();
            maskBuffer = await sharp(originalMaskBuffer).grayscale().raw().toBuffer();
            console.log(`Mask buffer converted to raw grayscale. Dims: ${maskMetadata.width}x${maskMetadata.height}, channels: 1.`);
        } catch (error) { throw new Error(`Failed to prepare mask for composition: ${error.message}`); }

        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;
        console.log(`DEBUG: Skin Image Dims: ${skinWidth}x${skinHeight}`);

        const maskBoundingBox = await getMaskBoundingBox(maskBuffer, maskMetadata.width, maskMetadata.height);
        if (maskBoundingBox.isEmpty) { throw new Error('Drawn mask area is too small or empty. Please draw a visible area.'); }
        console.log('DEBUG: Calculated Mask Bounding Box:', maskBoundingBox);

        let tattooDesignWithAlphaBuffer = tattooDesignBuffer;
        try {
            const tattooMeta = await sharp(tattooDesignBuffer).metadata();
            if (tattooMeta.format === 'jpeg' || (tattooMeta.format === 'png' && tattooMeta.channels < 4)) {
                console.warn('INFO: Tattoo design image does not have an explicit alpha channel or is JPEG. Ensuring alpha but skipping complex background removal heuristic.');
                tattooDesignWithAlphaBuffer = await sharp(tattooDesignBuffer).ensureAlpha().toBuffer();
                console.log('Tattoo design image now has an alpha channel, if it did not before.');
            } else {
                console.log('Tattoo design image already has an alpha channel. No background removal heuristic applied.');
            }
        } catch (alphaProcessError) { console.error('ERROR: Failed to ensure alpha channel for tattoo design. Proceeding with original buffer.', alphaProcessError.message); tattooDesignWithAlphaBuffer = tattooDesignBuffer; }

        let generatedUrls = [];
        let methodUsed = '';

        try {
            // Attempt the 'Previous Method' first
            methodUsed = 'Previous';
            console.log(`ATTEMPTING: ${methodUsed} Flux Method.`);
            generatedUrls = await fluxPlacementHandler._executePreviousMethod(
                skinImageBuffer, tattooDesignWithAlphaBuffer, maskBoundingBox, maskBuffer, userPrompt, userId, numVariations, fluxApiKey, maskMetadata // Added maskMetadata here
            );
        } catch (error) {
            if (error.message.includes('Content Moderated')) {
                // If previous method failed due to moderation, try 'New Method'
                methodUsed = 'New (Fallback)';
                console.warn(`FALLBACK: Previous method failed due to content moderation. Attempting ${methodUsed} Flux Method.`);
                try {
                    generatedUrls = await fluxPlacementHandler._executeNewMethod(
                        skinImageBuffer, tattooDesignWithAlphaBuffer, maskBoundingBox, maskBuffer, userPrompt, userId, numVariations, fluxApiKey, maskMetadata
                    );
                } catch (fallbackError) {
                    console.error(`ERROR: Fallback method (${methodUsed}) also failed:`, fallbackError.message);
                    throw fallbackError; // Re-throw if fallback also fails
                }
            } else {
                // If previous method failed for any other reason, re-throw the error
                console.error(`ERROR: Previous method failed for reason other than moderation:`, error.message);
                throw error;
            }
        }

        if (generatedUrls.length === 0) {
            throw new Error(`Flux API: No images were generated across all attempts using the ${methodUsed} method. Please try again or with a different design.`);
        }

        console.log(`SUCCESS: Flux generation completed using the ${methodUsed} method.`);
        return generatedUrls;
    }
};

export default fluxPlacementHandler;
