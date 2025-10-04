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
    baseTattooScale: 1,

    isDragging: false,
    dragStart: { x: 0, y: 0 },

    init(canvasId, skinImageUrl, tattooImageUrl) {
        console.log('DEBUG: adminDrawing.init started.');
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.skinImg = new Image();
        this.tattooImg = new Image();

        this.skinImg.crossOrigin = "Anonymous";
        this.tattooImg.crossOrigin = "Anonymous";

        const parent = this.canvas.parentElement;
        const startHillClimbingBtn = document.getElementById('startHillClimbing');

        const checkImagesLoaded = () => {
            console.log('DEBUG: checkImagesLoaded called.');
            if (this.skinImg.complete && this.skinImg.naturalWidth > 0 &&
                this.tattooImg.complete && this.tattooImg.naturalWidth > 0) {
                console.log('DEBUG: Both images are loaded. Enabling start button.');
                startHillClimbingBtn.disabled = false;
            } else {
                console.log('DEBUG: At least one image is not ready.', {
                    skinComplete: this.skinImg.complete,
                    skinWidth: this.skinImg.naturalWidth,
                    tattooComplete: this.tattooImg.complete,
                    tattooWidth: this.tattooImg.naturalWidth
                });
            }
        };

        const resizeToParent = () => {
            const w = parent.clientWidth;
            if (this.skinImg.naturalWidth > 0) {
                const h = w * (this.skinImg.naturalHeight / this.skinImg.naturalWidth);
                this.canvas.style.width  = w + 'px';
                this.canvas.style.height = h + 'px';
                this.canvas.width  = Math.floor(w * window.devicePixelRatio);
                this.canvas.height = Math.floor(h * window.devicePixelRatio);
                this.centerSkinImage();
                this.render();
            }
        }

        this.skinImg.onload = () => {
            console.log('DEBUG: skinImg.onload triggered.');
            resizeToParent();
            this.render();
            checkImagesLoaded();
        };
        this.skinImg.onerror = () => { console.error('DEBUG: skinImg failed to load.'); };

        this.tattooImg.onload = () => {
            console.log('DEBUG: tattooImg.onload triggered.');
            this.tattoo.width = this.tattooImg.naturalWidth;
            this.tattoo.height = this.tattooImg.naturalHeight;
            this.resetTattooTransform();
            this.render();
            checkImagesLoaded();
        };
        this.tattooImg.onerror = () => { console.error('DEBUG: tattooImg failed to load.'); };

        if (!this.canvas.__ro) {
            const ro = new ResizeObserver(resizeToParent);
            ro.observe(parent);
            this.canvas.__ro = ro;
        }

        console.log('DEBUG: Setting image sources.');
        this.skinImg.src = skinImageUrl;
        this.tattooImg.src = tattooImageUrl;

        this.addEventListeners();
        console.log('DEBUG: adminDrawing.init finished.');
    },

    centerSkinImage() {
        if (!this.skinImg || !this.skinImg.naturalWidth) return;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const sw = this.skinImg.naturalWidth;
        const sh = this.skinImg.naturalHeight;

        const scaleX = cw / sw;
        const scaleY = ch / sh;
        this.camera.scale = Math.min(scaleX, scaleY);
        this.camera.x = (cw - sw * this.camera.scale) / 2;
        this.camera.y = (ch - sh * this.camera.scale) / 2;
    },

    resetTattooTransform() {
        if (!this.skinImg.naturalWidth || !this.tattooImg.naturalWidth) return;
        const skinShortSide = Math.min(this.skinImg.naturalWidth, this.skinImg.naturalHeight);
        const desiredTattooWidth = skinShortSide * 0.25;
        this.baseTattooScale = desiredTattooWidth / this.tattoo.width;

        this.tattoo.scale = this.baseTattooScale;
        this.tattoo.x = this.skinImg.naturalWidth / 2;
        this.tattoo.y = this.skinImg.naturalHeight / 2;
        this.tattoo.angle = 0;
    },

    addEventListeners() {
        if (this.canvas.__handlersAttached) return;
        this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
        this.canvas.addEventListener('pointerup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('pointerout', this.onMouseUp.bind(this));
        this.canvas.__handlersAttached = true;
    },

    canvasPointToWorld(point) {
        return {
            x: (point.x - this.camera.x) / this.camera.scale,
            y: (point.y - this.camera.y) / this.camera.scale
        };
    },

    onPointerDown(e) {
        this.isDragging = true;
        const rect = this.canvas.getBoundingClientRect();
        const canvasPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const worldPoint = this.canvasPointToWorld(canvasPoint);

        this.dragStart.x = worldPoint.x - this.tattoo.x;
        this.dragStart.y = worldPoint.y - this.tattoo.y;
    },

    onPointerMove(e) {
        if (this.isDragging) {
            const rect = this.canvas.getBoundingClientRect();
            const canvasPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const worldPoint = this.canvasPointToWorld(canvasPoint);

            this.tattoo.x = worldPoint.x - this.dragStart.x;
            this.tattoo.y = worldPoint.y - this.dragStart.y;
            this.render();
        }
    },

    onMouseUp() {
        this.isDragging = false;
    },

    render() {
        if (!this.skinImg.complete || !this.tattooImg.complete || !this.skinImg.naturalWidth) return;

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
        this.tattoo.scale = this.baseTattooScale * (scalePercent / 100);
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