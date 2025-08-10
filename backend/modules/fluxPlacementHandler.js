// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-06-23_V1.38_FINAL_ALL_FIXES'); // UPDATED VERSION LOG

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data'; // Important for Node.js environments when sending FormData with axios

// Initialize Supabase Storage client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use the service role key for backend access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos'; // Configure this bucket in Render

// Get Remove.bg API Key
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY; // Make sure to set this in Render environment variables!

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
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        isEmpty: false
    };
}

const fluxPlacementHandler = {

    removeImageBackground: async (imageBuffer) => {
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
            console.warn('Background removal failed. Proceeding with original tattoo design.');
            return await sharp(imageBuffer).png().toBuffer();
        }
    },

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
                .composite([{
                    input: svgBuffer,
                    top,
                    left,
                    blend: 'over'
                }])
                .png()
                .toBuffer();

        } catch (error) {
            console.error('Error applying watermark:', error);
            return imageBuffer;
        }
    },

    uploadToSupabaseStorage: async (imageBuffer, fileName, userId, folder = '', contentType = 'image/jpeg') => {
        const filePath = folder ? `${userId}/${folder}/${fileName}` : `${userId}/${fileName}`;
        const { data, error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType,
                upsert: false
            });

        if (error) {
            console.error('Supabase upload error:', error);
            throw new Error(`Failed to upload image: ${error.message}`);
        }

        const { data: publicUrlData } = supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .getPublicUrl(filePath);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            throw new Error('No public URL returned.');
        }

        console.log('Image uploaded to Supabase:', publicUrlData.publicUrl);
        return publicUrlData.publicUrl;
    },

    placeTattooOnSkin: async (skinImageBuffer, tattooDesignImageBase64, maskBase64, userId, numVariations, fluxApiKey, tattooAngle = 0, tattooScale = 1.0) => {

        let tattooDesignOriginalBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
        let tattooDesignPngWithRemovedBackground = await fluxPlacementHandler.removeImageBackground(tattooDesignOriginalBuffer);

        const originalMaskBuffer = Buffer.from(maskBase64, 'base64');
        let maskMetadata = await sharp(originalMaskBuffer).metadata();
        let maskBuffer = await sharp(originalMaskBuffer).grayscale().raw().toBuffer();

        const skinMetadata = await sharp(skinImageBuffer).metadata();

        const maskBoundingBox = await getMaskBoundingBox(maskBuffer, maskMetadata.width, maskMetadata.height);
        if (maskBoundingBox.isEmpty) {
            throw new Error('Mask area is empty.');
        }

        let tattooForPlacement;
        let placementLeft;
        let placementTop;

        const magnificationFactor = 1.8;
        const targetWidth = Math.round(maskBoundingBox.width * tattooScale * magnificationFactor);
        const targetHeight = Math.round(maskBoundingBox.height * tattooScale * magnificationFactor);

        const resizedTattooBuffer = await sharp(tattooDesignPngWithRemovedBackground)
            .resize({ width: targetWidth, height: targetHeight, fit: sharp.fit.inside })
            .toBuffer();
        const rotatedTattooBuffer = await sharp(resizedTattooBuffer)
            .rotate(tattooAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
        tattooForPlacement = rotatedTattooBuffer;

        const resizedMeta = await sharp(resizedTattooBuffer).metadata();
        const rotatedMeta = await sharp(rotatedTattooBuffer).metadata();

        const centeredLeft = maskBoundingBox.minX + (maskBoundingBox.width - resizedMeta.width) / 2;
        const centeredTop = maskBoundingBox.minY + (maskBoundingBox.height - resizedMeta.height) / 2;

        placementLeft = Math.round(centeredLeft - (rotatedMeta.width - resizedMeta.width) / 2);
        placementTop = Math.round(centeredTop - (rotatedMeta.height - resizedMeta.height) / 2);

        // Manual composition
        const positionedTattooCanvas = await sharp({
            create: {
                width: skinMetadata.width,
                height: skinMetadata.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{ input: tattooForPlacement, left: placementLeft, top: placementTop }])
        .png()
        .toBuffer();

        let compositedImageBuffer = await sharp(skinImageBuffer)
            .composite([{ input: positionedTattooCanvas, blend: 'over', mask: maskBuffer }])
            .png()
            .toBuffer();

        // === FIX: Ensure mask size matches FLUX image before dest-in ===
        const compositedMeta = await sharp(compositedImageBuffer).metadata();
        if (maskMetadata.width !== compositedMeta.width || maskMetadata.height !== compositedMeta.height) {
            console.warn(`Mask size (${maskMetadata.width}x${maskMetadata.height}) != image size (${compositedMeta.width}x${compositedMeta.height}). Resizing mask.`);
            maskBuffer = await sharp(originalMaskBuffer)
                .resize(compositedMeta.width, compositedMeta.height)
                .grayscale()
                .raw()
                .toBuffer();
        }

        // 4. Flux API loop (3 variations preserved)
        const generatedImageUrls = [];
        const basePrompt = `Preserve the exact silhouette, linework, proportions and interior details of the tattoo. Only relight and blend the existing tattoo into the skin. Add realistic lighting, micro-shadowing, slight ink diffusion, and subtle skin texture. Do not redraw or restyle.`;

        for (let i = 0; i < numVariations; i++) {
            const currentSeed = Date.now() + i;

            const fluxPayload = {
                prompt: basePrompt,
                input_image: compositedImageBuffer.toString('base64'),
                mask_image: maskBase64,
                n: 1,
                output_format: 'png',
                fidelity: 0.8,
                guidance_scale: 8.0,
                prompt_upsampling: true,
                safety_tolerance: 2,
                seed: currentSeed
            };

            const fluxHeaders = { 'Content-Type': 'application/json', 'x-key': fluxApiKey };
            let fluxResponse;

            try {
                fluxResponse = await axios.post(
                    'https://api.bfl.ai/v1/flux-kontext-pro',
                    fluxPayload,
                    { headers: fluxHeaders, timeout: 90000 }
                );
            } catch (error) {
                console.error(`Flux API call failed:`, error.message);
                continue;
            }

            const taskId = fluxResponse.data.id;
            const pollingUrl = fluxResponse.data.polling_url;
            if (!taskId || !pollingUrl) continue;

            let attempts = 0;
            let currentImageReady = false;
            while (attempts < 60 && !currentImageReady) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));

                const result = await axios.get(pollingUrl, { headers: { 'x-key': fluxApiKey }, timeout: 10000 });
                if (result.data.status === 'Ready') {
                    const imageUrlFromFlux = result.data.result && result.data.result.sample;
                    if (imageUrlFromFlux) {
                        const imageResponse = await axios.get(imageUrlFromFlux, { responseType: 'arraybuffer' });
                        const imageBuffer = Buffer.from(imageResponse.data);
                        const watermarkedBuffer = await fluxPlacementHandler.applyWatermark(imageBuffer);
                        const fileName = `tattoo-${uuidv4()}.png`;
                        const publicUrl = await fluxPlacementHandler.uploadToSupabaseStorage(watermarkedBuffer, fileName, userId, '', 'image/png');
                        generatedImageUrls.push(publicUrl);
                        currentImageReady = true;
                    }
                }
            }
        }

        if (generatedImageUrls.length === 0) {
            throw new Error('No images generated.');
        }

        return generatedImageUrls;
    }
};

export default fluxPlacementHandler;
