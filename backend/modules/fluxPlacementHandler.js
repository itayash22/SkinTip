// backend/modules/fluxPlacementHandler.js

const axios = require('axios');
const sharp = require('sharp'); // For image manipulation and watermarking
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid'); // For unique filenames in Supabase Storage

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

const fluxPlacementHandler = {

    /**
     * Inverts the colors of a Base64 encoded PNG mask image.
     * Assumes a grayscale image (black/white). Black becomes white, white becomes black.
     * Returns the inverted mask as a Base64 string (no data URL prefix).
     * @param {string} maskBase64 The base64 string of the mask (without data:image/png;base64, prefix)
     * @returns {Promise<string>} A promise that resolves with the inverted base64 mask.
     * @throws {Error} If sharp fails to process the mask.
     */
    invertMask: async (maskBase64) => {
        const buffer = Buffer.from(maskBase64, 'base64');
        try {
            // Ensure mask is PNG and then negate
            const invertedBuffer = await sharp(buffer)
                .ensureAlpha() // Ensure it has an alpha channel for consistent negation
                .negate({ alpha: false }) // Invert colors, but don't touch alpha channel
                .png() // Convert to PNG
                .toBuffer();
            console.log('Mask successfully inverted.');
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
            console.error('Error applying watermark:', error);
            // Don't throw a critical error here, as the image might still be usable without watermark.
            // In production, you might want to log this extensively or notify.
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
        let invertedMaskBase64;
        try {
            invertedMaskBase64 = await fluxPlacementHandler.invertMask(maskBase64);
        } catch (error) {
            throw new Error(`Mask inversion failed: ${error.message}`);
        }

        // 3. Construct the prompt for Flux Kontext
        // Kontext uses text instructions and reference_images for guidance.
        // The prompt will guide the integration.
        const effectivePrompt = `Place this tattoo design onto the human skin realistically, considering lighting and body contours. Realistic photo, professional tattoo photography, high detail. ${userPrompt ? 'Additional instructions: ' + userPrompt : ''}`;
        console.log('Effective Flux Kontext Prompt:', effectivePrompt);

        // 4. Make the Flux Kontext API call
        const fluxPayload = {
            prompt: effectivePrompt,
            input_image: skinImageBuffer.toString('base64'), // Original skin image
            mask_image: invertedMaskBase64, // Inverted mask (black for tattoo area)
            // Using reference_images for the tattoo design itself
            reference_images: [tattooDesignBuffer.toString('base64')], // Pass the tattoo design here
            n: numVariations, // Request 3 variations
            output_format: 'jpeg',
            // Additional Kontext parameters for quality/control if needed:
            // fidelity: 0.8, // Adjust as per Kontext docs, might control adherence to reference image
            // guidance_scale: 7.0, // Standard SD parameter, adjust for creativity vs prompt adherence
            // num_inference_steps: 50
        };

        const fluxHeaders = {
            'Content-Type': 'application/json',
            'x-key': fluxApiKey // Your Flux API key
        };

        console.log('Calling Flux Kontext API...');
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

        // 5. Poll for results (similar to previous implementation)
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

            if (result.data.status === 'Ready') {
                if (result.data.result && Array.isArray(result.data.result.samples)) {
                    for (const sampleBase64 of result.data.result.samples) { // Kontext can return multiple samples as base64
                        const imageBuffer = Buffer.from(sampleBase64, 'base64');
                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
                        const fileName = `tattoo-${uuidv4()}.jpeg`;
                        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
                        generatedImageUrls.push(publicUrl);
                    }
                    console.log(`Successfully generated and watermarked ${generatedImageUrls.length} images.`);
                    break; // Exit loop if all expected variations are ready
                } else if (result.data.result && result.data.result.sample) { // Fallback for single 'sample' field
                    const imageBuffer = Buffer.from(result.data.result.sample, 'base64');
                    const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
                    const fileName = `tattoo-${uuidv4()}.jpeg`;
                    const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId);
                    generatedImageUrls.push(publicUrl);
                    console.log(`Successfully generated and watermarked 1 image.`);
                    break;
                } else {
                    console.warn('Flux API returned Ready status but no samples found.', result.data);
                    throw new Error('Flux API returned no images.');
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
