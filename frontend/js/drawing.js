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

// Add this enhanced debugging to your drawing.js to verify mask format

// In the continue button event listener, replace the existing one with this:
document.getElementById('continueBtn')?.addEventListener('click', async () => {
    if (!drawing.selectedArea) {
        alert('Please draw an area for your tattoo first!');
        return;
    }
    
    // === ENHANCED DEBUG: Comprehensive mask verification ===
    console.log('=== COMPREHENSIVE MASK DEBUG ===');
    
    // 1. Check dimensions match
    console.log('Original image dimensions:', drawing.originalImage.width, 'x', drawing.originalImage.height);
    console.log('Mask canvas dimensions:', drawing.maskCanvas.width, 'x', drawing.maskCanvas.height);
    console.log('Display canvas dimensions:', drawing.canvas.width, 'x', drawing.canvas.height);
    console.log('Display scale factor:', drawing.displayScale);
    
    // 2. Analyze mask composition
    const maskData = drawing.maskCtx.getImageData(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
    let blackPixels = 0;
    let whitePixels = 0;
    let otherPixels = 0;
    let transparentPixels = 0;
    
    for(let i = 0; i < maskData.data.length; i += 4) {
        const r = maskData.data[i];
        const g = maskData.data[i+1];
        const b = maskData.data[i+2];
        const a = maskData.data[i+3];
        
        if (a === 0) {
            transparentPixels++;
        } else if (r === 0 && g === 0 && b === 0 && a === 255) {
            blackPixels++;
        } else if (r === 255 && g === 255 && b === 255 && a === 255) {
            whitePixels++;
        } else {
            otherPixels++;
            // Log first few non-standard pixels
            if (otherPixels <= 5) {
                console.log(`Non-standard pixel at ${i/4}: rgba(${r},${g},${b},${a})`);
            }
        }
    }
    
    const totalPixels = maskData.data.length / 4;
    console.log('\nMask composition:');
    console.log('- Black pixels (tattoo area):', blackPixels, `(${(blackPixels/totalPixels*100).toFixed(2)}%)`);
    console.log('- White pixels (preserve):', whitePixels, `(${(whitePixels/totalPixels*100).toFixed(2)}%)`);
    console.log('- Transparent pixels:', transparentPixels, `(${(transparentPixels/totalPixels*100).toFixed(2)}%)`);
    console.log('- Other pixels:', otherPixels, `(${(otherPixels/totalPixels*100).toFixed(2)}%)`);
    
    // 3. Create visual debug preview
    const debugContainer = document.createElement('div');
    debugContainer.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border: 2px solid #333;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        max-width: 90%;
        max-height: 90%;
        overflow: auto;
    `;
    
    // Create canvases for visualization
    const previewSize = 300;
    
    // Original image preview
    const origCanvas = document.createElement('canvas');
    origCanvas.width = previewSize;
    origCanvas.height = previewSize * (drawing.originalImage.height / drawing.originalImage.width);
    const origCtx = origCanvas.getContext('2d');
    origCtx.drawImage(drawing.originalImage, 0, 0, origCanvas.width, origCanvas.height);
    
    // Current mask preview
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = previewSize;
    maskCanvas.height = previewSize * (drawing.maskCanvas.height / drawing.maskCanvas.width);
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(drawing.maskCanvas, 0, 0, maskCanvas.width, maskCanvas.height);
    
    // Inverted mask preview (for testing)
    const invertedCanvas = document.createElement('canvas');
    invertedCanvas.width = drawing.maskCanvas.width;
    invertedCanvas.height = drawing.maskCanvas.height;
    const invertedCtx = invertedCanvas.getContext('2d');
    invertedCtx.drawImage(drawing.maskCanvas, 0, 0);
    
    // Invert the mask
    const invertData = invertedCtx.getImageData(0, 0, invertedCanvas.width, invertedCanvas.height);
    for (let i = 0; i < invertData.data.length; i += 4) {
        // Invert RGB values, keep alpha
        invertData.data[i] = 255 - invertData.data[i];
        invertData.data[i+1] = 255 - invertData.data[i+1];
        invertData.data[i+2] = 255 - invertData.data[i+2];
    }
    invertedCtx.putImageData(invertData, 0, 0);
    
    // Create small preview of inverted
    const invertedPreview = document.createElement('canvas');
    invertedPreview.width = previewSize;
    invertedPreview.height = previewSize * (invertedCanvas.height / invertedCanvas.width);
    const invertedPreviewCtx = invertedPreview.getContext('2d');
    invertedPreviewCtx.drawImage(invertedCanvas, 0, 0, invertedPreview.width, invertedPreview.height);
    
    debugContainer.innerHTML = `
        <h3>Mask Verification Debug</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 20px 0;">
            <div>
                <h4>Original Image</h4>
                ${origCanvas.outerHTML}
                <p>Size: ${drawing.originalImage.width}x${drawing.originalImage.height}</p>
            </div>
            <div>
                <h4>Current Mask</h4>
                ${maskCanvas.outerHTML}
                <p>Black = Tattoo area<br>White = Preserve</p>
                <p>Black: ${(blackPixels/totalPixels*100).toFixed(1)}%</p>
            </div>
            <div>
                <h4>Inverted Mask (Test)</h4>
                ${invertedPreview.outerHTML}
                <p>White = Tattoo area<br>Black = Preserve</p>
            </div>
        </div>
        <div style="margin: 20px 0;">
            <label>
                <input type="checkbox" id="useInvertedMask"> 
                Use inverted mask (some APIs require this)
            </label>
        </div>
        <div style="display: flex; gap: 10px; justify-content: center;">
            <button onclick="
                const useInverted = document.getElementById('useInvertedMask').checked;
                if (useInverted) {
                    // Store the inverted mask
                    STATE.currentMask = '${invertedCanvas.toDataURL('image/png')}';
                    console.log('Using INVERTED mask for API');
                } else {
                    STATE.currentMask = drawing.maskCanvas.toDataURL('image/png');
                    console.log('Using STANDARD mask for API');
                }
                drawing.selectedArea = STATE.currentMask;
                this.parentElement.parentElement.remove();
                document.getElementById('designSection').style.display = 'block';
                document.getElementById('designSection').scrollIntoView({ behavior: 'smooth' });
            ">Continue with Mask</button>
            <button onclick="this.parentElement.parentElement.remove()">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(debugContainer);
    
    // 4. Test mask data URL format
    const maskDataUrl = drawing.maskCanvas.toDataURL('image/png');
    console.log('\nMask data URL:');
    console.log('- Starts with "data:image/png;base64,":', maskDataUrl.startsWith('data:image/png;base64,'));
    console.log('- Base64 length:', maskDataUrl.split(',')[1]?.length || 0);
    console.log('- First 100 chars:', maskDataUrl.substring(0, 100));
});

// Also add this helper function to test mask inversion if needed
drawing.createInvertedMask = () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = drawing.maskCanvas.width;
    tempCanvas.height = drawing.maskCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw inverted mask (swap black and white)
    tempCtx.fillStyle = 'black';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
        tempCtx.fillStyle = 'white';
        tempCtx.beginPath();
        
        const scaledCoords = drawing.currentPathCoords.map(coord => ({
            x: coord.x / drawing.displayScale,
            y: coord.y / drawing.displayScale
        }));
        
        tempCtx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
        
        for (let i = 1; i < scaledCoords.length; i++) {
            tempCtx.lineTo(scaledCoords[i].x, scaledCoords[i].y);
        }
        
        tempCtx.closePath();
        tempCtx.fill();
    }
    
    return tempCanvas.toDataURL('image/png');
};

