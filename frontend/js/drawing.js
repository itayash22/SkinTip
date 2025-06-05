// frontend/js/drawing.js

const drawing = {
    canvas: null,
    ctx: null,
    maskCanvas: null,
    maskCtx: null,
    originalImage: null,
    isDrawing: false,
    currentTool: 'brush',
    brushSize: 5,
    currentPath: [],
    paths: [],
    
    init: (imageUrl) => {
        drawing.canvas = document.getElementById('drawingCanvas');
        drawing.ctx = drawing.canvas.getContext('2d');
        
        // Create hidden mask canvas for Flux API
        drawing.maskCanvas = document.createElement('canvas');
        drawing.maskCtx = drawing.maskCanvas.getContext('2d');
        
        // Reset paths
        drawing.paths = [];
        drawing.currentPath = [];
        
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
            drawing.ctx.drawImage(img, 0, 0, drawing.canvas.width, drawing.canvas.height);
            
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
            STATE.currentMask = drawing.maskCanvas.toDataURL('image/png');
            console.log('Mask saved for Flux API');
            alert('Area selection saved! Ready for tattoo design (Demo mode)');
        });
    },
    
    setTool: (tool) => {
        drawing.currentTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`${tool}Tool`)?.classList.add('active');
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
        
        // Draw current path
        drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
        drawing.ctx.lineWidth = 2;
        drawing.ctx.setLineDash([5, 5]);
        drawing.ctx.beginPath();
        drawing.ctx.moveTo(drawing.currentPath[0].x, drawing.currentPath[0].y);
        for (let i = 1; i < drawing.currentPath.length; i++) {
            drawing.ctx.lineTo(drawing.currentPath[i].x, drawing.currentPath[i].y);
        }
        drawing.ctx.stroke();
        drawing.ctx.setLineDash([]);
    },
    
    stopDrawing: () => {
        if (!drawing.isDrawing) return;
        drawing.isDrawing = false;
        
        // Check if path is closed (last point near first point)
        if (drawing.currentPath.length > 3) {
            const first = drawing.currentPath[0];
            const last = drawing.currentPath[drawing.currentPath.length - 1];
            const distance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
            
            if (distance < 30) { // If closed
                if (drawing.currentTool === 'brush') {
                    drawing.paths.push(drawing.currentPath);
                } else {
                    // For eraser, remove the area
                    drawing.paths = drawing.paths.filter(path => {
                        // Check if click is inside any path
                        const testPoint = drawing.currentPath[0];
                        return !drawing.isPointInPath(testPoint, path);
                    });
                }
                drawing.redrawCanvas();
                drawing.updateMask();
            }
        }
        
        drawing.currentPath = [];
    },
    
    isPointInPath: (point, path) => {
        // Ray casting algorithm to check if point is inside polygon
        let inside = false;
        for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
            const xi = path[i].x, yi = path[i].y;
            const xj = path[j].x, yj = path[j].y;
            
            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },
    
    redrawCanvas: () => {
        // Clear and redraw image
        drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        drawing.ctx.drawImage(drawing.originalImage, 0, 0, drawing.canvas.width, drawing.canvas.height);
        
        // Draw all saved paths
        drawing.ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
        drawing.ctx.lineWidth = 2;
        
        drawing.paths.forEach(path => {
            drawing.ctx.beginPath();
            drawing.ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) {
                drawing.ctx.lineTo(path[i].x, path[i].y);
            }
            drawing.ctx.closePath();
            drawing.ctx.fill();
            drawing.ctx.stroke();
        });
    },
    
    updateMask: () => {
        // Clear mask
        drawing.maskCtx.fillStyle = 'black';
        drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
        
        // Draw white areas for tattoo placement
        const scaleX = drawing.maskCanvas.width / drawing.canvas.width;
        const scaleY = drawing.maskCanvas.height / drawing.canvas.height;
        
        drawing.maskCtx.fillStyle = 'white';
        drawing.paths.forEach(path => {
            drawing.maskCtx.beginPath();
            drawing.maskCtx.moveTo(path[0].x * scaleX, path[0].y * scaleY);
            for (let i = 1; i < path.length; i++) {
                drawing.maskCtx.lineTo(path[i].x * scaleX, path[i].y * scaleY);
            }
            drawing.maskCtx.closePath();
            drawing.maskCtx.fill();
        });
    },
    
    clearCanvas: () => {
        drawing.paths = [];
        drawing.currentPath = [];
        drawing.redrawCanvas();
        drawing.updateMask();
    },
    
    getMaskDataURL: () => {
        return drawing.maskCanvas.toDataURL('image/png');
    }
};
