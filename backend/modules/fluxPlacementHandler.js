// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-19_V1.57_PNG_END_TO_END_FIX'); // UPDATED VERSION LOG for full PNG pipeline

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
            // Ensure safe access to maskBuffer for readUInt8
            const pixelValue = (maskBuffer && maskBuffer.length > (y * width + x)) ? maskBuffer.readUInt8(y * width + x) : 0;
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
     * Output format for watermarking is now PNG.
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
                .png() // Changed to PNG output for watermarking
                .toBuffer();

            return watermarkedBuffer;
        } catch (error) {
            console.error('Error applying watermark (caught):', error);
            return imageBuffer;
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     * Now uploads as PNG.
     */
    uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '') => {
        const filePath = `${userId}/${folder ? folder + '/' : ''}${fileName}`;
        const { data, error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType: 'image/png', // Changed to PNG for Supabase storage
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
     * Main function to place a tattoo on skin using Flux's inpainting capabilities.
     * This version implements an end-to-end PNG pipeline for higher quality.
     */
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userPrompt, userId, numVariations, fluxApiKey) => {
        console.log('Starting Flux tattoo placement process (Direct Mask and Reference Image to Flux) - PNG END-TO-END...');

        // 1. Tattoo Design (Reference Image) - Ensure it's Base64 for Flux
        // Frontend sends it as PNG Base64
        const tattooDesignBase64ForFlux = tattooDesignImageBase64;

        // 2. Prepare Mask for Flux - Ensure it's Base64 PNG
        let processedMaskBase64;
        try {
            const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
            const pngMaskBuffer = await sharp(originalMaskBuffer)
                .greyscale() // Ensure black & white
                .png()
                .toBuffer();
            processedMaskBase64 = pngMaskBuffer.toString('base64');
            console.log('Mask prepared as Base64 PNG for Flux API mask_image.');
        } catch (error) {
            console.error('Error processing mask for Flux API:', error);
            throw new Error(`Failed to prepare mask for Flux API: ${error.message}`);
        }

        // 3. Prepare Skin Image for Flux - Convert to Base64 PNG
        const pngSkinBuffer = await sharp(skinImageBuffer).png().toBuffer(); // Ensure skin image is PNG
        const skinImageBase64ForFlux = pngSkinBuffer.toString('base64');
        console.log('Skin image prepared as Base64 PNG for Flux API input_image.');

        // Get dimensions of the base skin image (for validation)
        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;
        console.log(`DEBUG: Skin Image Dims: ${skinWidth}x${skinHeight}.`);

        // --- Step 2.1: Determine the bounding box of the drawn mask area (still for validation) ---
        const maskBufferRaw = await sharp(Buffer.from(maskBase64, 'base64')).grayscale().raw().toBuffer();
        const maskBoundingBox = await getMaskBoundingBox(maskBufferRaw, skinWidth, skinHeight);
        if (maskBoundingBox.isEmpty) {
            throw new Error('Drawn mask area is too small or empty. Please draw a visible area.');
        }
        console.log('DEBUG: Calculated Mask Bounding Box:', maskBoundingBox);

        // --- DEBUGGING STEP: UPLOAD AND LOG ORIGINAL SKIN (PNG) AND MASK ---
        try {
            const debugSkinFileName = `debug_original_skin_${uuidv4()}.png`; // Use .png extension
            const debugMaskFileName = `debug_mask_to_flux_${uuidv4()}.png`; // Use .png extension
            const debugOriginalSkinUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                pngSkinBuffer, debugSkinFileName, userId, 'debug');
            const debugMaskUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                Buffer.from(processedMaskBase64, 'base64'), debugMaskFileName, userId, 'debug');
            console.log(`--- DEBUG: ORIGINAL SKIN IMAGE URL (SENT TO FLUX AS PNG): ${debugOriginalSkinUrl} ---`);
            console.log(`--- DEBUG: MASK IMAGE URL (SENT TO FLUX AS PNG): ${debugMaskUrl} ---`);
            console.log('^ Please verify these inputs to Flux are correct.');
        } catch (debugUploadError) {
            console.error('DEBUG ERROR: Failed to upload intermediate skin/mask images:', debugUploadError);
        }
        // --- END DEBUGGING STEP ---


        // 4. Prepare for multiple Flux API calls
        const generatedImageUrls = [];
        const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };

        const basePrompt = `Place the uploaded tattoo design from the reference image precisely within the masked area on the skin. Integrate it naturally into the skin, with realistic ink dispersion and subtle texture. Blend seamlessly and adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail, not a sticker. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`;

        const FLUX_FIDELITY = 0.9; // Keeping a higher fidelity as requested to preserve original skin
        const FLUX_GUIDANCE_SCALE = 10.0;

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i;

            const fluxPayload = {
                prompt: basePrompt,
                input_image: skinImageBase64ForFlux, // ORIGINAL skin image (PNG)
                mask_image: processedMaskBase64,   // The mask (PNG)
                reference_image: tattooDesignBase64ForFlux, // The tattoo design (PNG)
                n: 1, // Request 1 variation per call
                output_format: 'png', // REQUEST PNG OUTPUT FROM FLUX
                fidelity: FLUX_FIDELITY,
                guidance_scale: FLUX_GUIDANCE_SCALE,
                seed: currentSeed
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
                throw new Error(`Flux API generation error: ${error.response?.data?.detail || error.message}`);
            }

            const taskId = fluxResponse.data.id;
            if (!taskId) { throw new Error('Flux API did not return a task ID.'); }

            // Polling logic remains the same

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
                    throw new Error("rendering failed due to filter issues. please upload pics without using nudity or underwear and try again");
                } else if (result.data.status === 'Error') {
                    console.error(`Flux API Polling Error for Task ${taskId}:`, result.data);
                    throw new Error('Image refinement failed during polling: ' + JSON.stringify(result.data));
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
                            throw new Error(`Failed to download image from Flux URL: ${downloadError.message}`);
                        }

                        const finalResultBuffer = imageBuffer; // Flux returns the full image (now PNG)

                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(finalResultBuffer); // Watermarking is now also PNG
                        const fileName = `tattoo-${uuidv4()}.png`; // Save as PNG
                        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
                        generatedImageUrls.push(publicUrl);
                        console.log(`Successfully generated and watermarked 1 image for variation ${i + 1} (PNG).`);
                        currentImageReady = true;
                        if (numVariations === 1) break;
                    } else {
                        console.warn(`Flux API for Task ${taskId} returned Ready status but no valid image URL found in "sample".`, result.data);
                        throw new Error('Flux API returned no images or malformed output.');
                    }
                } else {
                    console.log(`Polling attempt ${attempts}: ${result.data.status} for Task ${taskId}.`);
                }
            }
            if (!currentImageReady) {
                console.warn(`Refinement timeout for variation ${i + 1}: No image was generated within the time limit.`);
                throw new Error('Image generation timed out. Please try again.');
            }
        }

        if (generatedImageUrls.length === 0) {
            throw new Error('Flux API: No images were generated across all attempts. Please try again or with a different design.');
        }

        return generatedImageUrls;
    }
};

export default fluxPlacementHandler;
