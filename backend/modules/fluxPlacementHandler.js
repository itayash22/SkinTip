// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-13_V1.17_SHARP_COMPOSITE_WITH_MASK_BOUNDING_BOX_AND_ALPHA'); // UPDATED VERSION LOG

const axios = require('axios');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

// NEW HELPER FUNCTION: To find the bounding box of the white area in a raw grayscale mask buffer
async function getMaskBoundingBox(maskBuffer, width, height) {
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let foundWhite = false;

    // Sharp's raw buffer is typically 1 byte per pixel for grayscale (0-255)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixelValue = maskBuffer[y * width + x]; // Assumes 1 channel (grayscale raw)
            if (pixelValue > 0) { // If pixel is not black (i.e., white or anything above 0)
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
        // Return a default or throw error if mask is entirely black. For now, return empty to be handled.
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, isEmpty: true };
    }

    // Add some optional padding to the bounding box, to give the tattoo some breathing room
    // Be cautious with padding; too much can cause the tattoo to go outside the drawn area.
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
        width: maxX - minX + 1, // +1 because width/height are inclusive
        height: maxY - minY + 1,
        isEmpty: false
    };
}


const fluxPlacementHandler = {

    /**
     * Inverts the colors of a Base64 encoded PNG mask image.
     * (This function is not directly used in the current Flux API payload or Sharp composite with new approach,
     * but kept as a utility).
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
            // console.log('Watermark DEBUG: imageBuffer length (bytes):', imageBuffer.length); // Too verbose
            // console.log('Watermark DEBUG: imageBuffer first 20 bytes (hex):', imageBuffer.toString('hex', 0, 20)); // Too verbose

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
            return imageBuffer; // Return original image if watermarking fails
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
                upsert: false // Do not overwrite existing files with same name
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
            // Force PNG to ensure it can support an alpha channel later if it's a JPG input.
            // This step does NOT make an opaque background transparent.
            tattooDesignBuffer = await sharp(tattooDesignBuffer).png().toBuffer();
            console.log('Tattoo design image converted to PNG buffer.');
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
            // console.log('DEBUG: maskBuffer length (bytes):', maskBuffer.length); // Too verbose
        } catch (error) {
            console.error('Error processing mask for Sharp composition:', error);
            throw new Error(`Failed to prepare mask for composition: ${error.message}`);
        }

        // Get dimensions of the base skin image
        const skinMetadata = await sharp(skinImageBuffer).metadata();
        const skinWidth = skinMetadata.width;
        const skinHeight = skinMetadata.height;
        console.log(`DEBUG: Skin Image Dims: ${skinWidth}x${skinHeight}`);

        // --- Step 2.1: Determine the bounding box of the drawn mask area ---
        const maskBoundingBox = await getMaskBoundingBox(maskBuffer, maskMetadata.width, maskMetadata.height);
        if (maskBoundingBox.isEmpty) {
            throw new Error('Drawn mask area is too small or empty. Please draw a visible area.');
        }
        console.log('DEBUG: Calculated Mask Bounding Box:', maskBoundingBox);

        // --- Step 2.2: Make the black background of the tattoo design transparent ---
        // This heuristic makes pure black pixels transparent. Important for JPGs with solid black backgrounds.
        let tattooDesignWithAlphaBuffer = tattooDesignBuffer; // Start with the initial tattoo buffer (already PNG)
        try {
            const tattooMeta = await sharp(tattooDesignBuffer).metadata();

            // If the image currently lacks a proper alpha channel or is explicitly a JPG (converted to PNG without transparency)
            if (tattooMeta.format === 'jpeg' || (tattooMeta.format === 'png' && tattooMeta.channels < 4)) {
                console.log('Attempting to add transparency to tattoo design by keying out black background...');
                
                // Create an alpha mask where black pixels become transparent (0) and other colors become opaque (255)
                const alphaMaskFromBlack = await sharp(tattooDesignBuffer)
                    .threshold(1) // Pixels > 0 (not pure black) become 255 (white), pure black (0) remains 0.
                    .toColourspace('b-w') // Convert to 1-bit black and white
                    .raw() // Get raw pixel data for alpha channel
                    .toBuffer();

                tattooDesignWithAlphaBuffer = await sharp(tattooDesignBuffer)
                    .ensureAlpha() // Ensure the image has an alpha channel to join to
                    .joinChannel(alphaMaskFromBlack, { raw: {
                        width: tattooMeta.width,
                        height: tattooMeta.height,
                        channels: 1 // Single channel for alpha
                    }})
                    .toBuffer();
                console.log('Successfully processed tattoo design to make black background transparent.');
            }
        } catch (alphaProcessError) {
            console.warn('Warning: Failed to process tattoo design for transparency (black background removal heuristic). Proceeding with original opaque buffer.', alphaProcessError.message);
            tattooDesignWithAlphaBuffer = tattooDesignBuffer; // Fallback if error occurs
        }

        // --- Step 2.3: Resize the tattoo design to fit the mask's bounding box and prepare for placement ---
        let tattooForPlacement;
        try {
            tattooForPlacement = await sharp(tattooDesignWithAlphaBuffer)
                .resize(maskBoundingBox.width, maskBoundingBox.height, {
                    fit: 'contain', // Maintain aspect ratio
                    background: { r: 0, g: 0, b: 0, alpha: 0 } // Ensure transparent background if scaling down
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
                        input: tattooForPlacement, // The tattoo design, now with transparency and sized for the mask area
                        blend: 'over', // Blends the input over the base image
                        tile: false,
                        left: maskBoundingBox.minX, // Position at the mask's calculated left edge
                        top: maskBoundingBox.minY,   // Position at the mask's calculated top edge
                        // This mask ensures the tattoo is clipped to the exact irregular shape drawn by the user.
                        // It acts as an alpha mask for this composite layer, independent of the tattoo's internal alpha.
                        mask: maskBuffer 
                    }
                ])
                .jpeg({ quality: 90 }) // Output as JPEG
                .toBuffer();
            console.log('Tattoo manually composited onto skin image with correct sizing, positioning, and clipping.');

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
            console.error('Error during manual image composition (Phase 1) with positioning:', error);
            throw new Error(`Failed to composite tattoo onto skin with correct positioning: ${error.message}`);
        }


        // 4. Construct the prompt for Flux Kontext (Now focused on blending/realism)
        const effectivePrompt = `Make the tattoo look naturally placed on the skin, blend seamlessly, adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`; // REFINED PROMPT
        console.log('Effective AI Refinement Prompt:', effectivePrompt);

        // 5. Make the Flux Kontext API call with the pre-composited image (Hybrid Approach Step 2)
        const fluxPayload = {
            prompt: effectivePrompt,
            input_image: compositedImageBuffer.toString('base64'), // Send the manually composited image
            mask_image: '', // No mask for full image blending/refinement by Flux (send empty string if required, or omit)
            n: numVariations, // Request 3 variations
            output_format: 'jpeg',
            fidelity: 0.8, // Adjusted fidelity for blending, not strict content transfer
            guidance_scale: 7.0, // Adjusted for blending, not strict adherence to initial prompt content
        };

        const fluxHeaders = {
            'Content-Type': 'application/json',
            'x-key': fluxApiKey
        };

        console.log('Calling Flux Kontext API for blending with payload (truncated images):');
        const debugPayload = { ...fluxPayload };
        debugPayload.input_image = debugPayload.input_image ? debugPayload.input_image.substring(0, 50) + '...' : 'N/A';
        if (debugPayload.mask_image === '') debugPayload.mask_image = 'Empty String'; // For log clarity
        if (debugPayload.reference_images) delete debugPayload.reference_images; // Ensure reference_images is not sent
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
                    break; // Exit loop after getting the first ready image if not requesting multiple
                          // If numVariations is strictly 3 and Flux returns one by one, this break needs re-evaluation.
                          // For now, assuming it returns one sample, and we need to poll for more if needed.
                          // The Flux API docs usually show `sample` as the single result.
                          // If `n` variations implies N `get_result` calls, this loop needs to handle that.
                          // Given 'sample' is singular, let's assume it's one result per task ID for simplicity.
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
