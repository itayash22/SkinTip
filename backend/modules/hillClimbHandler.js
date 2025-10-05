import Papa from 'papaparse';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// --- Supabase Setup ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const REQUIRED_HEADERS = [
    'image_id', 'engine', 'adaptive_scale_enabled', 'adaptive_engine_enabled', 'global_scale_up',
    'kontext_size_bias', 'fill_size_bias', 'model_mask_grow_pct', 'model_mask_grow_min', 'model_mask_grow_max',
    'bake_tattoo_brightness', 'bake_tattoo_gamma', 'bake_overlay_opacity', 'bake_softlight_opacity',
    'bake_multiply_opacity', 'prompt_weight', 'negative_prompt_weight', 'pick_of_the_litter',
    'iteration_feedback', 'engine_call_mode', 'engine_endpoint_url', 'engine_switch_reason'
];

async function uploadImageToSupabase(imageBuffer, userId, folder, fileName) {
    const filePath = `${userId}/${folder}/${fileName}`;
    const { error } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .upload(filePath, imageBuffer, {
            contentType: 'image/png', // Assuming PNG, adjust if needed
            upsert: false,
        });

    if (error) {
        console.error('Supabase upload error:', error);
        throw new Error(`Failed to upload image to storage: ${error.message}`);
    }

    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
    if (!pub?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded image.');
    }
    console.log(`Image uploaded to Supabase: ${pub.publicUrl}`);
    return pub.publicUrl;
}

async function callFluxApi(payload, apiKey) {
    console.log('Calling FLUX API with endpoint:', payload.engine_endpoint_url);
    // This is where the actual API call would happen.
    // For now, we return a mock URL.
    if (!apiKey) {
        console.log("No FLUX API key provided, returning mock data.");
        const mockImageUrl = `https://picsum.photos/512/512?random=${Math.floor(Math.random() * 1000)}`;
        return { output_url: mockImageUrl };
    }

    // Real API call logic (kept for reference)
    /*
    const response = await fetch(payload.engine_endpoint_url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`FLUX API request failed with status ${response.status}: ${errorBody}`);
    }

    return await response.json();
    */

    // Returning mock for now to avoid actual API calls during dev
    const mockImageUrl = `https://picsum.photos/512/512?random=${Math.floor(Math.random() * 1000)}`;
    return { output_url: mockImageUrl };
}

async function processHillClimbCsv(csvString, tattooImageBuffer, skinImageBuffer, fluxApiKey, userId) {
    // 1. Upload images to get URIs first
    const tattooUri = await uploadImageToSupabase(tattooImageBuffer, userId, 'hillclimb/tattoos', `tattoo_${uuidv4()}.png`);
    const skinUri = await uploadImageToSupabase(skinImageBuffer, userId, 'hillclimb/skins', `skin_${uuidv4()}.png`);

    return new Promise((resolve, reject) => {
        Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            async complete(results) {
                try {
                    // 2. Validate Headers
                    const headers = results.meta.fields;
                    const missingHeaders = REQUIRED_HEADERS.filter(h => !headers.includes(h));
                    if (missingHeaders.length > 0) {
                        throw new Error(`Missing required CSV headers: ${missingHeaders.join(', ')}`);
                    }

                    // 3. Validate Rows
                    const rows = results.data;
                    if (rows.length !== 3) {
                        throw new Error(`CSV must contain exactly 3 data rows, but found ${rows.length}.`);
                    }

                    const outputUrls = [];
                    // 4. Process rows sequentially
                    for (const row of rows) {
                        const params = {
                            adaptive_scale_enabled: parseInt(row.adaptive_scale_enabled, 10),
                            adaptive_engine_enabled: parseInt(row.adaptive_engine_enabled, 10),
                            global_scale_up: parseFloat(row.global_scale_up),
                            kontext_size_bias: parseFloat(row.kontext_size_bias),
                            fill_size_bias: parseFloat(row.fill_size_bias),
                            model_mask_grow_pct: parseFloat(row.model_mask_grow_pct),
                            model_mask_grow_min: parseInt(row.model_mask_grow_min, 10),
                            model_mask_grow_max: parseInt(row.model_mask_grow_max, 10),
                            bake_tattoo_brightness: parseFloat(row.bake_tattoo_brightness),
                            bake_tattoo_gamma: parseFloat(row.bake_tattoo_gamma),
                            bake_overlay_opacity: parseFloat(row.bake_overlay_opacity),
                            bake_softlight_opacity: parseFloat(row.bake_softlight_opacity),
                            bake_multiply_opacity: parseFloat(row.bake_multiply_opacity),
                            prompt_weight: parseFloat(row.prompt_weight),
                            negative_prompt_weight: parseFloat(row.negative_prompt_weight),
                        };

                        for (const key in params) {
                            if (isNaN(params[key])) {
                                throw new Error(`Invalid numeric value for '${key}' in row with image_id '${row.image_id}'.`);
                            }
                        }

                        const payload = {
                            engine: row.engine,
                            params: params,
                            tattoo_uri: tattooUri,
                            skin_uri: skinUri,
                            mask_uri: "", // Mask is not part of this flow yet
                            prompt: "Preserve the exact silhouette, proportions and interior details of the tattoo. Blend it realistically into the skin with lighting, micro-shadowing and subtle ink diffusion. Do not redraw, restyle or resize. Keep the original tonal balance and colors; avoid pure white ink effects or global darkening.",
                            mode: row.engine_call_mode,
                            engine_endpoint_url: row.engine_endpoint_url, // Pass endpoint for the API call
                        };

                        const response = await callFluxApi(payload, fluxApiKey);
                        outputUrls.push({
                            image_id: row.image_id,
                            url: response.output_url,
                            params: params,
                        });
                    }

                    resolve({
                        images: outputUrls,
                        engine_switch_reason: rows[0].engine_switch_reason,
                        engine_call_mode: rows[0].engine_call_mode,
                    });

                } catch (error) {
                    reject(error);
                }
            },
            error(err) {
                reject(err);
            }
        });
    });
}

function updateCsvWithFeedback(csvString, pickOfTheLitter, iterationFeedback) {
    return new Promise((resolve, reject) => {
        Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            complete(results) {
                try {
                    const rows = results.data;
                    // Update all rows with the same feedback and pick
                    const updatedRows = rows.map(row => ({
                        ...row,
                        pick_of_the_litter: pickOfTheLitter,
                        iteration_feedback: iterationFeedback,
                    }));

                    // Convert back to CSV string, including headers
                    const updatedCsvString = Papa.unparse(updatedRows, {
                        header: true,
                    });

                    resolve(updatedCsvString);

                } catch (error) {
                    reject(new Error(`Failed to update CSV: ${error.message}`));
                }
            },
            error(err) {
                reject(new Error(`Failed to parse CSV for updating: ${err.message}`));
            }
        });
    });
}

export default { processHillClimbCsv, updateCsvWithFeedback };