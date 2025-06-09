// Improved generateMultipleVariations function for server.js

async function generateMultipleVariations(prompt, imageBase64, maskBase64, apiKey) {
    console.log('Submitting to BFL API...');
    
    // Validate base64 inputs
    if (!isValidBase64(imageBase64) || !isValidBase64(maskBase64)) {
        throw new Error('Invalid base64 data');
    }
    
    try {
        const response = await axios.post(
            'https://api.bfl.ai/v1/flux-pro-1.0-fill',
            {
                prompt: prompt,
                image: imageBase64,
                mask: maskBase64,
                seed: Math.floor(Math.random() * 1000000),
                output_format: 'jpeg',
                safety_tolerance: 2,
                guidance_scale: 20,  // Reduced from 30 for more natural results
                num_inference_steps: 50
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-key': apiKey
                },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );
        
        console.log('BFL Response:', response.data);
        const taskId = response.data.id;
        
        // Poll for result
        let attempts = 0;
        while (attempts < 60) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const result = await axios.get(
                `https://api.bfl.ai/v1/get_result?id=${taskId}`,
                { 
                    headers: { 'x-key': apiKey },
                    timeout: 10000
                }
            );
            
            if (result.data.status === 'Ready') {
                const imageUrl = result.data.result.sample;
                console.log('Flux Fill returned:', imageUrl);
                return [imageUrl];
            }
            
            if (result.data.status === 'Error') {
                console.error('BFL Error:', result.data);
                throw new Error('Image generation failed: ' + JSON.stringify(result.data));
            }
            
            console.log(`Polling attempt ${attempts}: ${result.data.status}`);
        }
        
        throw new Error('Generation timeout');
        
    } catch (error) {
        console.error('BFL API Error:', error.response?.data || error.message);
        throw error;
    }
}

// Helper function to validate base64
function isValidBase64(str) {
    try {
        return btoa(atob(str)) === str;
    } catch (err) {
        // For Node.js environment
        try {
            return Buffer.from(str, 'base64').toString('base64') === str;
        } catch (e) {
            return false;
        }
    }
}

// In the /api/generate endpoint, improve the prompt construction:

// BUILD BETTER INPAINTING PROMPT
let fullPrompt = "realistic ";

// Add style modifiers
if (styles.length > 0) {
    fullPrompt += `${styles.join(' ')} style `;
}

// Core tattoo description with skin context
fullPrompt += `tattoo of ${prompt}, detailed tattoo artwork on human skin, professional tattoo photography`;

// This helps Flux understand it should blend the tattoo naturally with the skin
console.log('Inpainting prompt:', fullPrompt);
