// frontend/js/drawing.js
// Tattoo positioning overlay - allows dragging, rotating, and resizing tattoo on skin photo

const drawing = {
    canvas: null,
    ctx: null,
    maskCanvas: null,
    maskCtx: null,
    
    // Images
    skinImage: null,
    tattooImage: null,
    processedTattoo: null, // Tattoo with background removed
    
    // Tattoo transform state
    tattooX: 0,
    tattooY: 0,
    tattooScale: 1,
    tattooRotation: 0, // degrees
    
    // Drag state
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    tattooStartX: 0,
    tattooStartY: 0,
    
    // Pan mode (for moving skin view)
    panMode: false,
    panOffsetX: 0,
    panOffsetY: 0,
    panStartX: 0,
    panStartY: 0,
    panStartOffsetX: 0,
    panStartOffsetY: 0,
    isPanning: false,
    
    // Display scaling
    displayScale: 1,

    // Remove black/dark background from tattoo image
    removeBlackBackground: (img) => {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        
        // Draw original image
        tempCtx.drawImage(img, 0, 0);
        
        // Get image data
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        
        // Threshold for what's considered "black/dark" (0-255)
        const threshold = 50;
        
        // Process each pixel
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Check if pixel is dark (near black)
            if (r < threshold && g < threshold && b < threshold) {
                // Make transparent
                data[i + 3] = 0;
            } else {
                // For lighter backgrounds, check if it's close to white
                if (r > 200 && g > 200 && b > 200) {
                    // Also make white/light backgrounds transparent
                    data[i + 3] = 0;
                }
            }
        }
        
        // Put processed data back
        tempCtx.putImageData(imageData, 0, 0);
        
        // Create new image from canvas
        const processedImg = new Image();
        processedImg.src = tempCanvas.toDataURL('image/png');
        
        console.log('Tattoo background removed (black/white pixels made transparent)');
        return tempCanvas; // Return canvas for immediate drawing
    },

    init: (skinImageUrl, tattooImageUrl) => {
        console.log('Drawing init called with:', { skinImageUrl: skinImageUrl?.substring(0, 50), tattooImageUrl: tattooImageUrl?.substring(0, 50) });
        
        drawing.canvas = document.getElementById('drawingCanvas');
        if (!drawing.canvas) {
            console.error('drawingCanvas element not found');
            return;
        }
        drawing.ctx = drawing.canvas.getContext('2d');

        // Create hidden mask canvas
        drawing.maskCanvas = document.createElement('canvas');
        drawing.maskCtx = drawing.maskCanvas.getContext('2d');

        // Reset state
        drawing.tattooX = 0;
        drawing.tattooY = 0;
        drawing.tattooScale = 1;
        drawing.tattooRotation = 0;
        drawing.panOffsetX = 0;
        drawing.panOffsetY = 0;
        drawing.panMode = false;

        // Load both images
        let imagesLoaded = 0;
        const checkBothLoaded = () => {
            imagesLoaded++;
            if (imagesLoaded === 2) {
                drawing.initializeCanvas();
            }
        };

        // Load skin image
        drawing.skinImage = new Image();
        drawing.skinImage.crossOrigin = 'anonymous';
        drawing.skinImage.onload = () => {
            console.log('Skin image loaded:', drawing.skinImage.width, 'x', drawing.skinImage.height);
            checkBothLoaded();
        };
        drawing.skinImage.onerror = (e) => {
            console.error('Failed to load skin image:', e);
        };
        drawing.skinImage.src = skinImageUrl;

        // Load tattoo image and remove background
        drawing.tattooImage = new Image();
        drawing.tattooImage.crossOrigin = 'anonymous';
        drawing.tattooImage.onload = () => {
            console.log('Tattoo image loaded:', drawing.tattooImage.width, 'x', drawing.tattooImage.height);
            // Process to remove black/dark background
            drawing.processedTattoo = drawing.removeBlackBackground(drawing.tattooImage);
            checkBothLoaded();
        };
        drawing.tattooImage.onerror = (e) => {
            console.error('Failed to load tattoo image:', e);
        };
        drawing.tattooImage.src = tattooImageUrl;
    },

    initializeCanvas: () => {
        if (!drawing.skinImage || !drawing.tattooImage) {
            console.error('Images not loaded');
            return;
        }

        const container = drawing.canvas.parentElement;
        const containerWidth = container.clientWidth || 600;
        // Use viewport height as max, not container height (which may be 0 initially)
        const maxHeight = Math.min(window.innerHeight * 0.75, 700);

        // Calculate scale to fit skin image while maintaining aspect ratio
        const imgWidth = drawing.skinImage.width;
        const imgHeight = drawing.skinImage.height;
        const aspectRatio = imgWidth / imgHeight;
        
        let canvasWidth, canvasHeight;
        
        // Fit within container width and max height while preserving aspect ratio
        if (containerWidth / aspectRatio <= maxHeight) {
            // Width is the limiting factor
            canvasWidth = Math.min(containerWidth, imgWidth);
            canvasHeight = canvasWidth / aspectRatio;
        } else {
            // Height is the limiting factor
            canvasHeight = Math.min(maxHeight, imgHeight);
            canvasWidth = canvasHeight * aspectRatio;
        }
        
        drawing.displayScale = canvasWidth / imgWidth;

        // Set canvas size (actual pixel dimensions)
        drawing.canvas.width = canvasWidth;
        drawing.canvas.height = canvasHeight;
        
        console.log(`Canvas initialized: ${canvasWidth}x${canvasHeight}, scale: ${drawing.displayScale}`);

        // Set mask canvas to original skin image size
        drawing.maskCanvas.width = drawing.skinImage.width;
        drawing.maskCanvas.height = drawing.skinImage.height;

        // Center tattoo initially
        drawing.tattooX = drawing.skinImage.width / 2;
        drawing.tattooY = drawing.skinImage.height / 2;

        // Initial tattoo scale - make it a reasonable size relative to skin
        const tattooMaxDim = Math.max(drawing.tattooImage.width, drawing.tattooImage.height);
        const skinMinDim = Math.min(drawing.skinImage.width, drawing.skinImage.height);
        drawing.tattooScale = (skinMinDim * 0.3) / tattooMaxDim; // 30% of skin size

        // Draw initial state
        drawing.redrawCanvas();

        // Setup event listeners
        drawing.setupEventListeners();

        // Show continue button
        const continueBtn = document.getElementById('continueBtn');
        if (continueBtn) continueBtn.style.display = 'block';

        // Reset sliders
        const rotationSlider = document.getElementById('rotationSlider');
        const sizeSlider = document.getElementById('sizeSlider');
        const rotationValue = document.getElementById('rotationValue');
        const sizeValue = document.getElementById('sizeValue');
        
        if (rotationSlider) rotationSlider.value = 0;
        if (sizeSlider) sizeSlider.value = 100;
        if (rotationValue) rotationValue.textContent = '0°';
        if (sizeValue) sizeValue.textContent = '100%';

        console.log('Canvas initialized. Tattoo at:', drawing.tattooX, drawing.tattooY, 'Scale:', drawing.tattooScale);
    },

    setupEventListeners: () => {
        // Remove old listeners by cloning
        const newCanvas = drawing.canvas.cloneNode(true);
        drawing.canvas.parentNode.replaceChild(newCanvas, drawing.canvas);
        drawing.canvas = newCanvas;
        drawing.ctx = drawing.canvas.getContext('2d');

        // Mouse events
        drawing.canvas.addEventListener('mousedown', drawing.handleMouseDown);
        drawing.canvas.addEventListener('mousemove', drawing.handleMouseMove);
        drawing.canvas.addEventListener('mouseup', drawing.handleMouseUp);
        drawing.canvas.addEventListener('mouseleave', drawing.handleMouseUp);

        // Touch events
        drawing.canvas.addEventListener('touchstart', drawing.handleTouchStart, { passive: false });
        drawing.canvas.addEventListener('touchmove', drawing.handleTouchMove, { passive: false });
        drawing.canvas.addEventListener('touchend', drawing.handleTouchEnd, { passive: false });

        // Redraw after setup
        drawing.redrawCanvas();
    },

    getEventCoords: (e) => {
        const rect = drawing.canvas.getBoundingClientRect();
        let clientX, clientY;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // Convert to original image coordinates
        const x = (clientX - rect.left) / drawing.displayScale;
        const y = (clientY - rect.top) / drawing.displayScale;
        return { x, y };
    },

    handleMouseDown: (e) => {
        const coords = drawing.getEventCoords(e);
        
        if (drawing.panMode) {
            drawing.isPanning = true;
            drawing.panStartX = coords.x;
            drawing.panStartY = coords.y;
            drawing.panStartOffsetX = drawing.panOffsetX;
            drawing.panStartOffsetY = drawing.panOffsetY;
        } else {
            drawing.isDragging = true;
            drawing.dragStartX = coords.x;
            drawing.dragStartY = coords.y;
            drawing.tattooStartX = drawing.tattooX;
            drawing.tattooStartY = drawing.tattooY;
        }
    },

    handleMouseMove: (e) => {
        const coords = drawing.getEventCoords(e);

        if (drawing.isPanning && drawing.panMode) {
            const dx = coords.x - drawing.panStartX;
            const dy = coords.y - drawing.panStartY;
            drawing.panOffsetX = drawing.panStartOffsetX + dx;
            drawing.panOffsetY = drawing.panStartOffsetY + dy;
            drawing.redrawCanvas();
        } else if (drawing.isDragging) {
            const dx = coords.x - drawing.dragStartX;
            const dy = coords.y - drawing.dragStartY;
            drawing.tattooX = drawing.tattooStartX + dx;
            drawing.tattooY = drawing.tattooStartY + dy;
            drawing.redrawCanvas();
        }
    },

    handleMouseUp: () => {
        drawing.isDragging = false;
        drawing.isPanning = false;
    },

    handleTouchStart: (e) => {
        e.preventDefault();
        drawing.handleMouseDown(e);
    },

    handleTouchMove: (e) => {
        e.preventDefault();
        drawing.handleMouseMove(e);
    },

    handleTouchEnd: (e) => {
        e.preventDefault();
        drawing.handleMouseUp();
    },

    setTattooRotation: (degrees) => {
        drawing.tattooRotation = parseFloat(degrees);
        const rotationValue = document.getElementById('rotationValue');
        if (rotationValue) rotationValue.textContent = `${Math.round(degrees)}°`;
        drawing.redrawCanvas();
    },

    setTattooScale: (scale) => {
        // scale is a multiplier (e.g., 0.5 to 2.0)
        const baseScale = (Math.min(drawing.skinImage.width, drawing.skinImage.height) * 0.3) / 
                          Math.max(drawing.tattooImage.width, drawing.tattooImage.height);
        drawing.tattooScale = baseScale * scale;
        const sizeValue = document.getElementById('sizeValue');
        if (sizeValue) sizeValue.textContent = `${Math.round(scale * 100)}%`;
        drawing.redrawCanvas();
    },

    setPanMode: (enabled) => {
        drawing.panMode = enabled;
        if (drawing.canvas) {
            drawing.canvas.style.cursor = enabled ? 'grab' : 'move';
        }
    },

    redrawCanvas: () => {
        if (!drawing.ctx || !drawing.skinImage || !drawing.tattooImage) {
            return;
        }

        const ctx = drawing.ctx;
        const scale = drawing.displayScale;

        // Clear canvas
        ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);

        // Draw skin image with pan offset
        ctx.save();
        ctx.translate(drawing.panOffsetX * scale, drawing.panOffsetY * scale);
        ctx.drawImage(drawing.skinImage, 0, 0, drawing.canvas.width, drawing.canvas.height);
        ctx.restore();

        // Draw tattoo with transforms
        ctx.save();
        
        // Translate to tattoo center position (with pan offset)
        ctx.translate(
            (drawing.tattooX + drawing.panOffsetX) * scale,
            (drawing.tattooY + drawing.panOffsetY) * scale
        );
        
        // Rotate
        ctx.rotate(drawing.tattooRotation * Math.PI / 180);
        
        // Calculate scaled tattoo dimensions
        const tattooWidth = drawing.tattooImage.width * drawing.tattooScale * scale;
        const tattooHeight = drawing.tattooImage.height * drawing.tattooScale * scale;
        
        // Draw tattoo centered at origin (use processed tattoo with transparent background)
        const tattooSource = drawing.processedTattoo || drawing.tattooImage;
        ctx.drawImage(
            tattooSource,
            -tattooWidth / 2,
            -tattooHeight / 2,
            tattooWidth,
            tattooHeight
        );
        
        ctx.restore();
    },

    updateMask: () => {
        if (!drawing.maskCtx || !drawing.skinImage || !drawing.tattooImage) {
            console.error('Cannot update mask - images not loaded');
            return;
        }

        const maskCtx = drawing.maskCtx;

        // Clear mask to black
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);

        // Draw tattoo shape as white on mask (at original skin image resolution)
        maskCtx.save();
        
        // Translate to tattoo position
        maskCtx.translate(drawing.tattooX, drawing.tattooY);
        
        // Rotate
        maskCtx.rotate(drawing.tattooRotation * Math.PI / 180);
        
        // Calculate tattoo dimensions at original resolution
        const tattooWidth = drawing.tattooImage.width * drawing.tattooScale;
        const tattooHeight = drawing.tattooImage.height * drawing.tattooScale;
        
        // Fill white rectangle where tattoo is
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(-tattooWidth / 2, -tattooHeight / 2, tattooWidth, tattooHeight);
        
        maskCtx.restore();

        drawing.selectedArea = drawing.maskCanvas.toDataURL('image/png');
        console.log('Mask updated');
    },

    getMaskDataURL: () => {
        return drawing.selectedArea;
    },

    // Get tattoo position and transform data for the API
    getTattooTransform: () => {
        return {
            x: drawing.tattooX,
            y: drawing.tattooY,
            scale: drawing.tattooScale,
            rotation: drawing.tattooRotation,
            skinWidth: drawing.skinImage?.width,
            skinHeight: drawing.skinImage?.height,
            tattooWidth: drawing.tattooImage?.width,
            tattooHeight: drawing.tattooImage?.height
        };
    },

    clearCanvas: () => {
        if (drawing.ctx) {
            drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        }
        if (drawing.maskCtx) {
            drawing.maskCtx.clearRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
        }
        drawing.selectedArea = null;
        drawing.tattooX = 0;
        drawing.tattooY = 0;
        drawing.tattooScale = 1;
        drawing.tattooRotation = 0;
        drawing.panOffsetX = 0;
        drawing.panOffsetY = 0;
        
        const continueBtn = document.getElementById('continueBtn');
        if (continueBtn) continueBtn.style.display = 'none';
    }
};

// Expose globally
window.drawing = drawing;
