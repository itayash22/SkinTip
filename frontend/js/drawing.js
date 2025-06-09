// frontend/js/drawing.js

const drawing = {
    canvas: null,
    ctx: null,
    maskCanvas: null,
    maskCtx: null,
    originalImage: null,
    isDrawing: false,
    currentPath: [],
    currentPathCoords: null, // Stores the coordinates of the *saved* path
    selectedArea: null, // This will store the base64 data of the mask for the API

    init: (imageUrl) => {
        drawing.canvas = document.getElementById('drawingCanvas');
        drawing.ctx = drawing.canvas.getContext('2d');

        // Create hidden mask canvas for Flux API
        drawing.maskCanvas = document.createElement('canvas');
        drawing.maskCtx = drawing.maskCanvas.getContext('2d');

        // Reset drawing state
        drawing.currentPath = [];
        drawing.currentPathCoords = null;
        drawing.selectedArea = null;

        // Load image
        const img = new Image();
        img.onload = () => {
            drawing.originalImage = img;

            // Set display canvas sizes, respecting aspect ratio
            const maxWidth = 600; // Max width for display on screen
            const scale = Math.min(1, maxWidth / img.width);
            drawing.canvas.width = img.width * scale;
            drawing.canvas.height = img.height * scale;

            // Set mask canvas to original image size (essential for AI API)
            drawing.maskCanvas.width = img.width;
            drawing.maskCanvas.height = img.height;

            // Draw image on display canvas
            drawing.redrawCanvas();

            // Initialize mask canvas with black background (represents no tattoo area initially)
            // Flux API's fill model expects black for the fill area and white for the surrounding context.
            drawing.maskCtx.fillStyle = 'black'; // Set initial mask to black
            drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);

            // Show drawing section and scroll to it
            document.getElementById('drawingSection').style.display = 'block';
            document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });

            // Hide continue button initially
            const continueBtn = document.getElementById('continueBtn');
            if (continueBtn) continueBtn.style.display = 'none';

            drawing.setupEventListeners();
        };
        img.src = imageUrl;
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
        }, { passive: false }); // Use passive: false to allow preventDefault

        drawing.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            drawing.draw({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }, { passive: false });

        drawing.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            drawing.stopDrawing();
        }, { passive: false });

        // Clear canvas button
        document.getElementById('clearCanvas')?.addEventListener('click', () => {
            drawing.clearCanvas();
        });

        // Continue button (event listener already handled in index.html, keeping for clarity)
        // This logic will be triggered by the `continueBtn` in index.html after mask creation.
    },

    startDrawing: (e) => {
        drawing.isDrawing = true;
        drawing.currentPath = []; // Start a new path

        const rect = drawing.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / drawing.canvas.clientWidth * drawing.originalImage.width;
        const y = (e.clientY - rect.top) / drawing.canvas.clientHeight * drawing.originalImage.height;

        drawing.currentPath.push({ x, y });
    },

    draw: (e) => {
        if (!drawing.isDrawing) return;

        const rect = drawing.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / drawing.canvas.clientWidth * drawing.originalImage.width;
        const y = (e.clientY - rect.top) / drawing.canvas.clientHeight * drawing.originalImage.height;

        drawing.currentPath.push({ x, y });

        drawing.redrawCanvas(); // Redraw display canvas with current path

        // Draw current path (luminescent line on display canvas)
        if (drawing.currentPath.length > 1) {
            drawing.ctx.save();
            // Scale the line drawing to the display canvas
            const displayScaleX = drawing.canvas.width / drawing.originalImage.width;
            const displayScaleY = drawing.canvas.height / drawing.originalImage.height;

            drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)'; // Outer glow
            drawing.ctx.lineWidth = 12 * displayScaleX;
            drawing.ctx.setLineDash([]);
            drawing.ctx.shadowColor = '#6366f1';
            drawing.ctx.shadowBlur = 20 * displayScaleX;
            drawing.ctx.beginPath();
            drawing.ctx.moveTo(drawing.currentPath[0].x * displayScaleX, drawing.currentPath[0].y * displayScaleY);
            for (let i = 1; i < drawing.currentPath.length; i++) {
                drawing.ctx.lineTo(drawing.currentPath[i].x * displayScaleX, drawing.currentPath[i].y * displayScaleY);
            }
            drawing.ctx.stroke();

            drawing.ctx.strokeStyle = 'rgba(129, 140, 248, 0.4)'; // Middle glow
            drawing.ctx.lineWidth = 6 * displayScaleX;
            drawing.ctx.shadowBlur = 10 * displayScaleX;
            drawing.ctx.stroke();

            drawing.ctx.strokeStyle = '#e0e7ff'; // Inner bright line
            drawing.ctx.lineWidth = 2 * displayScaleX;
            drawing.ctx.shadowBlur = 5 * displayScaleX;
            drawing.ctx.setLineDash([5 * displayScaleX, 5 * displayScaleX]);
            drawing.ctx.stroke();

            drawing.ctx.restore();
        }
    },

    stopDrawing: () => {
        if (!drawing.isDrawing) return;
        drawing.isDrawing = false;

        // Check if path is closed (last point near first point) and has enough points
        if (drawing.currentPath.length > 10) {
            const first = drawing.currentPath[0];
            const last = drawing.currentPath[drawing.currentPath.length - 1];
            const distance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));

            if (distance < 30) { // If closed (threshold in original image coordinates)
                drawing.currentPathCoords = [...drawing.currentPath]; // Save for redraws on display canvas
                drawing.updateMask(); // Update the hidden mask canvas
                drawing.selectedArea = drawing.maskCanvas.toDataURL('image/png'); // Store for API call

                // Show continue button
                const continueBtn = document.getElementById('continueBtn');
                if (continueBtn) continueBtn.style.display = 'block';
            } else {
                alert('Please close the shape by drawing near the starting point to define the tattoo area.');
            }
        } else {
            alert('Please draw a larger and more defined area for your tattoo.');
        }

        drawing.currentPath = []; // Clear current drawing path
        drawing.redrawCanvas(); // Redraw to show the saved, filled area
    },

    redrawCanvas: () => {
        // Always start fresh with the original image
        drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        drawing.ctx.drawImage(drawing.originalImage, 0, 0, drawing.canvas.width, drawing.canvas.height);

        // Draw selected area if exists (using scaled coordinates)
        if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
            drawing.ctx.save();

            // Scale the drawing to the display canvas
            const displayScaleX = drawing.canvas.width / drawing.originalImage.width;
            const displayScaleY = drawing.canvas.height / drawing.originalImage.height;

            drawing.ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
            drawing.ctx.strokeStyle = '#818cf8';
            drawing.ctx.lineWidth = 3 * Math.min(displayScaleX, displayScaleY); // Scale line width too
            drawing.ctx.shadowColor = '#6366f1';
            drawing.ctx.shadowBlur = 15 * Math.min(displayScaleX, displayScaleY);

            drawing.ctx.beginPath();
            drawing.ctx.moveTo(drawing.currentPathCoords[0].x * displayScaleX, drawing.currentPathCoords[0].y * displayScaleY);
            for (let i = 1; i < drawing.currentPathCoords.length; i++) {
                drawing.ctx.lineTo(drawing.currentPathCoords[i].x * displayScaleX, drawing.currentPathCoords[i].y * displayScaleY);
            }
            drawing.ctx.closePath();
            drawing.ctx.fill();
            drawing.ctx.stroke();
            drawing.ctx.restore();
        }
    },

    updateMask: () => {
        // Create mask: everything is WHITE (context) except the drawn area which is BLACK (tattoo area)
        // This is the expected format for Flux API's inpainting (fill model).
        drawing.maskCtx.fillStyle = 'white'; // Default to white
        drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);

        // Draw BLACK area where tattoo should go (inpaint region)
        if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
            drawing.maskCtx.fillStyle = 'black';
            drawing.maskCtx.beginPath();
            drawing.maskCtx.moveTo(drawing.currentPathCoords[0].x, drawing.currentPathCoords[0].y); // Use original image coordinates for mask

            for (let i = 1; i < drawing.currentPathCoords.length; i++) {
                drawing.maskCtx.lineTo(drawing.currentPathCoords[i].x, drawing.currentPathCoords[i].y);
            }

            drawing.maskCtx.closePath();
            drawing.maskCtx.fill();
        }
        console.log('Mask updated on hidden canvas: drawn area is black.');
    },

    clearCanvas: () => {
        drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        drawing.maskCtx.clearRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
        drawing.currentPath = [];
        drawing.selectedArea = null;
        drawing.currentPathCoords = null; // Clear saved path coordinates
        drawing.redrawCanvas(); // Redraw the original image only

        // Re-initialize mask canvas with black background after clearing
        drawing.maskCtx.fillStyle = 'black';
        drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);

        const continueBtn = document.getElementById('continueBtn');
        if (continueBtn) continueBtn.style.display = 'none';
    },

    // Public getter for mask data URL
    getMaskDataURL: () => {
        return drawing.selectedArea; // Return the saved base64 mask
    }
};

// Expose the drawing object globally so index.html can access it
window.drawing = drawing;
