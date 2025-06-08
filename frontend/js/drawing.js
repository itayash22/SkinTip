// frontend/js/drawing.js

const drawing = {
    canvas: null,
    ctx: null,
    maskCanvas: null,
    maskCtx: null,
    originalImage: null,
    isDrawing: false,
    currentPath: [],
    selectedArea: null,
    
    init: (imageUrl) => {
        drawing.canvas = document.getElementById('drawingCanvas');
        drawing.ctx = drawing.canvas.getContext('2d');
        
        // Create hidden mask canvas for Flux API
        drawing.maskCanvas = document.createElement('canvas');
        drawing.maskCtx = drawing.maskCanvas.getContext('2d');
        // In updateMask function
console.log('Mask canvas data URL preview:', drawing.maskCanvas.toDataURL().substring(0, 100));

// Check if mask is actually white where drawn
const imageData = drawing.maskCtx.getImageData(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
let whitePixels = 0;
for(let i = 0; i < imageData.data.length; i += 4) {
    if(imageData.data[i] === 255) whitePixels++;
}
console.log('White pixels in mask:', whitePixels);
        
        // Reset
        drawing.currentPath = [];
        drawing.selectedArea = null;
        
        // Load image
        const img = new Image();
        img.onload = () => {
            drawing.originalImage = img;
            
            // Set canvas sizes
            const maxWidth = 600;
            const scale = Math.min(1, maxWidth / img.width);
            drawing.canvas.width = img.width * scale;
            drawing.canvas.height = img.height * scale;
            
            // Set mask canvas to original image size
            drawing.maskCanvas.width = img.width;
            drawing.maskCanvas.height = img.height;
            
            // Draw image on display canvas
            drawing.redrawCanvas();
            
            // Initialize mask canvas with black background
            drawing.maskCtx.fillStyle = 'black';
            drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
            
            // Show drawing section
            document.getElementById('drawingSection').style.display = 'block';
            document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });
        };
        img.src = imageUrl;
        // Hide continue button initially
        const continueBtn = document.getElementById('continueBtn');
        if (continueBtn) continueBtn.style.display = 'none';
        drawing.setupEventListeners();
    },
    
    setupEventListeners: () => {
        // Mouse events
        drawing.canvas.addEventListener('mousedown', drawing.startDrawing);
        drawing.canvas.addEventListener('mousemove', drawing.draw);
        drawing.canvas.addEventListener('mouseup', drawing.stopDrawing);
        drawing.canvas.addEventListener('mouseleave', drawing.stopDrawing);
        
        // Touch events
        drawing.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = drawing.canvas.getBoundingClientRect();
            drawing.startDrawing({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        });
        
        drawing.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            drawing.draw({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        });
        
        drawing.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            drawing.stopDrawing();
        });
        
        // Clear canvas
        document.getElementById('clearCanvas')?.addEventListener('click', () => {
            drawing.clearCanvas();
        });
        
        // Continue button
