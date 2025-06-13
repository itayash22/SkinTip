// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-12_V1.16_MASK_RAW_GRAYSCALE_FOR_SHARP_COMPOSITE'); // UPDATED VERSION LOG

const axios = require('axios');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

const fluxPlacementHandler = {

    /**
     * Inverts the colors of a Base64 encoded PNG mask image.
     * (This function will still exist but its return value for mask_image might not be used directly in Flux payload,
     * it will be used for Sharp composition where original mask is needed).
     */
    invertMask: async (maskBase64) => {
        const buffer = Buffer.from(maskBase64, 'base64');
        try {
            console.log('Mask Invert DEBUG: Attempting inversion...');
            const invertedBuffer = await sharp(buffer)
                .ensureAlpha() // Ensure it has an alpha channel for consistent negation
                .negate({ alpha: false }) // Invert colors, but don't touch alpha channel
                .png() // Convert to PNG
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
     * @param {Buffer} imageBuffer The buffer of the image to watermark.
     * @returns {Promise<Buffer>} A promise that resolves with the watermarked image buffer.
     */
    applyWatermark: async (imageBuffer) => {
        try {
            console.log('Watermark DEBUG: imageBuffer length (bytes):', imageBuffer.length);
            console.log('Watermark DEBUG: imageBuffer first 20 bytes (hex):', imageBuffer.toString('hex', 0, 20));
            console.log('Watermark DEBUG: imageBuffer first 20 bytes (base64):', imageBuffer.toString('base64', 0, 20));

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
                .jpeg({ quality: 90 }) // Ensure output is JPEG for consistent quality/size
                .toBuffer();

            return watermarkedBuffer;
        } catch (error) {
            console.error('Error applying watermark (caught):', error);
            return imageBuffer;
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     * @param {Buffer} imageBuffer The image buffer to upload.
     * @param {string} fileName The desired filename (e.g., 'tattoo_uuid.jpeg').
     * @param {string} userId The ID of the user for path organization.
     * @param {string} folder Optional subfolder within the user's directory (e.g., 'debug').
     * @returns {Promise<string>} The public URL of the uploaded image.
     * @throws {Error} If Supabase upload fails.
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
     * @param {Buffer} skinImageBuffer The buffer of the user's skin photo.
     * @param {string} tattooDesignImageBase64 The base64 string of the tattoo design image.
     * @param {string} maskBase64 The base64 string of the drawing mask (white area is tattoo).
     * @param {string} userPrompt An optional text prompt for guiding the placement.
     * @param {string} userId The ID of the user for path organization.
     * @param {number} numVariations The number of variations to request (e.g., 3).
     * @param {string} fluxApiKey The Flux API key.
     * @returns {Promise<string[]>} An array of public URLs to the watermarked, generated images.
     * @throws {Error} If API call, image processing, or upload fails.
     */
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userPrompt, userId, numVariations, fluxApiKey) => {
        console.log('Starting Flux tattoo placement process...');

        // 1. Convert tattoo design Base64 to Buffer. Ensure PNG for potential transparency.
        let tattooDesignBuffer;
        try {
            tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
            // Keep tattoo design image as PNG for better transparency handling in composite operation
            // Even if original is JPG, this tries to give it an alpha channel or solid background for mask application
            tattooDesignBuffer = await sharp(tattooDesignBuffer).png().toBuffer(); // Force PNG for transparency support
            console.log('Tattoo design image converted to PNG buffer for composition.'); // Updated log
        } catch (error) {
            console.error('Error processing tattoo design image base64:', error);
            throw new Error('Invalid tattoo design image data provided.');
        }

        // 2. Prepare Mask Buffer. Frontend mask is white for tattoo area, black elsewhere.
        // This will be used as the alpha channel for the tattoo design.
        const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
        let maskBuffer;
        try {
            const maskMetadata = await sharp(originalMaskBuffer).metadata();
            // Convert to grayscale and then to raw, single-channel buffer for explicit mask use in sharp.composite
            maskBuffer = await sharp(originalMaskBuffer)
                .grayscale() // Ensure it's grayscale (1 channel)
                .raw()       // Get raw pixel data
                .toBuffer();
            console.log(`Mask buffer converted to raw grayscale for composition. Dims: ${maskMetadata.width}x${maskMetadata.height}, channels: 1.`);
            // Debugging: Log mask properties
            console.log('DEBUG: maskBuffer length (bytes):', maskBuffer.length);
            console.log('DEBUG: maskBuffer first 20 bytes (hex):', maskBuffer.toString('hex', 0, 20));
        } catch (error) {
            console.error('Error processing mask for Sharp composition:', error);
            throw new Error(`Failed to prepare mask for composition: ${error.message}`);
        }

        // Get dimensions of the base skin image to correctly size the mask for composition
        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;
        console.log(`DEBUG: Skin Image Dims for Sharp: ${skinWidth}x${skinHeight}`);


        // Ensure tattoo design is sized to match skin image dimensions for direct composition
        // AND match the mask dimensions. The mask comes from the frontend drawing on the skin image.
        // So, tattooDesignBuffer should be resized to the *skin image dimensions*.
        let resizedTattooDesignBuffer;
        try {
            resizedTattooDesignBuffer = await sharp(tattooDesignBuffer)
                .resize(skinWidth, skinHeight, { // Use skin image dimensions for resize
                    fit: 'contain', // maintain aspect ratio, fit within bounds
                    background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background if tattoo smaller
                })
                .png() // Keep as PNG after resize
                .toBuffer();
            console.log(`Tattoo design resized to ${skinWidth}x${skinHeight} for composition.`);
            // Debugging: Log resized tattoo properties
            console.log('DEBUG: resizedTattooDesignBuffer length (bytes):', resizedTattooDesignBuffer.length);
        } catch (error) {
            console.error('Error resizing tattoo design for composition:', error);
            throw new Error('Failed to resize tattoo design for composition.');
        }

        // 3. **Manual Composition with Sharp (Hybrid Approach Step 1)**
        let compositedImageBuffer;
        try {
            compositedImageBuffer = await sharp(skinImageBuffer)
                .composite([
                    {
                        input: resizedTattooDesignBuffer,
                        blend: 'over', // Standard blend mode for overlaying
                        tile: false, // Ensure it's not tiling
                        left: 0, // Assume full image overlay for now
                        top: 0,  // Assume full image overlay for now
                        // The 'raw' parameter for input is NOT needed here if resizedTattooDesignBuffer is PNG
                        // The mask should also be converted to raw if it's explicitly used as a mask
                        mask: maskBuffer // Apply the (now raw grayscale) mask as an alpha mask to the tattoo
                    }
                ])
                .jpeg({ quality: 90 }) // Output as JPEG
                .toBuffer();
            console.log('Tattoo manually composited onto skin image.');

            // --- DEBUGGING STEP: UPLOAD AND LOG INTERMEDIATE IMAGE ---
            try {
                const debugFileName = `debug_sharp_composite_${uuidv4()}.jpeg`;
                const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                    compositedImageBuffer,
                    debugFileName,
                    userId,
                    'debug' // Optional subfolder for debug images
                );
                console.log(`--- DEBUG: SHARP COMPOSITED IMAGE URL: ${debugPublicUrl} ---`);
                console.log('^ Please check this URL in your browser to verify Sharp\'s output.');
            } catch (debugUploadError) {
                console.error('DEBUG ERROR: Failed to upload intermediate Sharp composite image:', debugUploadError);
            }
            // --- END DEBUGGING STEP ---

        } catch (error) {
            console.error('Error during manual image composition (Phase 1):', error);
            throw new Error(`Failed to composite tattoo onto skin: ${error.message}`);
        }


        // 4. Construct the prompt for Flux Kontext (Now focused on blending/realism)
        const effectivePrompt = `Make the tattoo look naturally placed on the skin, blend seamlessly, adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`; // REFINED PROMPT
        console.log('Effective AI Refinement Prompt:', effectivePrompt);

        // 5. Make the Flux Kontext API call with the pre-composited image (Hybrid Approach Step 2)
        const fluxPayload = {
            prompt: effectivePrompt,
            input_image: compositedImageBuffer.toString('base64'), // Send the manually composited image
            // IMPORTANT: DO NOT send mask_image or reference_images here anymore
            // The tattoo is already composited onto the input_image.
            mask_image: '', // No mask for full image blending/refinement by Flux (send empty string if required, or omit)
            // reference_images is deliberately not sent here
            n: numVariations, // Request 3 variations
            output_format: 'jpeg',
            fidelity: 0.8, // Adjusted fidelity for blending, not strict content transfer
            guidance_scale: 7.0, // Adjusted for blending, not strict adherence to initial prompt content
            // num_inference_steps: 50
        };

        const fluxHeaders = {
            'Content-Type': 'application/json',
            'x-key': fluxApiKey
        };

        console.log('Calling Flux Kontext API for blending with payload (truncated images):');
        const debugPayload = { ...fluxPayload };
        debugPayload.input_image = debugPayload.input_image ? debugPayload.input_image.substring(0, 50) + '...' : 'N/A';
        if (debugPayload.mask_image === '') debugPayload.mask_image = 'Empty String'; // For log clarity
        if (debugPayload.reference_images) delete debugPayload.reference_images;
        console.log(JSON.stringify(debugPayload, null, 2));

        let fluxResponse;
        try {
            fluxResponse = await axios.post(
                'https://api.bfl.ai/v1/flux-kontext-pro',
                fluxPayload,
                {
                    headers: fluxHeaders,
                    timeout: 90000 // Increased timeout for potentially longer generation
                }
            );
        } catch (error) {
            console.error('Flux API call failed:', error.response?.data || error.message);
            throw new Error(`Flux API generation error: ${error.response?.data?.detail || error.message}`);
        }

        const taskId = fluxResponse.data.id;
        if (!taskId) {
            console.error('Flux API did not return a task ID:', fluxResponse.data);
            throw new Error('Flux API did not start refinement task.');
        }

        // 6. Poll for results
        let attempts = 0;
        const generatedImageUrls = [];
        while (attempts < 60 && generatedImageUrls.length < numVariations) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));

            const result = await axios.get(
                `https://api.bfl.ai/v1/get_result?id=${taskId}`,
                {
                    headers: { 'x-key': fluxApiKey },
                    timeout: 10000
                }
            );

            console.log('Flux Polling Result Data (FULL RESPONSE):', JSON.stringify(result.data, null, 2));

            if (result.data.status === 'Ready') {
                const imageUrlFromFlux = result.data.result && result.data.result.sample;

                if (imageUrlFromFlux) {
                    let imageBuffer;
                    try {
                        const imageResponse = await axios.get(imageUrlFromFlux, { responseType: 'arraybuffer' });
                        imageBuffer = Buffer.from(imageResponse.data);
                        console.log(`Successfully downloaded image from Flux URL: ${imageUrlFromFlux.substring(0, 50)}...`);
                    } catch (downloadError) {
                        console.error('Error downloading image from Flux URL:', imageUrlFromFlux, downloadError.message);
                        throw new Error(`Failed to download image from Flux URL: ${downloadError.message}`);
                    }

                    const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
                    const fileName = `tattoo-${uuidv4()}.jpeg`;
                    const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
                    generatedImageUrls.push(publicUrl);
                    console.log(`Successfully generated and watermarked 1 image.`);
                    break;
                } else {
                    console.warn('Flux API returned Ready status but no valid image URL found in "sample".', result.data);
                    throw new Error('Flux API returned no images or malformed output.');
                }
            }

            if (result.data.status === 'Error') {
                console.error('Flux API Polling Error:', result.data);
                throw new Error('Image refinement failed during polling: ' + JSON.stringify(result.data));
            }

            console.log(`Polling attempt ${attempts}: ${result.data.status} for refinement.`);
        }

        if (generatedImageUrls.length === 0) {
            throw new Error('Refinement timeout: No images were generated within the time limit.');
        }

        return generatedImageUrls;
    }
};

module.exports = fluxPlacementHandler;
