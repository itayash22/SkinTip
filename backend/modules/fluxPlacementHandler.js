// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-14_V1.19_DYNAMIC_BG_ALPHA_REMOVAL'); // UPDATED VERSION LOG

const axios = require('axios');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

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

        // --- NEW Step 2.2: Attempt to make background transparent (dynamic heuristic) ---
        let tattooDesignWithAlphaBuffer = tattooDesignBuffer; // Start with the initial tattoo buffer (already PNG)
        try {
            const tattooMeta = await sharp(tattooDesignBuffer).metadata();
            
            // Only attempt background removal if it's a JPG (always opaque) or a PNG without alpha
            if (tattooMeta.format === 'jpeg' || (tattooMeta.format === 'png' && tattooMeta.channels < 4)) {
                console.log('Attempting to add transparency to tattoo design using background color heuristic...');

                // Sample a corner pixel to determine background color (e.g., top-left)
                const { data: pixelData } = await sharp(tattooDesignBuffer)
                    .extract({ left: 0, top: 0, width: 1, height: 1 })
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                
                let backgroundColor = [0, 0, 0]; // Default to black if detection fails
                if (pixelData.info.channels >= 3) { // RGB or RGBA
                    backgroundColor = [pixelData.data[0], pixelData.data[1], pixelData.data[2]];
                } else if (pixelData.info.channels === 1) { // Grayscale
                    backgroundColor = [pixelData.data[0], pixelData.data[0], pixelData.data[0]];
                }
                console.log('Detected top-left pixel color (R,G,B):', backgroundColor);

                // Define thresholds for 'near black' and 'near white'
                const isNearWhite = (c) => c > 240; // High value for white
                const isNearBlack = (c) => c < 15; // Low value for black

                const isBackgroundWhite = isNearWhite(backgroundColor[0]) && isNearWhite(backgroundColor[1]) && isNearWhite(backgroundColor[2]);
                const isBackgroundBlack = isNearBlack(backgroundColor[0]) && isNearBlack(backgroundColor[1]) && isNearBlack(backgroundColor[2]);

                let alphaMaskRawBuffer;
                if (isBackgroundWhite) {
                    console.log('Detected white background. Keying out white...');
                    // Create mask: pixels near white become 0 (transparent), others 255 (opaque)
                    alphaMaskRawBuffer = await sharp(tattooDesignBuffer)
                        .threshold(240) // Values >= 240 become white (255), < 240 become black (0)
                        .toColourspace('b-w')
                        .raw()
                        .toBuffer();
                    // Invert this mask: white (background) becomes black (transparent), black (tattoo) becomes white (opaque)
                    alphaMaskRawBuffer = await sharp(alphaMaskRawBuffer, { raw: { width: tattooMeta.width, height: tattooMeta.height, channels: 1 } })
                                          .negate()
                                          .raw()
                                          .toBuffer();

                } else if (isBackgroundBlack) {
                    console.log('Detected black background. Keying out black...');
                    // Create mask: pixels > 0 (not pure black) become white (opaque), pure black (0) remains 0 (transparent)
                    alphaMaskRawBuffer = await sharp(tattooDesignBuffer)
                        .threshold(1) // Values >= 1 become white (255), 0 remains black (0)
                        .toColourspace('b-w')
                        .raw()
                        .toBuffer();
                } else {
                    console.warn('Background color is neither clearly black nor white. Cannot apply automatic transparency heuristic.');
                    throw new Error('Tattoo design has a complex or non-uniform background. Auto-transparency skipped.');
                }
                
                tattooDesignWithAlphaBuffer = await sharp(tattooDesignBuffer)
                    .ensureAlpha() // Ensure the image has an alpha channel to join to
                    .joinChannel(alphaMaskRawBuffer, { raw: {
                        width: tattooMeta.width,
                        height: tattooMeta.height,
                        channels: 1
                    }})
                    .toBuffer();
                console.log('Successfully processed tattoo design to make background transparent.');
            }
        } catch (alphaProcessError) {
            console.warn('Warning: Failed to process tattoo design for transparency (background removal heuristic). Proceeding with original opaque buffer.', alphaProcessError.message);
            tattooDesignWithAlphaBuffer = tattooDesignBuffer; // Fallback if error occurs
        }
        // --- END NEW Step 2.2 ---

        // --- Step 2.3: Resize the tattoo design to fit the mask's bounding box and prepare for placement ---
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
                        mask: maskBuffer 
                    }
                ])
                .jpeg({ quality: 90 })
                .toBuffer();
            console.log('Tattoo manually composited onto skin image with correct sizing, positioning, and clipping.');

            // --- DEBUGGING STEP: UPLOAD AND LOG INTERMEDIATE IMAGE ---
            try {
                const debugFileName = `debug_sharp_composite_${uuidv4()}.jpeg`;
                const debugPublicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(
                    compositedImageBuffer,
                    debugFileName,
                    userId,
                    'debug'
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
                input_image: compositedImageBuffer.toString('base64'),
                mask_image: '',
                n: 1, // Request 1 variation per call
                output_format: 'jpeg',
                fidelity: 0.6, // Adjusted fidelity for more blending
                guidance_scale: 7.0,
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

                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
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

module.exports = fluxPlacementHandler;
