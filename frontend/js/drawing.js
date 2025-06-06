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
            STATE.currentMask = drawing.maskCanvas.toDataURL('image/png');
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
        if (drawing.currentPath.length > 1) {
            drawing.ctx.save();
            drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            drawing.ctx.lineWidth = 1;
            drawing.ctx.setLineDash([3, 3]);
            drawing.ctx.beginPath();
            drawing.ctx.moveTo(drawing.currentPath[0].x, drawing.currentPath[0].y);
            for (let i = 1; i < drawing.currentPath.length; i++) {
                drawing.ctx.lineTo(drawing.currentPath[i].x, drawing.currentPath[i].y);
            }
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
                // Save the selected area (only one allowed)
                drawing.selectedArea = [...drawing.currentPath];
                drawing.updateMask();
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
        
        // Draw selected area if exists
        if (drawing.selectedArea && drawing.selectedArea.length > 0) {
            drawing.ctx.save();
            drawing.ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
            drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            drawing.ctx.lineWidth = 1;
            
            drawing.ctx.beginPath();
            drawing.ctx.moveTo(drawing.selectedArea[0].x, drawing.selectedArea[0].y);
            for (let i = 1; i < drawing.selectedArea.length; i++) {
                drawing.ctx.lineTo(drawing.selectedArea[i].x, drawing.selectedArea[i].y);
            }
            drawing.ctx.closePath();
            drawing.ctx.fill();
            drawing.ctx.stroke();
            drawing.ctx.restore();
        }
    },
    
    updateMask: () => {
        // Clear mask to black
        drawing.maskCtx.fillStyle = 'black';
        drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
        
        // Draw white area for tattoo placement
        if (drawing.selectedArea && drawing.selectedArea.length > 0) {
            const scaleX = drawing.maskCanvas.width / drawing.canvas.width;
            const scaleY = drawing.maskCanvas.height / drawing.canvas.height;
            
            drawing.maskCtx.fillStyle = 'white';
            drawing.maskCtx.beginPath();
            drawing.maskCtx.moveTo(drawing.selectedArea[0].x * scaleX, drawing.selectedArea[0].y * scaleY);
            for (let i = 1; i < drawing.selectedArea.length; i++) {
                drawing.maskCtx.lineTo(drawing.selectedArea[i].x * scaleX, drawing.selectedArea[i].y * scaleY);
            }
            drawing.maskCtx.closePath();
            drawing.maskCtx.fill();
        }
    },
    
    clearCanvas: () => {
        drawing.selectedArea = null;
        drawing.currentPath = [];
        drawing.redrawCanvas();
        drawing.updateMask();
    },
    
    getMaskDataURL: () => {
        return drawing.maskCanvas.toDataURL('image/png');
    }
};
