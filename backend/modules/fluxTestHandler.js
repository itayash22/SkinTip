import Papa from 'papaparse';
import fetch from 'node-fetch';

const REQUIRED_HEADERS = [
    'image_id', 'engine', 'adaptive_scale_enabled', 'adaptive_engine_enabled', 'global_scale_up',
    'kontext_size_bias', 'fill_size_bias', 'model_mask_grow_pct', 'model_mask_grow_min', 'model_mask_grow_max',
    'bake_tattoo_brightness', 'bake_tattoo_gamma', 'bake_overlay_opacity', 'bake_softlight_opacity',
    'bake_multiply_opacity', 'prompt_weight', 'negative_prompt_weight', 'pick_of_the_litter',
    'iteration_feedback', 'engine_call_mode', 'engine_endpoint_url', 'engine_switch_reason'
];

// Main function to process the CSV and run FLUX tasks
async function runFluxTest(csvData, fileName) {
    const parsedCsv = Papa.parse(csvData, { header: true });

    if (parsedCsv.errors.length > 0) {
        throw new Error(`CSV Parsing Error: ${parsedCsv.errors[0].message}`);
    }

    validateCsvHeaders(parsedCsv.meta.fields);

    const results = [];
    // Process rows sequentially as required
    for (const row of parsedCsv.data) {
        if (row.image_id) { // Basic check to skip empty rows
            const result = await executeFluxTask(row);
            results.push(result);
        }
    }

    return {
        results,
        engineCallMode: parsedCsv.data[0]?.engine_call_mode || 'default',
        engineSwitchReason: parsedCsv.data[0]?.engine_switch_reason || 'N/A',
    };
}

// Function to execute a single FLUX API call
async function executeFluxTask(row) {
    const fluxApiKey = process.env.FLUX_API_KEY;
    if (!fluxApiKey) {
        throw new Error('FLUX_API_KEY environment variable not set.');
    }

    const apiUrl = row.engine_endpoint_url;
    if (!apiUrl || !apiUrl.startsWith('https')) {
        throw new Error(`Invalid or missing engine_endpoint_url: ${apiUrl}`);
    }

    const params = {
        adaptive_scale_enabled: !!parseInt(row.adaptive_scale_enabled),
        adaptive_engine_enabled: !!parseInt(row.adaptive_engine_enabled),
        global_scale_up: parseFloat(row.global_scale_up),
        kontext_size_bias: parseFloat(row.kontext_size_bias),
        fill_size_bias: parseFloat(row.fill_size_bias),
        model_mask_grow_pct: parseFloat(row.model_mask_grow_pct),
        model_mask_grow_min: parseInt(row.model_mask_grow_min),
        model_mask_grow_max: parseInt(row.model_mask_grow_max),
        bake_tattoo_brightness: parseFloat(row.bake_tattoo_brightness),
        bake_tattoo_gamma: parseFloat(row.bake_tattoo_gamma),
        bake_overlay_opacity: parseFloat(row.bake_overlay_opacity),
        bake_softlight_opacity: parseFloat(row.bake_softlight_opacity),
        bake_multiply_opacity: parseFloat(row.bake_multiply_opacity),
        prompt_weight: parseFloat(row.prompt_weight),
        negative_prompt_weight: parseFloat(row.negative_prompt_weight),
    };

    // This is a placeholder for the actual prompt/image data needed by FLUX
    // In a real scenario, this would come from the user or another source.
    const requestBody = {
        ...params,
        prompt: "A tattoo of a dragon", // Example prompt
    };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${fluxApiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FLUX API Error (${response.status}): ${errorText}`);
    }

    // Assuming the API returns a JSON with an output_url
    const responseData = await response.json();

    return {
        image_id: row.image_id,
        output_url: responseData.output_url, // Adjust based on actual API response
        params: params,
    };
}

// Function to update the CSV with user feedback
function updateCsvWithFeedback(csvData, pickOfTheLitter, iterationFeedback) {
    const parsedCsv = Papa.parse(csvData, { header: true, skipEmptyLines: true });

    const updatedData = parsedCsv.data.map(row => ({
        ...row,
        pick_of_the_litter: pickOfTheLitter,
        iteration_feedback: iterationFeedback,
    }));

    return Papa.unparse(updatedData, { header: true });
}


// Helper to validate CSV headers
function validateCsvHeaders(actualHeaders) {
    const missingHeaders = REQUIRED_HEADERS.filter(h => !actualHeaders.includes(h));
    if (missingHeaders.length > 0) {
        throw new Error(`CSV is missing required headers: ${missingHeaders.join(', ')}`);
    }
}

export { runFluxTest, updateCsvWithFeedback };