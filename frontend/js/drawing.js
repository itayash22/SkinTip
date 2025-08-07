// frontend/js/drawing.js

const drawing = {
    fabricCanvas: null,
    tattooImage: null,
    originalImage: null,
    selectedArea: null,

    init: (skinImageUrl, tattooImageUrl) => {
        console.log("DEBUG: drawing.init started.");
        try {
            if (!skinImageUrl || !tattooImageUrl) {
                console.error("DEBUG: Drawing Error: Missing image URLs.");
                return;
            }

            if (drawing.fabricCanvas) {
                drawing.fabricCanvas.dispose();
            }

            const canvasElement = document.getElementById('drawingCanvas');
            if (!canvasElement) {
                console.error("DEBUG: Canvas element 'drawingCanvas' not found!");
                return;
            }

            drawing.fabricCanvas = new fabric.Canvas('drawingCanvas');
            const canvas = drawing.fabricCanvas;
            console.log("DEBUG: Fabric canvas initialized.");

            const skinImgElement = new Image();
            skinImgElement.crossOrigin = "anonymous";
            skinImgElement.onload = () => {
                console.log("DEBUG: Skin image element loaded via onload.");
                drawing.originalImage = skinImgElement;
                const skinImg = new fabric.Image(skinImgElement);

                const displayWidth = 600;
                const scale = displayWidth / skinImg.width;
                const displayHeight = skinImg.height * scale;

                canvas.setWidth(displayWidth);
                canvas.setHeight(displayHeight);

                canvas.setBackgroundImage(skinImg, canvas.renderAll.bind(canvas), {
                    scaleX: canvas.width / skinImg.width,
                    scaleY: canvas.height / skinImg.height,
                });
                console.log("DEBUG: Canvas background set.");

                const tattooImgElement = new Image();
                tattooImgElement.crossOrigin = "anonymous";
                tattooImgElement.onload = () => {
                    console.log("DEBUG: Tattoo image element loaded via onload.");
                    const tattooImg = new fabric.Image(tattooImgElement);
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
                    drawing.setupEventListeners();
                    console.log("DEBUG: Drawing section displayed and listeners set up.");

                    const sizeSlider = document.getElementById('sizeSlider');
                    const sizeValue = document.getElementById('sizeValue');
                    if (sizeSlider && sizeValue) {
                        const initialScale = tattooImg.scaleX;
                        sizeSlider.value = Math.round(initialScale * 100);
                        sizeValue.textContent = `${Math.round(initialScale * 100)}%`;
                    }
                };
                tattooImgElement.onerror = () => {
                    console.error("DEBUG: Failed to load tattoo image element from src.");
                };
                console.log("DEBUG: Setting tattoo image src.");
                tattooImgElement.src = tattooImageUrl;
            };
            skinImgElement.onerror = () => {
                console.error("DEBUG: Failed to load skin image element from src.");
            };
            console.log("DEBUG: Setting skin image src.");
            skinImgElement.src = skinImageUrl;

        } catch (error) {
            console.error("DEBUG: A critical error occurred in drawing.init:", error);
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
            const tattooClone = new fabric.Image(tattoo.getElement(), {
                left: tattoo.left * scaleRatio,
                top: tattoo.top * scaleRatio,
                angle: tattoo.angle,
                scaleX: tattoo.scaleX * scaleRatio,
                scaleY: tattoo.scaleY * scaleRatio,
                originX: 'center',
                originY: 'center'
            });

            tattooClone.filters.push(new fabric.Image.filters.BlendColor({
                color: '#FFFFFF',
                mode: 'tint',
                alpha: 1
            }));
            tattooClone.applyFilters();

            maskCanvas.add(tattooClone);
            maskCanvas.renderAll();

            drawing.selectedArea = maskCanvas.toDataURL({ format: 'png' });
            maskCanvas.dispose();
            console.log('DEBUG: Mask generated and stored.');
            resolve();
        });
    },

    clearCanvas: () => {
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
    },

    getMaskDataURL: () => {
        return drawing.selectedArea;
    }
};

window.drawing = drawing;
