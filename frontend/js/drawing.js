// frontend/js/drawing.js

const drawing = {
    fabricCanvas: null,
    tattooImage: null,
    originalImage: null, // The skin image
    selectedArea: null, // This will hold the final mask Data URL

    init: (skinImageUrl, tattooImageUrl) => {
        console.log("DEBUG: drawing.init started.");
        try {
            if (!skinImageUrl || !tattooImageUrl) {
                console.error("DEBUG: Drawing Error: Missing skin or tattoo image URL.");
                alert("Error: Image data is missing. Cannot initialize canvas.");
                return;
            }

            if (drawing.fabricCanvas) {
                console.log("DEBUG: Disposing of existing Fabric canvas.");
                drawing.fabricCanvas.dispose();
            }

            const canvasElement = document.getElementById('drawingCanvas');
            if (!canvasElement) {
                console.error("DEBUG: Drawing Error: Canvas element with ID 'drawingCanvas' not found!");
                alert("A critical error occurred: the drawing canvas is missing.");
                return;
            }

            console.log("DEBUG: Initializing Fabric.js canvas.");
            drawing.fabricCanvas = new fabric.Canvas('drawingCanvas');
            const canvas = drawing.fabricCanvas;
            console.log("DEBUG: Fabric.js canvas initialized.");

            console.log("DEBUG: Loading skin image...");
            fabric.Image.fromURL(skinImageUrl, (skinImg, isError) => {
                if (isError || !skinImg) {
                    console.error("DEBUG: Fabric Error: Failed to load skin image.");
                    alert("Error: Could not load the skin image.");
                    return;
                }
                console.log("DEBUG: Skin image loaded successfully.");
                drawing.originalImage = skinImg.getElement();

                const displayWidth = 600;
                const scale = displayWidth / skinImg.width;
                const displayHeight = skinImg.height * scale;

                canvas.setWidth(displayWidth);
                canvas.setHeight(displayHeight);

                canvas.setBackgroundImage(skinImg, canvas.renderAll.bind(canvas), {
                    scaleX: canvas.width / skinImg.width,
                    scaleY: canvas.height / skinImg.height,
                });
                console.log("DEBUG: Canvas background set with skin image.");

                console.log("DEBUG: Loading tattoo image...");
                fabric.Image.fromURL(tattooImageUrl, (tattooImg, isError) => {
                    if (isError || !tattooImg) {
                        console.error("DEBUG: Fabric Error: Failed to load tattoo image.");
                        alert("Error: Could not load the tattoo design.");
                        return;
                    }
                    console.log("DEBUG: Tattoo image loaded successfully.");
                    drawing.tattooImage = tattooImg;

                    tattooImg.set({
                        left: canvas.width / 2,
                        top: canvas.height / 2,
                        originX: 'center',
                        originY: 'center',
                        cornerColor: 'rgba(102, 153, 255, 0.5)',
                        borderColor: 'rgba(102, 153, 255, 0.7)',
                        transparentCorners: false,
                    });

                    tattooImg.scaleToWidth(canvas.width / 2);

                    canvas.add(tattooImg);
                    canvas.setActiveObject(tattooImg);
                    canvas.renderAll();
                    console.log("DEBUG: Tattoo image added to canvas.");

                    document.getElementById('drawingSection').style.display = 'block';
                    document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });
                    console.log("DEBUG: Drawing section displayed.");

                    const sizeSlider = document.getElementById('sizeSlider');
                    const sizeValue = document.getElementById('sizeValue');
                    if(sizeSlider && sizeValue){
                        const initialScale = tattooImg.scaleX;
                        sizeSlider.value = Math.round(initialScale * 100);
                        sizeValue.textContent = `${Math.round(initialScale * 100)}%`;
                        console.log("DEBUG: Initial size slider value set.");
                    }

                }, { crossOrigin: 'anonymous' });

            }, { crossOrigin: 'anonymous' });

            drawing.setupEventListeners();
            console.log("DEBUG: Event listeners set up.");

        } catch (error) {
            console.error("DEBUG: A critical error occurred in drawing.init:", error);
            alert("A critical error occurred while setting up the drawing canvas. Please check the console for details.");
        }
    },

    setupEventListeners: () => {
        const rotationSlider = document.getElementById('rotationSlider');
        const sizeSlider = document.getElementById('sizeSlider');
        const rotationValue = document.getElementById('rotationValue');
        const sizeValue = document.getElementById('sizeValue');

        rotationSlider.addEventListener('input', (e) => {
            if (drawing.tattooImage) {
                const angle = parseInt(e.target.value, 10);
                drawing.tattooImage.set({ angle }).setCoords();
                drawing.fabricCanvas.renderAll();
                rotationValue.textContent = `${angle}°`;
            }
        });

        sizeSlider.addEventListener('input', (e) => {
            if (drawing.tattooImage) {
                const scale = parseInt(e.target.value, 10) / 100;
                drawing.tattooImage.scale(scale).setCoords();
                drawing.fabricCanvas.renderAll();
                sizeValue.textContent = `${Math.round(scale * 100)}%`;
            }
        });

        if (drawing.fabricCanvas) {
            drawing.fabricCanvas.on('object:modified', () => {
                if (drawing.tattooImage) {
                    const angle = Math.round(drawing.tattooImage.angle);
                    rotationSlider.value = angle;
                    rotationValue.textContent = `${angle}°`;

                    const scale = drawing.tattooImage.scaleX;
                    sizeSlider.value = Math.round(scale * 100);
                    sizeValue.textContent = `${Math.round(scale * 100)}%`;
                }
            });
        }
    },

    updateMask: () => {
        return new Promise((resolve, reject) => {
            console.log("DEBUG: updateMask started.");
            if (!drawing.fabricCanvas || !drawing.tattooImage || !drawing.originalImage) {
                console.error('DEBUG: Cannot generate mask: canvas or images not initialized.');
                return reject('Canvas not ready');
            }

            const originalWidth = drawing.originalImage.width;
            const originalHeight = drawing.originalImage.height;
            const displayWidth = drawing.fabricCanvas.width;

            const scaleRatio = originalWidth / displayWidth;

            const maskCanvas = new fabric.StaticCanvas(null, {
                width: originalWidth,
                height: originalHeight,
                backgroundColor: 'black'
            });

            const tattoo = drawing.tattooImage;

            tattoo.clone((clonedTattoo) => {
                console.log("DEBUG: Cloning tattoo for mask generation.");
                clonedTattoo.filters.push(new fabric.Image.filters.BlendColor({
                    color: '#FFFFFF',
                    mode: 'tint',
                    alpha: 1
                }));
                clonedTattoo.applyFilters();
                console.log("DEBUG: White tint applied to mask clone.");

                clonedTattoo.set({
                    left: tattoo.left * scaleRatio,
                    top: tattoo.top * scaleRatio,
                    angle: tattoo.angle,
                    scaleX: tattoo.scaleX * scaleRatio,
                    scaleY: tattoo.scaleY * scaleRatio,
                    originX: 'center',
                    originY: 'center'
                });
                console.log("DEBUG: Transformations applied to mask clone.");

                maskCanvas.add(clonedTattoo);
                maskCanvas.renderAll();

                drawing.selectedArea = maskCanvas.toDataURL({ format: 'png' });
                maskCanvas.dispose();
                console.log('DEBUG: Mask generated and stored in drawing.selectedArea.');
                resolve();
            }, ['filters']); // Important: specify properties to clone
        });
    },

    clearCanvas: () => {
        console.log("DEBUG: clearCanvas called.");
        if (drawing.fabricCanvas) {
            drawing.fabricCanvas.dispose();
            drawing.fabricCanvas = null;
        }
        drawing.tattooImage = null;
        drawing.originalImage = null;
        drawing.selectedArea = null;
        
        const rotationSlider = document.getElementById('rotationSlider');
        const sizeSlider = document.getElementById('sizeSlider');
        if(rotationSlider) rotationSlider.value = 0;
        if(sizeSlider) sizeSlider.value = 100;
        const rotationValue = document.getElementById('rotationValue');
        const sizeValue = document.getElementById('sizeValue');
        if(rotationValue) rotationValue.textContent = '0°';
        if(sizeValue) sizeValue.textContent = '100%';
        console.log("DEBUG: Canvas and state cleared.");
    },

    getMaskDataURL: () => {
        return drawing.selectedArea;
    }
};

window.drawing = drawing;
