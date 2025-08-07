// frontend/js/drawing.js

const drawing = {
    fabricCanvas: null,
    tattooImage: null,
    originalImage: null, // The skin image
    selectedArea: null, // This will hold the final mask Data URL

    init: (skinImageUrl, tattooImageUrl) => {
        if (drawing.fabricCanvas) {
            drawing.fabricCanvas.dispose();
        }

        drawing.fabricCanvas = new fabric.Canvas('drawingCanvas');
        const canvas = drawing.fabricCanvas;

        fabric.Image.fromURL(skinImageUrl, (skinImg) => {
            drawing.originalImage = skinImg.getElement();

            const displayWidth = 600; // Max width for display
            const scale = displayWidth / skinImg.width;
            const displayHeight = skinImg.height * scale;

            canvas.setWidth(displayWidth);
            canvas.setHeight(displayHeight);

            canvas.setBackgroundImage(skinImg, canvas.renderAll.bind(canvas), {
                scaleX: canvas.width / skinImg.width,
                scaleY: canvas.height / skinImg.height,
            });

            fabric.Image.fromURL(tattooImageUrl, (tattooImg) => {
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

                // Scale the tattoo initially to fit reasonably within the canvas
                tattooImg.scaleToWidth(canvas.width / 2);

                canvas.add(tattooImg);
                canvas.setActiveObject(tattooImg);
                canvas.renderAll();

                document.getElementById('drawingSection').style.display = 'block';
                document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });

                // Manually trigger the size slider update
                 const sizeSlider = document.getElementById('sizeSlider');
                 const sizeValue = document.getElementById('sizeValue');
                 const initialScale = tattooImg.scaleX;
                 sizeSlider.value = Math.round(initialScale * 100);
                 sizeValue.textContent = `${Math.round(initialScale * 100)}%`;


            }, { crossOrigin: 'anonymous' });

        }, { crossOrigin: 'anonymous' });

        drawing.setupEventListeners();
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
    },

    updateMask: () => {
        return new Promise((resolve, reject) => {
            if (!drawing.fabricCanvas || !drawing.tattooImage || !drawing.originalImage) {
                console.error('Cannot generate mask: canvas or images not initialized.');
                return reject('Canvas not ready');
            }

            const originalWidth = drawing.originalImage.width;
            const originalHeight = drawing.originalImage.height;
            const displayWidth = drawing.fabricCanvas.width;
            const displayHeight = drawing.fabricCanvas.height;

            const scaleRatio = originalWidth / displayWidth;

            const maskCanvas = new fabric.StaticCanvas(null, {
                width: originalWidth,
                height: originalHeight,
                backgroundColor: 'black'
            });

            const tattoo = drawing.tattooImage;

            tattoo.clone((clonedTattoo) => {
                clonedTattoo.filters.push(new fabric.Image.filters.BlendColor({
                    color: '#FFFFFF',
                    mode: 'tint',
                    alpha: 1
                }));
                clonedTattoo.applyFilters();

                clonedTattoo.set({
                    left: tattoo.left * scaleRatio,
                    top: tattoo.top * scaleRatio,
                    angle: tattoo.angle,
                    scaleX: tattoo.scaleX * scaleRatio,
                    scaleY: tattoo.scaleY * scaleRatio,
                    originX: 'center',
                    originY: 'center'
                });

                maskCanvas.add(clonedTattoo);
                maskCanvas.renderAll();

                drawing.selectedArea = maskCanvas.toDataURL({ format: 'png' });
                maskCanvas.dispose();
                console.log('Mask generated successfully.');
                resolve();
            });
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
