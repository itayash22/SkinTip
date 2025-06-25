// backend/modules/fluxPlacementHandler.js (This file now handles OmniGen2)
console.log('OMNIGEN_HANDLER_VERSION: 2025-06-25_V1.0_INITIAL_OMNIGEN_INTEGRATION');

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data'; // Needed for Node.js when sending multipart/form-data

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';

// OmniGen2 (Replicate) Specifics
const REPLICATE_API_URL = "https://api.replicate.com/v1/predictions";
const OMNIGEN_MODEL_VERSION = "a5ce5260dd43640b37996a1a1f021e155b46d7888de6d628d096d29b28b6131c"; // From Replicate model page for OmniGen2

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
    return { minX: minX, minY: minY, maxY: maxY, width: maxX - minX + 1, height: maxY - minY + 1, isEmpty: false };
}

const omnigenImageGenerator = { // Renamed conceptually from fluxPlacementHandler

    /**
     * Calls Remove.bg API to remove background from an image buffer.
     * Returns a buffer of the image with background removed (always PNG).
     */
    removeImageBackground: async (imageBuffer) => {
        const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY; // Get key here
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
     * @param {Buffer} skinImageBuffer - Buffer of the skin image (JPG or opaque PNG).
     * @param {string} tattooDesignImageBase64 - Base64 of the tattoo design image (transparent PNG expected, but will be processed by remove.bg).
     * @param {string} maskBase64 - Base64 of the mask image (white on black, PNG).
     * @param {string} userId - User ID for storage.
     * @param {number} numVariations - Number of variations to generate (OmniGen2 typically generates 1 per call).
     * @param {string} replicateApiToken - Replicate API Token.
     * @returns {Promise<string[]>} Array of generated image URLs.
     */
    generateImageWithOmnigen: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, numVariations, replicateApiToken) => {
        console.log('Starting OmniGen2 (Replicate) image generation process...');

        // 1. Prepare tattoo design: Ensure transparent PNG after background removal
        // This will now always output a PNG with transparency (from remove.bg or original)
        let tattooDesignPngFinalBuffer = await omnigenImageGenerator.removeImageBackground(
            Buffer.from(tattooDesignImageBase64, 'base64')
        );

        // 2. Prepare mask: Ensure white on black PNG
        // The mask is directly passed to OmniGen2's mask_input
        const maskPngBuffer = await sharp(Buffer.from(maskBase64, 'base64')).png().toBuffer();
        const maskPngBase64 = `data:image/png;base64,${maskPngBuffer.toString('base64')}`;


        // 3. Composite tattoo onto skin using Sharp for OmniGen2's `image_input`
        // OmniGen2 expects the "base image" and the "mask" separately.
        // The `image_input` should be the skin image WITH the transparent tattoo overlaid.
        let compositedImageBuffer = await sharp(skinImageBuffer)
            .composite([
                {
                    input: tattooDesignPngFinalBuffer,
                    blend: 'over', // Standard blend mode
                    tile: false,
                    left: 0, // OmniGen2 repositions; here we're just overlaying for the base image
                    top: 0
                }
            ])
            .png() // Ensure the composited base image is PNG to send to OmniGen2
            .toBuffer();
        
        // Upload debug composite image (tattoo on skin) - this is what OmniGen2 will see as its input_image
        const debugFileName = `debug_sharp_composite_omnigen_input_${uuidv4()}.png`;
        const debugPublicUrl = await omnigenImageGenerator.uploadToSupabaseStorage(
            compositedImageBuffer, debugFileName, userId, 'debug', 'image/png'
        );
        console.log(`DEBUG: SHARP COMPOSITED INPUT TO OMNIGEN URL: ${debugPublicUrl}`);

        // OmniGen2 API call parameters
        const omnigenPrompt = "Make the tattoo look naturally placed on the skin, blend seamlessly, adjust lighting and shadows for realism. Realistic photo, professional tattoo photography, high detail.";
        
        const replicatePayload = {
            version: OMNIGEN_MODEL_VERSION,
            input: {
                prompt: omnigenPrompt,
                image_input: `data:image/png;base64,${compositedImageBuffer.toString('base64')}`, // Composited image
                mask_input: maskPngBase64, // Mask from drawing
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
                        // OmniGen2 outputs an array of URLs for 'n' variations (even if n=1)
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
