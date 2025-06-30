// backend/modules/fluxPlacementHandler.js (This file now handles OmniGen2)
console.log('OMNIGEN_HANDLER_VERSION: 2025-06-25_V1.4_NEW_MODEL_VERSION_FROM_USER'); // UPDATED VERSION LOG

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data'; // Needed for Node.js when sending multipart/form-data

// Initialize Supabase Storage client (unchanged)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';

// OmniGen2 (Replicate) Specifics
const REPLICATE_API_URL = "https://api.replicate.com/v1/predictions";
const OMNIGEN_MODEL_VERSION = "696cdda9b4fdb09335bac614c0cb8d60fcd4215d"; // <--- UPDATED TO THE NEW HASH YOU PROVIDED

// --- HELPER FUNCTIONS (unchanged from previous flux handler) ---
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
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX + 1, height: maxY - minY + 1, isEmpty: false };
}

const omnigenImageGenerator = { // Renamed conceptually from fluxPlacementHandler

    /**
     * Calls Remove.bg API to remove background from an image buffer.
     * Returns a buffer of the image with background removed (always PNG).
     */
    removeImageBackground: async (imageBuffer) => {
        const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
        if (!REMOVE_BG_API_KEY) {
            console.warn('REMOVE_BG_API_KEY is not set. Skipping background removal and returning original image as PNG.');
            return await sharp(imageBuffer).png().toBuffer();
        }
        try {
            console.log('Calling Remove.bg API for background removal...');
            const formData = new FormData();
            formData.append('image_file', new Blob([imageBuffer], { type: 'image/png' }), 'tattoo_design.png');
            formData.append('size', 'auto');
            formData.append('format', 'png');

            const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
                headers: {
                    'X-Api-Key': REMOVE_BG_API_KEY,
                    ...formData.getHeaders()
                },
                responseType: 'arraybuffer'
            });

            if (response.status === 200) {
                console.log('Background removed successfully by Remove.bg.');
                return Buffer.from(response.data);
            } else {
                const errorResponseData = response.data.toString();
                console.error('Remove.bg API error:', response.status, response.statusText, errorResponseData);
                throw new Error(`Remove.bg API failed with status ${response.status}: ${errorResponseData.substring(0, 100)}`);
            }
        } catch (error) {
            console.error('Error calling Remove.bg API:', error.response?.data?.toString() || error.message);
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

            return await sharp(imageBuffer)
                .composite([{ input: svgBuffer, top: top, left: left, blend: 'over' }])
                .png()
                .toBuffer();
        } catch (error) {
            console.error('Error applying watermark (caught):', error);
            return imageBuffer;
        }
    },

    /**
     * Uploads an image buffer to Supabase Storage and returns its public URL.
     */
    uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/png') => { // Default contentType to PNG
        const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
        const { data, error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(filePath, imageBuffer, { contentType: contentType, upsert: false });

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
     * Generates images using OmniGen2 (Replicate) API.
     * @param {Buffer} skinImageBuffer - Buffer of the skin image (will be image_input).
     * @param {string} tattooDesignImageBase64 - Base64 of the tattoo design image (will be image_2 in prompt).
     * @param {string} maskBase64 - Base64 of the mask image (white on black, PNG, will be mask_input).
     * @param {string} userId - User ID for storage.
     * @param {number} numVariations - Number of variations to generate (OmniGen2 typically generates 1 per call).
     * @param {string} replicateApiToken - Replicate API Token.
     * @returns {Promise<string[]>} Array of generated image URLs.
     */
    generateImageWithOmnigen: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, numVariations, replicateApiToken) => {
        console.log('Starting OmniGen2 (Replicate) image generation process with raw inputs...');

        // 1. Prepare skin image: Convert to Base64 PNG for OmniGen2's `image_input`
        const skinImagePngBuffer = await sharp(skinImageBuffer).png().toBuffer();
        const skinImagePngBase64 = `data:image/png;base64,${skinImagePngBuffer.toString('base64')}`;
        const skinImageMeta = await sharp(skinImagePngBuffer).metadata();
        console.log(`Skin Image (for OmniGen image_input) Meta: format=${skinImageMeta.format}, width=${skinImageMeta.width}, height=${skinImageMeta.height}, hasAlpha=${skinImageMeta.hasAlpha}`);


        // 2. Prepare tattoo design: Ensure transparent PNG after background removal (will be `image_2` in prompt)
        const tattooDesignPngFinalBuffer = await omnigenImageGenerator.removeImageBackground(
            Buffer.from(tattooDesignImageBase64, 'base64')
        );
        const tattooDesignPngFinalBase64 = `data:image/png;base64,${tattooDesignPngFinalBuffer.toString('base64')}`;
        const tattooDesignMeta = await sharp(tattooDesignPngFinalBuffer).metadata();
        console.log(`Tattoo Design (for OmniGen image_2) Meta: format=${tattooDesignMeta.format}, width=${tattooDesignMeta.width}, height=${tattooDesignMeta.height}, hasAlpha=${tattooDesignMeta.hasAlpha}`);


        // 3. Prepare mask: Ensure white on black PNG (will be `mask_input`)
        const maskPngBuffer = await sharp(Buffer.from(maskBase64, 'base64')).png().toBuffer();
        const maskPngBase64 = `data:image/png;base64,${maskPngBuffer.toString('base64')}`;
        const maskMeta = await sharp(maskPngBuffer).metadata();
        console.log(`Mask Meta: format=${maskMeta.format}, width=${maskMeta.width}, height=${maskMeta.height}`);
        
        // --- DEBUGGING STEP: Upload inputs to Supabase for verification ---
        // These are the images as they will be sent to OmniGen2
        const debugSkinUrl = await omnigenImageGenerator.uploadToSupabaseStorage(skinImagePngBuffer, `debug_omnigen_input_skin_${uuidv4()}.png`, userId, 'debug_input', 'image/png');
        console.log(`DEBUG: OMNIGEN INPUT SKIN URL: ${debugSkinUrl}`);

        const debugTattooUrl = await omnigenImageGenerator.uploadToSupabaseStorage(tattooDesignPngFinalBuffer, `debug_omnigen_input_tattoo_${uuidv4()}.png`, userId, 'debug_input', 'image/png');
        console.log(`DEBUG: OMNIGEN INPUT TATTOO URL: ${debugTattooUrl}`);

        const debugMaskUrl = await omnigenImageGenerator.uploadToSupabaseStorage(maskPngBuffer, `debug_omnigen_input_mask_${uuidv4()}.png`, userId, 'debug_input', 'image/png');
        console.log(`DEBUG: OMNIGEN INPUT MASK URL: ${debugMaskUrl}`);
        // --- END DEBUGGING STEP ---


        // OmniGen2 API call parameters
        // The prompt now explicitly guides the AI to place image_2 (tattoo) onto image_1 (skin) using the mask.
        const omnigenPrompt = `Place the tattoo design ${'<img><|image_2|></img>'} onto the skin ${'<img><|image_1|></img>'} seamlessly, adjusting for lighting and shadows. Make it look like a realistic tattoo.`;
        
        const replicatePayload = {
            version: OMNIGEN_MODEL_VERSION,
            input: {
                prompt: omnigenPrompt,
                image_input: skinImagePngBase64, // The base skin image (image_1 in prompt)
                mask_input: maskPngBase64, // The mask to guide placement/editing
                image_2: tattooDesignPngFinalBase64, // The tattoo design itself (image_2 in prompt)
                inference_steps: 75, // Higher quality steps (default 50)
                guidance_scale: 7.5, // Balance text prompt adherence
                img_guidance_scale: 1.8, // Balance adherence to input image
                seed: Math.floor(Math.random() * 1000000000), // Random seed for variations
                output_format: "png" // Request PNG output from OmniGen2
            }
        };

        const replicateHeaders = {
            'Authorization': `Token ${replicateApiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        let predictionId = null;
        let predictionStatus = null;
        const generatedImageUrls = [];

        // OmniGen2 (Replicate) initial request (start prediction)
        try {
            console.log('Sending request to Replicate OmniGen2 API (prediction start)...');
            const startResponse = await axios.post(REPLICATE_API_URL, replicatePayload, { headers: replicateHeaders, timeout: 120000 });
            
            if (startResponse.status !== 201) { // 201 Created is expected for a new prediction
                throw new Error(`OmniGen2 API: Failed to start prediction (Status: ${startResponse.status}). Response: ${JSON.stringify(startResponse.data)}`);
            }
            predictionId = startResponse.data.id;
            predictionStatus = startResponse.data.status;
            console.log(`OmniGen2 Prediction started with ID: ${predictionId}, Status: ${predictionStatus}`);
        } catch (error) {
            const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            console.error('Error starting OmniGen2 prediction:', errorDetail);
            throw new Error(`OmniGen2 API: Failed to start prediction: ${errorDetail}`);
        }
        
        // Polling loop for OmniGen2 (Replicate) results
        let attempts = 0;
        const maxAttempts = 60; // Poll for up to 2 minutes (60 * 2s)
        const pollInterval = 2000; // 2 seconds

        while (attempts < maxAttempts && predictionStatus !== 'succeeded' && predictionStatus !== 'failed' && predictionStatus !== 'canceled') {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
                const pollUrl = `${REPLICATE_API_URL}/${predictionId}`;
                const pollResponse = await axios.get(pollUrl, { headers: replicateHeaders, timeout: 10000 });
                predictionStatus = pollResponse.data.status; // Update status
                
                console.log(`OmniGen2 Polling Status (Attempt ${attempts}): ${predictionStatus}`);

                if (predictionStatus === 'succeeded') {
                    if (pollResponse.data.output && pollResponse.data.output.length > 0) {
                        for (const imageUrlFromOmnigen of pollResponse.data.output) {
                            if (typeof imageUrlFromOmnigen === 'string' && imageUrlFromOmnigen.startsWith('http')) {
                                console.log(`Downloading result from OmniGen2: ${imageUrlFromOmnigen.substring(0, 50)}...`);
                                const imageResponse = await axios.get(imageUrlFromOmnigen, { responseType: 'arraybuffer' });
                                const imageBuffer = Buffer.from(imageResponse.data);

                                const watermarkedBuffer = await omnigenImageGenerator.applyWatermark(imageBuffer);
                                const fileName = `tattoo-omnigen-${uuidv4()}.png`; // Save as PNG
                                const publicUrl = await omnigenImageGenerator.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId, '', 'image/png');
                                generatedImageUrls.push(publicUrl);
                                console.log(`Successfully processed and stored image from OmniGen2: ${publicUrl}`);
                            } else {
                                console.warn(`OmniGen2 returned malformed output for an image:`, imageUrlFromOmnigen);
                            }
                        }
                        currentImageReady = true; // Mark as ready
                        break; // Exit polling loop
                    } else {
                        throw new Error('OmniGen2 API: Succeeded, but no output images found.');
                    }
                } else if (predictionStatus === 'failed' || predictionStatus === 'canceled') {
                    throw new Error(`OmniGen2 API: Prediction ${predictionStatus}. Details: ${JSON.stringify(pollResponse.data.error || pollResponse.data.logs)}`);
                } else if (predictionStatus === 'starting' || predictionStatus === 'processing') {
                    // Continue polling
                } else {
                    console.warn(`OmniGen2 Polling: Unexpected status "${predictionStatus}" for prediction ID ${predictionId}`);
                }

            } catch (error) {
                const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
                console.error(`Error polling OmniGen2 prediction ${predictionId}:`, errorDetail);
                // Optionally re-throw or handle specific API errors
                break; // Break loop on error
            }
        }

        if (generatedImageUrls.length === 0) {
            throw new Error('OmniGen2 API: No images were generated or retrieved successfully after polling attempts.');
        }

        return generatedImageUrls;
    }
};

export default omnigenImageGenerator;