// Add this to your drawing.js to debug mask issues

// In the continue button event listener, add this debugging code:
document.getElementById('continueBtn')?.addEventListener('click', () => {
    if (!drawing.selectedArea) {
        alert('Please draw an area for your tattoo first!');
        return;
    }
    
    // Save the mask
    STATE.currentMask = drawing.maskCanvas.toDataURL('image/png');
    drawing.selectedArea = STATE.currentMask;
    
    // === DEBUG: Visualize the mask ===
    console.log('=== MASK DEBUG INFO ===');
    
    // 1. Check mask dimensions
    console.log('Mask dimensions:', drawing.maskCanvas.width, 'x', drawing.maskCanvas.height);
    console.log('Original image dimensions:', drawing.originalImage.width, 'x', drawing.originalImage.height);
    
    // 2. Analyze mask pixels
    const maskData = drawing.maskCtx.getImageData(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
    let blackPixels = 0;
    let whitePixels = 0;
    let otherPixels = 0;
    
    for(let i = 0; i < maskData.data.length; i += 4) {
        const r = maskData.data[i];
        const g = maskData.data[i+1];
        const b = maskData.data[i+2];
        const a = maskData.data[i+3];
        
        if (r === 0 && g === 0 && b === 0 && a === 255) {
            blackPixels++;
        } else if (r === 255 && g === 255 && b === 255 && a === 255) {
            whitePixels++;
        } else {
            otherPixels++;
        }
    }
    
    const totalPixels = maskData.data.length / 4;
    console.log('Black pixels (tattoo area):', blackPixels, `(${(blackPixels/totalPixels*100).toFixed(2)}%)`);
    console.log('White pixels (preserve):', whitePixels, `(${(whitePixels/totalPixels*100).toFixed(2)}%)`);
    console.log('Other pixels:', otherPixels, `(${(otherPixels/totalPixels*100).toFixed(2)}%)`);
    
    // 3. Create a preview of the mask
    const debugCanvas = document.createElement('canvas');
    debugCanvas.width = 200;
    debugCanvas.height = 200 * (drawing.maskCanvas.height / drawing.maskCanvas.width);
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.drawImage(drawing.maskCanvas, 0, 0, debugCanvas.width, debugCanvas.height);
    
    // Create a popup to show the mask
    const debugDiv = document.createElement('div');
    debugDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border: 2px solid #333;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    debugDiv.innerHTML = `
        <h3>Mask Debug Preview</h3>
        <p>Black = Tattoo area | White = Preserve</p>
        <div style="border: 1px solid #ccc; margin: 10px 0;">
            ${debugCanvas.outerHTML}
        </div>
        <p>Black pixels: ${(blackPixels/totalPixels*100).toFixed(2)}%</p>
        <p>White pixels: ${(whitePixels/totalPixels*100).toFixed(2)}%</p>
        <button onclick="this.parentElement.remove()">Close</button>
    `;
    document.body.appendChild(debugDiv);
    
    // 4. Log first few bytes of base64 to verify format
    console.log('Mask base64 preview:', STATE.currentMask.substring(0, 50) + '...');
    console.log('Starts with data:image/png:', STATE.currentMask.startsWith('data:image/png'));
    
    // Continue with normal flow
    document.getElementById('designSection').style.display = 'block';
    document.getElementById('designSection').scrollIntoView({ behavior: 'smooth' });
});

// Also add this alternative mask generation to test if inversion helps:
drawing.updateMaskInverted = () => {
    // Create mask with BLACK background (preserve)
    drawing.maskCtx.fillStyle = 'black';
    drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
    
    // Draw WHITE area where tattoo should go (inpaint)
    if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
        drawing.maskCtx.fillStyle = 'white';
        drawing.maskCtx.beginPath();
        
        // Scale coordinates from display to original size
        const scaledCoords = drawing.currentPathCoords.map(coord => ({
            x: coord.x / drawing.displayScale,
            y: coord.y / drawing.displayScale
        }));
        
        drawing.maskCtx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
        
        for (let i = 1; i < scaledCoords.length; i++) {
            drawing.maskCtx.lineTo(scaledCoords[i].x, scaledCoords[i].y);
        }
        
        drawing.maskCtx.closePath();
        drawing.maskCtx.fill();
    }
    
    console.log('Created INVERTED mask - white area is where tattoo will be placed');
};
