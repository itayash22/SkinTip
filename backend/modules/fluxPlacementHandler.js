// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-15_V1.32_FINAL_REAMBLE_FEATHERING'); // UPDATED VERSION LOG

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
const CROP_PADDING = 20; // Reduced from 100px. Test with a very small padding.

// CONSTANT: Feathering radius for the reassembly mask (in pixels)
const FEATHER_RADIUS = 25; // Controls how soft the edges are during final reassembly

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
     * Calls the Flux Kontext API to place a tattoo design onto a skin image.
     * Handles all image preprocessing (resizing, mask inversion, watermarking, storage).
     * Now makes multiple Flux API calls to get multiple variations.
     */
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userPrompt, userId, numVariations, fluxApiKey) => {
        console.log('Starting Flux tattoo placement process...');

        // 1. Convert tattoo design Base64 to Buffer.
        let tattooDesignBuffer;
        try {
            tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
            tattooDesignBuffer = await sharp(tattooDesignBuffer).png().toBuffer(); // Ensure PNG for alpha support
            console.log('Tattoo design image converted to PNG buffer.');
        } catch (error) {
            console.error('Error processing tattoo design image base64:', error);
            throw new Error('Invalid tattoo design image data provided.');
        }

        // 2. Prepare Mask Buffer. Frontend mask is white for tattoo area, black elsewhere.
        const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
        let maskBuffer;
        let maskMetadata; // This metadata is crucial for raw buffer interpretation
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

        // Get dimensions of the base skin image
        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;
        console.log(`DEBUG: Full Skin Image Dims: ${skinWidth}x${skinHeight}`);

        // --- Step 2.1: Determine the bounding box of the drawn mask area ---
        const maskBoundingBox = await getMaskBoundingBox(maskBuffer, maskMetadata.width, maskMetadata.height);
        if (maskBoundingBox.isEmpty) {
            throw new Error('Drawn mask area is too small or empty. Please draw a visible area.');
        }
        console.log('DEBUG: Calculated Mask Bounding Box:', maskBoundingBox);

        // --- Define the cropped area to send to Flux ---
        // Expand the mask bounding box by CROP_PADDING for context
        const cropArea = {
            left: Math.max(0, maskBoundingBox.minX - CROP_PADDING),
            top: Math.max(0, maskBoundingBox.minY - CROP_PADDING),
            width: Math.min(skinWidth - Math.max(0, maskBoundingBox.minX - CROP_PADDING), maskBoundingBox.width + 2 * CROP_PADDING),
            height: Math.min(skinHeight - Math.max(0, maskBoundingBox.minY - CROP_PADDING), maskBoundingBox.height + 2 * CROP_PADDING),
        };

        // Recalculate width/height to be exact based on left/top and max dimensions
        cropArea.width = Math.min(skinWidth - cropArea.left, cropArea.width);
        cropArea.height = Math.min(skinHeight - cropArea.top, cropArea.height);

        // Ensure minimum dimensions for sharp.extract, e.g., 1x1 if calculated area is 0
        cropArea.width = Math.max(1, cropArea.width);
        cropArea.height = Math.max(1, cropArea.height);

        console.log('DEBUG: Cropping area for Flux API:', cropArea);

        // --- Step 2.2: Simplified background transparency handling (for the tattoo) ---
        let tattooDesignWithAlphaBuffer = tattooDesignBuffer; // Start with the initial tattoo buffer (already PNG)
        try {
            const tattooMeta = await sharp(tattooDesignBuffer).metadata();
            
            // If the image is a JPG (always opaque) or a PNG without an explicit alpha channel,
            // we simply ensure it has an alpha channel, but we don't try to key out a background color.
            if (tattooMeta.format === 'jpeg' || (tattooMeta.format === 'png' && tattooMeta.channels < 4)) {
                console.warn('INFO: Tattoo design image does not have an explicit alpha channel or is JPEG. Ensuring alpha but skipping complex background removal heuristic.');
                tattooDesignWithAlphaBuffer = await sharp(tattooDesignBuffer)
                    .ensureAlpha() 
                    .toBuffer();
                console.log('Tattoo design image now has an alpha channel, if it did not before.');

            } else {
                console.log('Tattoo design image already has an alpha channel. No background removal heuristic applied.');
            }
        } catch (alphaProcessError) {
            console.error('ERROR: Failed to ensure alpha channel for tattoo design. Proceeding with original buffer.', alphaProcessError.message);
            tattooDesignWithAlphaBuffer = tattooDesignBuffer; // Fallback if error occurs
        }

        // --- Step 2.3: Prepare images for local composite (all cropped to cropArea) ---
        // Crop the skin image to the defined cropArea
        let croppedSkinBuffer;
        try {
            croppedSkinBuffer = await sharp(skinImageBuffer)
                .extract({ left: cropArea.left, top: cropArea.top, width: cropArea.width, height: cropArea.height })
                .toBuffer();
            console.log(`Cropped skin image to ${cropArea.width}x${cropArea.height}.`);
        } catch (skinCropError) {
            console.error(`ERROR: Failed to crop skin image: ${skinCropError.message}. CropArea:`, cropArea, `SkinDims: ${skinWidth}x${skinHeight}`);
            throw new Error(`Failed to crop skin image for processing: ${skinCropError.message}`);
        }

        // Crop the mask to the defined cropArea
        let croppedMaskBuffer;
        try {
            croppedMaskBuffer = await sharp(maskBuffer, { 
                raw: { 
                    width: maskMetadata.width, 
                    height: maskMetadata.height, 
                    channels: 1 
                } 
            })
                .extract({ left: cropArea.left, top: cropArea.top, width: cropArea.width, height: cropArea.height })
                .toBuffer();
            console.log(`Cropped mask to ${cropArea.width}x${cropArea.height}.`);
        } catch (maskCropError) {
             console.error(`ERROR: Failed to crop mask image: ${maskCropError.message}. CropArea:`, cropArea, `MaskDims: ${maskMetadata.width}x${maskMetadata.height}`);
             throw new Error(`Failed to crop mask image for processing: ${maskCropError.message}`);
        }
       
        // Recalculate tattoo position relative to the cropped area's top-left
        const tattooRelativeLeft = maskBoundingBox.minX - cropArea.left;
        const tattooRelativeTop = maskBoundingBox.minY - cropArea.top;
        console.log(`Tattoo positioned relatively at (${tattooRelativeLeft}, ${tattooRelativeTop}) within cropped area.`);


        // Resize the tattoo design to fit the mask's bounding box and prepare for placement (within cropped area)
        let tattooForPlacement;
        try {
            tattooForPlacement = await sharp(tattooDesignWithAlphaBuffer)
                .resize(maskBoundingBox.width, maskBoundingBox.height, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toBuffer();
            console.log(`Tattoo design resized specifically for mask bounding box: ${maskBoundingBox.width}x${maskBoundingBox.height}.`);
        } catch (error) {
            console.error('Error resizing tattoo design for placement:', error);
            throw new Error('Failed to resize tattoo design for placement within mask area.');
        }

        // 3. **Manual Composition with Sharp (Hybrid Approach Step 1) - ONLY on the cropped area**
        let compositedCroppedImageBuffer;
        try {
            compositedCroppedImageBuffer = await sharp(croppedSkinBuffer)
                .composite([
                    {
                        input: tattooForPlacement,
                        blend: 'over',
                        tile: false,
                        left: tattooRelativeLeft,
                        top: tattooRelativeTop,
                        mask: croppedMaskBuffer
                    }
                ])
                .jpeg({ quality: 90 })
                .toBuffer();
            console.log('Tattoo manually composited onto cropped skin image.');

            // --- DEBUGGING STEP: UPLOAD AND LOG INTERMEDIATE CROPPED IMAGE ---
            try {
                const debugFileName = `debug_sharp_cropped_composite_${uuidv4()}.jpeg`;
                const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                    compositedCroppedImageBuffer,
                    debugFileName,
                    userId,
                    'debug'
                );
                console.log(`--- DEBUG: SHARP CROPPED COMPOSITED IMAGE URL (SENT TO FLUX): ${debugPublicUrl} ---`);
                console.log('^ Please check this URL to verify the exact image Flux receives.');
            } catch (debugUploadError) {
                console.error('DEBUG ERROR: Failed to upload intermediate cropped image:', debugUploadError);
            }
            // --- END DEBUGGING STEP ---

        } catch (error) {
            console.error('Error during manual cropped image composition:', error);
            throw new Error(`Failed to composite tattoo onto cropped skin: ${error.message}`);
        }

        // 4. Make multiple Flux API calls with the compositedCroppedImageBuffer
        const generatedImageUrls = [];
        const basePrompt = `Make the tattoo look naturally placed on the skin, blend seamlessly, adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`;

        console.log(`Making ${numVariations} calls to Flux API...`);

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i;

            const fluxPayload = {
                prompt: basePrompt,
                input_image: compositedCroppedImageBuffer.toString('base64'), // Send the cropped composite
                mask_image: '', // Flux processes the cropped image
                n: 1,
                output_format: 'jpeg',
                fidelity: 0.5,
                guidance_scale: 8.0,
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
            } catch (error) {
                console.error(`Flux API call for variation ${i + 1} failed:`, error.response?.data || error.message);
                console.warn(`Skipping variation ${i + 1} due to API call failure.`);
                continue;
            }

            const taskId = fluxResponse.data.id;
            if (!taskId) {
                console.error(`Flux API for variation ${i + 1} did not return a task ID:`, fluxResponse.data);
                console.warn(`Skipping variation ${i + 1} due to missing task ID.`);
                continue;
            }

            // Poll for results for THIS specific task ID
            let attempts = 0;
            let currentImageReady = false;
            while (attempts < 60 && !currentImageReady) {
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

                        // --- FINAL REASSEMBLY STEP: Paste Flux result back onto original full skin image ---
                        let finalResultBuffer;
                        try {
                            // First, get metadata of the image from Flux
                            const fluxImageMetadata = await sharp(imageBuffer).metadata();

                            // Ensure the imageBuffer from Flux is precisely the cropArea's size for reassembly
                            // We need to check if dimensions match before resizing, if not, resize.
                            let fluxProcessedResizedForReassembly = imageBuffer; // Start with the downloaded buffer
                            if (fluxImageMetadata.width !== cropArea.width || fluxImageMetadata.height !== cropArea.height) {
                                console.warn(`Flux image dimensions (${fluxImageMetadata.width}x${fluxImageMetadata.height}) do not exactly match cropArea (${cropArea.width}x${cropArea.height}). Resizing for reassembly.`);
                                fluxProcessedResizedForReassembly = await sharp(imageBuffer)
                                    .resize(cropArea.width, cropArea.height, {
                                        fit: 'fill', // Force to fill the exact dimensions
                                        kernel: sharp.kernel.lanczos3 // High quality resize
                                    })
                                    .toBuffer();
                            } else {
                                console.log(`Flux image dimensions match cropArea: ${cropArea.width}x${cropArea.height}. No resize needed for reassembly.`);
                            }

                            finalResultBuffer = await sharp(skinImageBuffer)
                                .composite([
                                    {
                                        input: fluxProcessedResizedForReassembly, // Use the (potentially resized) Flux output
                                        left: cropArea.left,
                                        top: cropArea.top,
                                        blend: 'over',
                                    }
                                ])
                                .jpeg({ quality: 90 })
                                .toBuffer();
                            console.log(`Flux-generated image reassembled onto full skin image.`);
                        } catch (reassemblyError) {
                            console.error(`ERROR: Failed to reassemble Flux image onto full skin: ${reassemblyError.message}. Using cropped Flux image for watermark/upload.`);
                            finalResultBuffer = imageBuffer; // Fallback to just the cropped image if reassembly fails
                        }
                        
                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(finalResultBuffer);
                        const fileName = `tattoo-${uuidv4()}.jpeg`;
                        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
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
