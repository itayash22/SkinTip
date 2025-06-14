// frontend/js/drawing.js

const drawing = {
    canvas: null,
    ctx: null,
    maskCanvas: null, // Hidden canvas for creating the mask sent to AI
    maskCtx: null,
    originalImage: null, // The skin image being drawn on
    isDrawing: false,
    currentPath: [], // Stores coordinates of the path being drawn
    currentPathCoords: null, // Stores the coordinates of the *saved* closed path
    selectedArea: null, // Stores the Base64 Data URL of the final mask image for API

    init: (imageUrl) => {
        drawing.canvas = document.getElementById('drawingCanvas');
        drawing.ctx = drawing.canvas.getContext('2d');

        // Create hidden mask canvas for Flux API
        drawing.maskCanvas = document.createElement('canvas');
        drawing.maskCtx = drawing.maskCanvas.getContext('2d');

        // Reset drawing state for a new image
        drawing.currentPath = [];
        drawing.currentPathCoords = null;
        drawing.selectedArea = null;

        // Load the skin image
        const img = new Image();
        img.onload = () => {
            drawing.originalImage = img;

            // Set display canvas sizes, respecting aspect ratio
            const maxWidth = 600; // Max width for display on screen
            const scale = Math.min(1, maxWidth / img.width);
            drawing.canvas.width = img.width * scale;
            drawing.canvas.height = img.height * scale;

            // Set mask canvas to original image size (essential for AI API input consistency)
            drawing.maskCanvas.width = img.width;
            drawing.maskCanvas.height = img.height;

            // Draw image on display canvas
            drawing.redrawCanvas();

            // Initialize mask canvas with BLACK background (represents no tattoo area initially for Flux fill model)
            drawing.maskCtx.fillStyle = 'black'; // Initial state of the mask canvas is black (no tattoo area initially)
            drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCtx.height);

            // Show drawing section and scroll to it
            document.getElementById('drawingSection').style.display = 'block';
            document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });

            // Hide continue button initially (it will be shown after a valid mask is drawn)
            const continueBtn = document.getElementById('continueBtn');
            if (continueBtn) continueBtn.style.display = 'none';

            drawing.setupEventListeners();
        };
        img.src = imageUrl;
    },

    setupEventListeners: () => {
        // Mouse events for drawing
        drawing.canvas.addEventListener('mousedown', drawing.startDrawing);
        drawing.canvas.addEventListener('mousemove', drawing.draw);
        drawing.canvas.addEventListener('mouseup', drawing.stopDrawing);
        drawing.canvas.addEventListener('mouseleave', drawing.stopDrawing); // End drawing if mouse leaves canvas

        // Touch events for drawing (mobile support)
        drawing.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling/zooming
            const touch = e.touches[0];
            drawing.startDrawing({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }, { passive: false });

        drawing.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault(); // Prevent scrolling/zooming
            const touch = e.touches[0];
            drawing.draw({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }, { passive: false });

        drawing.canvas.addEventListener('touchend', (e) => {
            e.preventDefault(); // Prevent default touch behavior
            drawing.stopDrawing();
        }, { passive: false });

        // Clear canvas button event listener - NOW WORKS
        document.getElementById('clearCanvas')?.addEventListener('click', () => {
            drawing.clearCanvas();
        });

        // The "Continue to Design" (now "Generate Tattoo on Skin") button listener is handled in index.html.
    },

    startDrawing: (e) => {
        drawing.isDrawing = true;
        drawing.currentPath = []; // Start a new path for this drawing session

        const rect = drawing.canvas.getBoundingClientRect();
        // Scale coordinates from display canvas to original image dimensions for mask accuracy
        const x = (e.clientX - rect.left) / drawing.canvas.clientWidth * drawing.originalImage.width;
        const y = (e.clientY - rect.top) / drawing.canvas.clientHeight * drawing.originalImage.height;

        drawing.currentPath.push({ x, y });
    },

    draw: (e) => {
        if (!drawing.isDrawing) return;

        const rect = drawing.canvas.getBoundingClientRect();
        // Scale coordinates from display canvas to original image dimensions for mask accuracy
        const x = (e.clientX - rect.left) / drawing.canvas.clientWidth * drawing.originalImage.width;
        const y = (e.clientY - rect.top) / drawing.canvas.clientHeight * drawing.originalImage.height;

        drawing.currentPath.push({ x, y });

        drawing.redrawCanvas(); // Redraw the display canvas with the original image and any saved path

        // Draw the current path (the line being drawn by the user) with luminescent effect
        if (drawing.currentPath.length > 1) {
            drawing.ctx.save();

            // Scale drawing style to match display canvas
            const displayScaleX = drawing.canvas.width / drawing.originalImage.width;
            const displayScaleY = drawing.canvas.height / drawing.originalImage.height;

            // Outer glow
            drawing.ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
            drawing.ctx.lineWidth = 12 * displayScaleX;
            drawing.ctx.setLineDash([]); // Solid line for glow
            drawing.ctx.shadowColor = '#6366f1';
            drawing.ctx.shadowBlur = 20 * displayScaleX;
            drawing.ctx.beginPath();
            // Draw path using scaled coordinates for display
            drawing.ctx.moveTo(drawing.currentPath[0].x * displayScaleX, drawing.currentPath[0].y * displayScaleY);
            for (let i = 1; i < drawing.currentPath.length; i++) {
                drawing.ctx.lineTo(drawing.currentPath[i].x * displayScaleX, drawing.currentPath[i].y * displayScaleY);
            }
            drawing.ctx.stroke();

            // Middle glow
            drawing.ctx.strokeStyle = 'rgba(129, 140, 248, 0.4)';
            drawing.ctx.lineWidth = 6 * displayScaleX;
            drawing.ctx.shadowBlur = 10 * displayScaleX;
            drawing.ctx.stroke();

            // Inner bright line (dotted)
            drawing.ctx.strokeStyle = '#e0e7ff';
            drawing.ctx.lineWidth = 2 * displayScaleX;
            drawing.ctx.shadowBlur = 5 * displayScaleX;
            drawing.ctx.setLineDash([5 * displayScaleX, 5 * displayScaleX]); // Dotted line
            drawing.ctx.stroke();

            drawing.ctx.restore();
        }
    },

    stopDrawing: () => {
        if (!drawing.isDrawing) return; // If drawing wasn't active, do nothing
        drawing.isDrawing = false;

        // Check if path is closed and has enough points (min 10 points to avoid tiny clicks)
        if (drawing.currentPath.length > 10) {
            const first = drawing.currentPath[0];
            const last = drawing.currentPath[drawing.currentPath.length - 1];
            // Distance check in original image coordinates
            const distance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));

            if (distance < 30) { // If closed (threshold of 30 pixels in original image resolution)
                drawing.currentPathCoords = [...drawing.currentPath]; // Save the coordinates of the closed path
                drawing.updateMask(); // Generate the mask image on the hidden canvas
                drawing.selectedArea = drawing.maskCanvas.toDataURL('image/png'); // Store the mask as Base64 for API

                // Show continue button (now "Generate Tattoo on Skin")
                const continueBtn = document.getElementById('continueBtn');
                if (continueBtn) continueBtn.style.display = 'block';
            } else {
                alert('Please close the shape by drawing near your starting point to define the tattoo area.');
                // Clear the path if not closed well enough
                drawing.currentPath = [];
                drawing.currentPathCoords = null;
                drawing.selectedArea = null;
                const continueBtn = document.getElementById('continueBtn');
                if (continueBtn) continueBtn.style.display = 'none';
            }
        } else {
            alert('Please draw a larger and more defined area for your tattoo.');
            // Clear the path if too small
            drawing.currentPath = [];
            drawing.currentPathCoords = null;
            drawing.selectedArea = null;
            const continueBtn = document.getElementById('continueBtn');
            if (continueBtn) continueBtn.style.display = 'none';
        }

        drawing.redrawCanvas(); // Redraw to show the filled selected area or clear temporary path
    },

    redrawCanvas: () => {
        // Only attempt to draw if canvas and context are initialized
        if (!drawing.canvas || !drawing.ctx || !drawing.originalImage) {
            return;
        }

        // Always clear and redraw the original image first
        drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        drawing.ctx.drawImage(drawing.originalImage, 0, 0, drawing.canvas.width, drawing.canvas.height);

        // Draw the previously selected (closed) area if it exists
        if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
            drawing.ctx.save();

            // Scale drawing to display canvas dimensions
            const displayScaleX = drawing.canvas.width / drawing.originalImage.width;
            const displayScaleY = drawing.canvas.height / drawing.originalImage.height;

            // Luminescent fill style for the selected area
            drawing.ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
            drawing.ctx.strokeStyle = '#818cf8';
            drawing.ctx.lineWidth = 3 * Math.min(displayScaleX, displayScaleY); // Scale line width
            drawing.ctx.shadowColor = '#6366f1';
            drawing.ctx.shadowBlur = 15 * Math.min(displayScaleX, displayScaleY);

            drawing.ctx.beginPath();
            // Draw the saved path coordinates, scaled for display
            drawing.ctx.moveTo(drawing.currentPathCoords[0].x * displayScaleX, drawing.currentPathCoords[0].y * displayScaleY);
            for (let i = 1; i < drawing.currentPathCoords.length; i++) {
                drawing.ctx.lineTo(drawing.currentPathCoords[i].x * displayScaleX, drawing.currentPathCoords[i].y * displayScaleY);
            }
            drawing.ctx.closePath(); // Close the shape
            drawing.ctx.fill(); // Fill the shape
            drawing.ctx.stroke(); // Draw the outline
            drawing.ctx.restore();
        }
    },

    updateMask: () => {
        // Only attempt to update mask if maskCanvas and maskCtx are initialized
        if (!drawing.maskCanvas || !drawing.maskCtx || !drawing.originalImage) {
            return;
        }

        // Create the mask on the HIDDEN canvas.
        // Frontend mask is white for the tattoo area, black elsewhere.
        // Backend will use this directly as an alpha mask, after converting it to a raw buffer.

        // Start with a BLACK background for the mask canvas
        drawing.maskCtx.fillStyle = 'black';
        drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);

        // Draw the drawn area as WHITE on the mask canvas
        if (drawing.currentPathCoords && drawing.currentPathCoords.length > 0) {
            drawing.maskCtx.fillStyle = 'white'; // Use white for the area to be filled
            drawing.maskCtx.beginPath();
            // Use original image coordinates for mask for pixel accuracy
            drawing.maskCtx.moveTo(drawing.currentPathCoords[0].x, drawing.currentPathCoords[0].y);

            for (let i = 1; i < drawing.currentPathCoords.length; i++) {
                drawing.maskCtx.lineTo(drawing.currentPathCoords[i].x, drawing.currentPathCoords[i].y);
            }

            drawing.maskCtx.closePath();
            drawing.maskCtx.fill(); // Fill the shape with white
        }
        console.log('Mask updated on hidden canvas: drawn area is white.');
    },

    clearCanvas: () => {
        // Only attempt to clear if canvas and context are initialized
        if (!drawing.canvas || !drawing.ctx) {
            return;
        }

        // Clear both display and mask canvases
        drawing.ctx.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
        if (drawing.maskCtx && drawing.maskCanvas) {
            drawing.maskCtx.clearRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
        }

        // Reset all drawing state variables
        drawing.currentPath = [];
        drawing.selectedArea = null;
        drawing.currentPathCoords = null;
        
        // Redraw the original image (which will clear the display canvas if no image)
        drawing.redrawCanvas();

        // Re-initialize mask canvas with black background after clearing for consistency
        if (drawing.maskCtx && drawing.maskCanvas) {
            drawing.maskCtx.fillStyle = 'black';
            drawing.maskCtx.fillRect(0, 0, drawing.maskCanvas.width, drawing.maskCanvas.height);
        }

        // Hide the continue button (now "Generate Tattoo on Skin")
        const continueBtn = document.getElementById('continueBtn');
        if (continueBtn) continueBtn.style.display = 'none';
        
        console.log('Canvas and mask cleared. Drawing state reset.');
    },

    // Public getter for mask data URL (used by index.html)
    getMaskDataURL: () => {
        return drawing.selectedArea;
    }
};

// Expose the drawing object globally so index.html can access it
window.drawing = drawing;
