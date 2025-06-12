// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-11_V1.9_MASK_NO_INVERT_PROMPT_GUIDANCE_TUNE'); // UPDATED VERSION LOG

const axios = require('axios');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js'); // Correct import for Supabase
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

const fluxPlacementHandler = {

    /**
     * Inverts the colors of a Base64 encoded PNG mask image.
     * NOTE: This function will no longer be called directly for the mask_image sent to Flux
     * in the placeTattooOnSkin function, but it's kept here if other parts of the app use it.
     */
    invertMask: async (maskBase64) => {
        const buffer = Buffer.from(maskBase64, 'base64');
        try {
            // DEBUG: Log input mask properties
            const inputMaskMetadata = await sharp(buffer).metadata();
            console.log('Mask Invert DEBUG: Input mask format:', inputMaskMetadata.format, 'channels:', inputMaskMetadata.channels);
            
            const invertedBuffer = await sharp(buffer)
                .ensureAlpha() // Ensure it has an alpha channel for consistent negation
                .negate({ alpha: false }) // Invert colors, but don't touch alpha channel
                .png() // Convert to PNG
                .toBuffer();
            console.log('Mask successfully inverted.');
            // DEBUG: Log output mask properties
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
            // DEBUGGING: Inspect the buffer right before sharp is called
            console.log('Watermark DEBUG: imageBuffer length (bytes):', imageBuffer.length);
            console.log('Watermark DEBUG: imageBuffer first 20 bytes (hex):', imageBuffer.toString('hex', 0, 20));
            console.log('Watermark DEBUG: imageBuffer first 20 bytes (base64):', imageBuffer.toString('base64', 0, 20));

            const watermarkText = 'SkinTip.AI';
            const watermarkSvg = `<svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
                                    <text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" fill-opacity="0.5">${watermarkText}</text>
                                  </svg>`;
            const svgBuffer = Buffer.from(watermarkSvg);

            // Get image metadata to determine position for watermark
            const metadata = await sharp(imageBuffer).metadata();
            const imageWidth = metadata.width;
            const imageHeight = metadata.height;

            // Position watermark (e.g., bottom-right corner, with some padding)
            // Adjust these values based on desired padding and watermark SVG size
            const svgWidth = 200; // From SVG viewBox
            const svgHeight = 30; // From SVG viewBox
            const padding = 15;

            const left = Math.max(0, imageWidth - svgWidth - padding);
            const top = Math.max(0, imageHeight - svgHeight - padding);

            const watermarkedBuffer = await sharp(imageBuffer)
                .composite([{
                    input: svgBuffer,
                    top: top,
                    left: left,
                    blend: 'over' // Overlay watermark
                }])
                .jpeg({ quality: 90 }) // Ensure output is JPEG for consistent quality/size
                .toBuffer();

            return watermarkedBuffer;
        } catch (error) {
            console.error('Error applying watermark (caught):', error); 
            return imageBuffer; // Return original buffer if watermarking fails
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     * @param {Buffer} imageBuffer The image buffer to upload.
     * @param {string} fileName The desired filename (e.g., 'tattoo_uuid.jpeg').
     * @param {string} userId The ID of the user for path organization.
     * @returns {Promise<string>} The public URL of the uploaded image.
     * @throws {Error} If Supabase upload fails.
     */
    uploadToSupabaseStorage: async (imageBuffer, fileName, userId) => {
        const filePath = `${userId}/${fileName}`; // Store in user-specific folder
        const { data, error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType: 'image/jpeg', // Ensure consistent content type
                upsert: false // Don't overwrite existing files with same name
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
     * @param {string} userId The ID of the user for storage path.
     * @param {number} numVariations The number of variations to request (e.g., 3).
     * @param {string} fluxApiKey The Flux API key.
     * @returns {Promise<string[]>} An array of public URLs to the watermarked, generated images.
     * @throws {Error} If API call, image processing, or upload fails.
     */
    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userPrompt, userId, numVariations, fluxApiKey) => {
        console.log('Starting Flux tattoo placement process...');

        // 1. Convert tattoo design Base64 to Buffer and ensure consistent format/size
        let tattooDesignBuffer;
        try {
            tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
            // Ensure tattoo design image is JPG for consistent processing
            tattooDesignBuffer = await sharp(tattooDesignBuffer).jpeg({ quality: 90 }).toBuffer();
            console.log('Tattoo design image converted to buffer.');
        } catch (error) {
            console.error('Error processing tattoo design image base64:', error);
            throw new Error('Invalid tattoo design image data provided.');
        }
        
        // 2. Invert the mask for Flux (frontend draws white for tattoo, backend inverts to black)
        // IMPORTANT: For this attempt, we are NOT inverting the mask for Flux.
        // The frontend mask (white for tattoo area, black background) will be sent directly.
        let maskToSendToFlux = maskBase64; // Use the original maskBase64 from frontend
        console.log('Mask Inversion skipped. Sending frontend mask directly to Flux.');


        // 3. Construct the prompt for Flux Kontext
        const effectivePrompt = `Integrate this uploaded tattoo design (from reference image) onto the human skin realistically within the masked area, considering lighting and body contours. The tattoo should look like a real, applied tattoo. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`; // REFINED PROMPT
        console.log('Effective Flux Kontext Prompt:', effectivePrompt);

        // 4. Make the Flux Kontext API call
        const fluxPayload = {
            prompt: effectivePrompt,
            input_image: skinImageBuffer.toString('base64'), // Original skin image
            mask_image: maskToSendToFlux, // Send mask directly (no inversion)
            // Using reference_images for the tattoo design itself
            reference_images: [tattooDesignBuffer.toString('base64')], // Pass the tattoo design here
            n: numVariations, // Request 3 variations
            output_format: 'jpeg',
            // IMPORTANT: Tuned parameters for better adherence to reference and prompt
            fidelity: 0.95, // High fidelity to ensure tattoo design is present (0.7-1.0)
            guidance_scale: 12.0, // Stronger adherence to the prompt (7.0-15.0)
            // num_inference_steps: 50 // Keep default or experiment with higher for quality
        };

        const fluxHeaders = {
            'Content-Type': 'application/json',
            'x-key': fluxApiKey // Your Flux API key
        };

        console.log('Calling Flux Kontext API with payload (truncated images for log):'); // MODIFIED LOG
        const debugPayload = { ...fluxPayload };
        debugPayload.input_image = debugPayload.input_image ? debugPayload.input_image.substring(0, 50) + '...' : 'N/A';
        debugPayload.mask_image = debugPayload.mask_image ? debugPayload.mask_image.substring(0, 50) + '...' : 'N/A';
        debugPayload.reference_images = debugPayload.reference_images ? debugPayload.reference_images[0].substring(0, 50) + '...' : 'N/A';
        console.log(JSON.stringify(debugPayload, null, 2)); // LOG TRUNCATED PAYLOAD
        
        let fluxResponse;
        try {
            fluxResponse = await axios.post(
                'https://api.bfl.ai/v1/flux-kontext-pro', // Using Kontext as per plan
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
            throw new Error('Flux API did not start generation task.');
        }

        // 5. Poll for results
        let attempts = 0;
        const generatedImageUrls = [];
        while (attempts < 60 && generatedImageUrls.length < numVariations) { // Poll until all variations are ready or timeout
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds

            const result = await axios.get(
                `https://api.bfl.ai/v1/get_result?id=${taskId}`, // Use the general get_result endpoint
                {
                    headers: { 'x-key': fluxApiKey },
                    timeout: 10000
                }
            );

            // DEBUGGING: Log the entire result data from Flux API
            console.log('Flux Polling Result Data (FULL RESPONSE):', JSON.stringify(result.data, null, 2));

            if (result.data.status === 'Ready') {
                // FIX: Flux Kontext Pro returns a 'sample' URL, not 'samples' array of Base64.
                const imageUrlFromFlux = result.data.result && result.data.result.sample; // Get the URL from 'sample' field

                if (imageUrlFromFlux) {
                    let imageBuffer;
                    try {
                        // Download the image from the URL
                        const imageResponse = await axios.get(imageUrlFromFlux, { responseType: 'arraybuffer' });
                        imageBuffer = Buffer.from(imageResponse.data); // Convert ArrayBuffer to Node.js Buffer
                        console.log(`Successfully downloaded image from Flux URL: ${imageUrlFromFlux.substring(0, 50)}...`);
                    } catch (downloadError) {
                        console.error('Error downloading image from Flux URL:', imageUrlFromFlux, downloadError.message);
                        throw new Error(`Failed to download image from Flux URL: ${downloadError.message}`); // Re-throw to indicate failure
                    }

                    // Apply watermark
                    const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
                    const fileName = `tattoo-${uuidv4()}.jpeg`; // Always save as JPEG
                    const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
                    generatedImageUrls.push(publicUrl);
                    console.log(`Successfully generated and watermarked 1 image.`);
                    break; // Exit loop after processing this sample
                } else {
                    console.warn('Flux API returned Ready status but no valid image URL found in "sample".', result.data);
                    throw new Error('Flux API returned no images or malformed output.');
                }
            }

            if (result.data.status === 'Error') {
                console.error('Flux API Polling Error:', result.data);
                throw new Error('Image generation failed during polling: ' + JSON.stringify(result.data));
            }

            console.log(`Polling attempt ${attempts}: ${result.data.status}`);
        }

        if (generatedImageUrls.length === 0) {
            throw new Error('Generation timeout: No images were generated within the time limit.');
        }
        
        return generatedImageUrls;
    }
};

module.exports = fluxPlacementHandler;
