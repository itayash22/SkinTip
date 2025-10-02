// frontend/js/admin_drawing.js
// A self-contained drawing module for the admin page canvas

const adminDrawing = {
    canvas: null,
    ctx: null,
    skinImage: null,
    tattooImage: null,
    tattooPos: { x: 0, y: 0 },
    tattooScale: 1,
    tattooRotation: 0,
    isDragging: false,
    dragStart: { x: 0, y: 0 },

    init(canvasId, skinImageUrl, tattooImageUrl) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.skinImage = new Image();
        this.tattooImage = new Image();

        this.skinImage.crossOrigin = "Anonymous";
        this.tattooImage.crossOrigin = "Anonymous";

        this.skinImage.onload = () => {
            const parent = this.canvas.parentElement;
            const parentWidth = parent.clientWidth;
            const scale = parentWidth / this.skinImage.naturalWidth;

            this.canvas.width = this.skinImage.naturalWidth * scale;
            this.canvas.height = this.skinImage.naturalHeight * scale;

            this.tattooPos = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
            this.draw();
        };

        this.tattooImage.onload = () => {
            this.draw();
        };

        this.skinImage.src = skinImageUrl;
        this.tattooImage.src = tattooImageUrl;

        this.addEventListeners();
    },

    addEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseout', this.onMouseUp.bind(this));
    },

    onMouseDown(e) {
        this.isDragging = true;
        this.dragStart.x = e.clientX - this.canvas.getBoundingClientRect().left - this.tattooPos.x;
        this.dragStart.y = e.clientY - this.canvas.getBoundingClientRect().top - this.tattooPos.y;
    },

    onMouseMove(e) {
        if (this.isDragging) {
            this.tattooPos.x = e.clientX - this.canvas.getBoundingClientRect().left - this.dragStart.x;
            this.tattooPos.y = e.clientY - this.canvas.getBoundingClientRect().top - this.dragStart.y;
            this.draw();
        }
    },

    onMouseUp() {
        this.isDragging = false;
    },

    draw() {
        if (!this.skinImage || !this.tattooImage) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.skinImage, 0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.translate(this.tattooPos.x, this.tattooPos.y);
        this.ctx.rotate(this.tattooRotation * Math.PI / 180);
        this.ctx.scale(this.tattooScale, this.tattooScale);
        this.ctx.drawImage(this.tattooImage, -this.tattooImage.width / 2, -this.tattooImage.height / 2);
        this.ctx.restore();
    },

    setRotation(degrees) {
        this.tattooRotation = degrees;
        document.getElementById('adminRotationValue').textContent = `${degrees}°`;
        this.draw();
    },

    setScale(scale) {
        this.tattooScale = scale;
        document.getElementById('adminSizeValue').textContent = `${Math.round(scale * 100)}%`;
        this.draw();
    },

    generateMask() {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = this.canvas.width;
        maskCanvas.height = this.canvas.height;
        const maskCtx = maskCanvas.getContext('2d');

        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        maskCtx.save();
        maskCtx.translate(this.tattooPos.x, this.tattooPos.y);
        maskCtx.rotate(this.tattooRotation * Math.PI / 180);
        maskCtx.scale(this.tattooScale, this.tattooScale);

        maskCtx.globalCompositeOperation = 'destination-out';
        maskCtx.drawImage(this.tattooImage, -this.tattooImage.width / 2, -this.tattooImage.height / 2);
        maskCtx.restore();

        return maskCanvas.toDataURL('image/png').split(',')[1]; // Return only base64 part
    }
};

window.adminDrawing = adminDrawing;