document.getElementById('continueBtn')?.addEventListener('click', () => {
    if (!drawing.selectedArea) {
        alert('Please draw an area for your tattoo first!');
        return;
    }
    
    // Save BOTH the mask and selectedArea
    STATE.currentMask = drawing.maskCanvas.toDataURL('image/png');
    drawing.selectedArea = STATE.currentMask; // ADD THIS LINE
    console.log('Mask saved for Flux API');
    
    // Show design section
    document.getElementById('designSection').style.display = 'block';
    document.getElementById('designSection').scrollIntoView({ behavior: 'smooth' });
});
    },
    
    startDrawing: (e) => {
        drawing.isDrawing = true;
        drawing.currentPath = [];
        
        const rect = drawing.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        drawing.currentPath.push({x, y});
    },
    
    draw: (e) => {
        if (!drawing.isDrawing) return;
        
        const rect = drawing.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Add point to path
        drawing.currentPath.push({x, y});
        
        // Redraw everything
        drawing.redrawCanvas();
        
        // Draw current path (thin dotted line)
        // Draw current path (luminescent line)
if (drawing.currentPath.length > 1) {
    drawing.ctx.save();
    
    // Create glow effect with multiple strokes
    // Outer glow
    drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
    drawing.ctx.lineWidth = 12;
    drawing.ctx.setLineDash([]);
    drawing.ctx.shadowColor = '#6366f1';
    drawing.ctx.shadowBlur = 20;
    drawing.ctx.beginPath();
    drawing.ctx.moveTo(drawing.currentPath[0].x, drawing.currentPath[0].y);
    for (let i = 1; i < drawing.currentPath.length; i++) {
        drawing.ctx.lineTo(drawing.currentPath[i].x, drawing.currentPath[i].y);
    }
    drawing.ctx.stroke();
    
    // Middle glow
    drawing.ctx.strokeStyle = 'rgba(129, 140, 248, 0.4)';
    drawing.ctx.lineWidth = 6;
    drawing.ctx.shadowBlur = 10;
    drawing.ctx.stroke();
    
    // Inner bright line
    drawing.ctx.strokeStyle = '#e0e7ff';
    drawing.ctx.lineWidth = 2;
    drawing.ctx.shadowBlur = 5;
    drawing.ctx.setLineDash([5, 5]);
    drawing.ctx.stroke();
    
    drawing.ctx.restore();
}
    },
    
    stopDrawing: () => {
    if (!drawing.isDrawing) return;
    drawing.isDrawing = false;
    
    // Check if path is closed (last point near first point)
    if (drawing.currentPath.length > 10) {
        const first = drawing.currentPath[0];
        const last = drawing.currentPath[drawing.currentPath.length - 1];
        const distance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
        
        if (distance < 30) { // If closed
            // Save the path coordinates for drawing
            drawing.currentPathCoords = [...drawing.currentPath];
            drawing.updateMask();
            
            // Save the mask as base64 image for API
            drawing.selectedArea = drawing.maskCanvas.toDataURL('image/png');
            
            // Show continue button
            const continueBtn = document.getElementById('continueBtn');
            if (continueBtn) continueBtn.style.display = 'block';
        } else {
            alert('Please close the shape by drawing near the starting point');
        }
    }
    
    drawing.currentPath = [];
    drawing.redrawCanvas();
},
    redrawCanvas: () => {
    // Always start fresh with the original image
    drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
    drawing.ctx.drawImage(drawing.originalImage, 0, 0, drawing.canvas.width, drawing.canvas.height);
    
    // Draw selected area if exists (using coordinates, not the mask)
    if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
        drawing.ctx.save();
        
        // Luminescent fill
        drawing.ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
        drawing.ctx.strokeStyle = '#818cf8';
        drawing.ctx.lineWidth = 3;
        drawing.ctx.shadowColor = '#6366f1';
        drawing.ctx.shadowBlur = 15;
        
        drawing.ctx.beginPath();
        drawing.ctx.moveTo(drawing.currentPathCoords[0].x, drawing.currentPathCoords[0].y);
        for (let i = 1; i < drawing.currentPathCoords.length; i++) {
            drawing.ctx.lineTo(drawing.currentPathCoords[i].x, drawing.currentPathCoords[i].y);
        }
        drawing.ctx.closePath();
        drawing.ctx.fill();
        drawing.ctx.stroke();
        drawing.ctx.restore();
    }
    
    // Also draw the current path being drawn (if any)
    if (drawing.currentPath && drawing.currentPath.length > 0) {
        drawing.ctx.save();
        
        // Current drawing style (slightly different to show it's in progress)
        drawing.ctx.strokeStyle = '#a5b4fc';
        drawing.ctx.lineWidth = 2;
        drawing.ctx.setLineDash([5, 5]);
        
        drawing.ctx.beginPath();
        drawing.ctx.moveTo(drawing.currentPath[0].x, drawing.currentPath[0].y);
        for (let i = 1; i < drawing.currentPath.length; i++) {
            drawing.ctx.lineTo(drawing.currentPath[i].x, drawing.currentPath[i].y);
        }
        drawing.ctx.stroke();
        drawing.ctx.restore();
    }
},
    
    updateMask: () => {
    // Create mask with WHITE background (preserve)
    drawing.maskCtx.fillStyle = 'white';
    drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
    
    // Draw BLACK area where tattoo should go (inpaint)
    if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
        drawing.maskCtx.fillStyle = 'black';
        drawing.maskCtx.beginPath();
        drawing.maskCtx.moveTo(drawing.currentPathCoords[0].x, drawing.currentPathCoords[0].y);
        
        for (let i = 1; i < drawing.currentPathCoords.length; i++) {
            drawing.maskCtx.lineTo(drawing.currentPathCoords[i].x, drawing.currentPathCoords[i].y);
        }
        
        drawing.maskCtx.closePath();
        drawing.maskCtx.fill();
    }
    
    // Debug log
    console.log('Mask updated - black area is where tattoo will be placed');
},
    
    clearCanvas: () => {
    drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
    drawing.maskCtx.clearRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
    drawing.currentPath = [];
    drawing.selectedArea = null;
    drawing.currentPathCoords = null; // Add this
    drawing.redrawCanvas();
    
    const continueBtn = document.getElementById('continueBtn');
    if (continueBtn) continueBtn.style.display = 'none';
},
    
    getMaskDataURL: () => {
        return drawing.maskCanvas.toDataURL('image/png');
    }
};
