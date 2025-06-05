// frontend/js/drawing.js

const drawing = {
    canvas: null,
    ctx: null,
    maskCanvas: null,
    maskCtx: null,
    originalImage: null,
    isDrawing: false,
    currentTool: 'brush',
    brushSize: 20,
    
    init: (imageUrl) => {
        drawing.canvas = document.getElementById('drawingCanvas');
        drawing.ctx = drawing.canvas.getContext('2d');
        
        // Create hidden mask canvas for Flux API
        drawing.maskCanvas = document.createElement('canvas');
        drawing.maskCtx = drawing.maskCanvas.getContext('2d');
        
        // Load image
        const img = new Image();
        img.onload = () => {
            drawing.originalImage = img;
            
            // Set canvas sizes (max 600px wide for display)
            const maxWidth = 600;
            const scale = Math.min(1, maxWidth / img.width);
            drawing.canvas.width = img.width * scale;
            drawing.canvas.height = img.height * scale;
            
            // Set mask canvas to original image size
            drawing.maskCanvas.width = img.width;
            drawing.maskCanvas.height = img.height;
            
            // Draw image on display canvas
            drawing.ctx.drawImage(img, 0, 0, drawing.canvas.width, drawing.canvas.height);
            
            // Initialize mask canvas with black background
            drawing.maskCtx.fillStyle = 'black';
            drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
            
            // Show drawing section
            document.getElementById('drawingSection').style.display = 'block';
            document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });
        };
        img.src = imageUrl;
        
        // Setup event listeners
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
        
        drawing.canvas.addEventListener('touchend', drawing.stopDrawing);
        
        // Tool buttons
        document.getElementById('brushTool')?.addEventListener('click', () => {
            drawing.setTool('brush');
        });
        
        document.getElementById('eraserTool')?.addEventListener('click', () => {
            drawing.setTool('eraser');
        });
        
        // Brush size
        document.getElementById('brushSize')?.addEventListener('input', (e) => {
            drawing.brushSize = parseInt(e.target.value);
        });
        
        // Clear canvas
        document.getElementById('clearCanvas')?.addEventListener('click', () => {
            drawing.clearCanvas();
        });
        
        // Continue button
        document.getElementById('continueBtn')?.addEventListener('click', () => {
            // Save the mask data for Flux API
            STATE.currentMask = drawing.maskCanvas.toDataURL('image/png');
            console.log('Mask saved for Flux API');
            alert('Drawing saved! Mask is ready for Flux API (Demo mode)');
        });
    },
    
    setTool: (tool) => {
        drawing.currentTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`${tool}Tool`)?.classList.add('active');
    },
    
    drawAt: (x, y) => {
        // Calculate position on mask canvas
        const scaleX = drawing.maskCanvas.width / drawing.canvas.width;
        const scaleY = drawing.maskCanvas.height / drawing.canvas.height;
        const maskX = x * scaleX;
        const maskY = y * scaleY;
        const maskBrushSize = drawing.brushSize * scaleX;
        
        // Draw on display canvas (visual feedback)
        drawing.ctx.globalCompositeOperation = drawing.currentTool === 'brush' ? 'source-over' : 'destination-out';
        drawing.ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
        drawing.ctx.beginPath();
        drawing.ctx.arc(x, y, drawing.brushSize / 2, 0, Math.PI * 2);
        drawing.ctx.fill();
        
        // Draw on mask canvas (white for tattoo area, black for no tattoo)
        if (drawing.currentTool === 'brush') {
            drawing.maskCtx.globalCompositeOperation = 'source-over';
            drawing.maskCtx.fillStyle = 'white';
        } else {
            drawing.maskCtx.globalCompositeOperation = 'source-over';
            drawing.maskCtx.fillStyle = 'black';
        }
        drawing.maskCtx.beginPath();
        drawing.maskCtx.arc(maskX, maskY, maskBrushSize / 2, 0, Math.PI * 2);
        drawing.maskCtx.fill();
    },
    
    startDrawing: (e) => {
        drawing.isDrawing = true;
        const rect = drawing.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        drawing.drawAt(x, y);
    },
    
    draw: (e) => {
        if (!drawing.isDrawing) return;
        const rect = drawing.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        drawing.drawAt(x, y);
    },
    
    stopDrawing: () => {
        drawing.isDrawing = false;
    },
    
    clearCanvas: () => {
        // Clear display canvas and redraw image
        drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        drawing.ctx.drawImage(drawing.originalImage, 0, 0, drawing.canvas.width, drawing.canvas.height);
        
        // Reset mask canvas to black
        drawing.maskCtx.fillStyle = 'black';
        drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
    },
    
    getMaskDataURL: () => {
        return drawing.maskCanvas.toDataURL('image/png');
    }
};
