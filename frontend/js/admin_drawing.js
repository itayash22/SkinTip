// frontend/js/admin_drawing.js
// A self-contained, responsive drawing module for the admin page canvas,
// faithfully adapted from the main application's drawing.js.

const adminDrawing = {
    canvas: null,
    ctx: null,
    skinImg: null,
    tattooImg: null,

    camera: { x: 0, y: 0, scale: 1 },
    tattoo: { x: 0, y: 0, scale: 1, angle: 0, width: 0, height: 0 },

    isDragging: false,
    dragStart: { x: 0, y: 0 },

    init(canvasId, skinImageUrl, tattooImageUrl) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.skinImg = new Image();
        this.tattooImg = new Image();

        this.skinImg.crossOrigin = "Anonymous";
        this.tattooImg.crossOrigin = "Anonymous";

        this.skinImg.onload = () => {
            this.resizeCanvasToFit();
            this.centerSkinImage();
            this.tattooPos = { x: this.skinImg.width / 2, y: this.skinImg.height / 2 };
            this.render();
        };

        this.tattooImg.onload = () => {
            this.tattoo.width = this.tattooImg.naturalWidth;
            this.tattoo.height = this.tattooImg.naturalHeight;
            this.resetTattooTransform();
            this.render();
        };

        this.skinImg.src = skinImageUrl;
        this.tattooImg.src = tattooImageUrl;

        this.addEventListeners();
    },

    resizeCanvasToFit() {
        const parent = this.canvas.parentElement;
        const parentWidth = parent.clientWidth;
        const parentHeight = parent.clientHeight; // Use this for aspect ratio calc

        if (this.skinImg.naturalWidth > 0) {
            const aspectRatio = this.skinImg.naturalHeight / this.skinImg.naturalWidth;
            const newWidth = parentWidth;
            const newHeight = parentWidth * aspectRatio;

            this.canvas.width = newWidth;
            this.canvas.height = newHeight;
            this.canvas.style.width = `${newWidth}px`;
            this.canvas.style.height = `${newHeight}px`;
        }
    },

    centerSkinImage() {
        if (!this.skinImg || !this.skinImg.naturalWidth) return;
        const cw = this.canvas.width;
        const sw = this.skinImg.naturalWidth;
        this.camera.scale = cw / sw;
        this.camera.x = 0;
        this.camera.y = 0;
    },

    resetTattooTransform() {
        const skinShortSide = Math.min(this.skinImg.naturalWidth, this.skinImg.naturalHeight);
        const desiredTattooWidth = skinShortSide * 0.25;
        const baseTattooScale = desiredTattooWidth / this.tattoo.width;

        this.tattoo.scale = baseTattooScale;
        this.tattoo.x = this.skinImg.naturalWidth / 2;
        this.tattoo.y = this.skinImg.naturalHeight / 2;
        this.tattoo.angle = 0;
    },

    addEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseout', this.onMouseUp.bind(this));
    },

    onMouseDown(e) {
        this.isDragging = true;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / this.camera.scale;
        const mouseY = (e.clientY - rect.top) / this.camera.scale;
        this.dragStart.x = mouseX - this.tattoo.x;
        this.dragStart.y = mouseY - this.tattoo.y;
    },

    onMouseMove(e) {
        if (this.isDragging) {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / this.camera.scale;
            const mouseY = (e.clientY - rect.top) / this.camera.scale;
            this.tattoo.x = mouseX - this.dragStart.x;
            this.tattoo.y = mouseY - this.dragStart.y;
            this.render();
        }
    },

    onMouseUp() {
        this.isDragging = false;
    },

    render() {
        if (!this.skinImg.complete || !this.tattooImg.complete) return;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.setTransform(this.camera.scale, 0, 0, this.camera.scale, this.camera.x, this.camera.y);

        this.ctx.drawImage(this.skinImg, 0, 0);

        this.ctx.save();
        this.ctx.translate(this.tattoo.x, this.tattoo.y);
        this.ctx.rotate(this.tattoo.angle);
        this.ctx.scale(this.tattoo.scale, this.tattoo.scale);
        this.ctx.drawImage(this.tattooImg, -this.tattoo.width / 2, -this.tattoo.height / 2);
        this.ctx.restore();
    },

    setRotation(degrees) {
        this.tattoo.angle = degrees * Math.PI / 180;
        document.getElementById('adminRotationValue').textContent = `${degrees}°`;
        this.render();
    },

    setScale(scalePercent) {
        const skinShortSide = Math.min(this.skinImg.naturalWidth, this.skinImg.naturalHeight);
        const desiredTattooWidth = skinShortSide * 0.25;
        const baseTattooScale = desiredTattooWidth / this.tattoo.width;

        this.tattoo.scale = baseTattooScale * (scalePercent / 100);
        document.getElementById('adminSizeValue').textContent = `${scalePercent}%`;
        this.render();
    },

    generateMask() {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = this.skinImg.naturalWidth;
        maskCanvas.height = this.skinImg.naturalHeight;
        const maskCtx = maskCanvas.getContext('2d');

        maskCtx.save();
        maskCtx.translate(this.tattoo.x, this.tattoo.y);
        maskCtx.rotate(this.tattoo.angle);
        maskCtx.scale(this.tattoo.scale, this.tattoo.scale);
        maskCtx.drawImage(this.tattooImg, -this.tattoo.width / 2, -this.tattoo.height / 2);
        maskCtx.restore();

        const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 0) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
            }
        }
        maskCtx.putImageData(imageData, 0, 0);

        return maskCanvas.toDataURL('image/png').split(',')[1];
    }
};

window.adminDrawing = adminDrawing;