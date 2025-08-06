import * as THREE from 'three';
// --- Interaction variables (Declared globally for the module) ---
// These are now properties of the 'drawing' object to prevent scoping issues.

const drawing = {
    // --- THREE.js Core Variables ---
    canvas: null,
    renderer: null,
    scene: null,
    camera: null,
    skinMesh: null,
    tattooMesh: null,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    dragOffset: new THREE.Vector3(),
    isDragging: false,
    dragMode: 'none',
    initialScale: 1,
    initialPinchDistance: 0,

    // --- Image Storage ---
    uploadedSkinPhotoFile: null,
    uploadedTattooDesignFile: null,
    uploadedTattooDesignImg: null,

    // --- UI Element References ---
    statusMessage: null,
    angleSlider: null,
    angleInput: null,
    sizeSlider: null,
    sizeInput: null,
    resetTattooTransformBtn: null,
    tattooControlsDiv: null,

    init: (imageUrl) => {
        // Ensure statusMessage is available immediately
        drawing.statusMessage = document.getElementById('statusMessage');
        // Defer Three.js and UI setup to avoid paint jank
        setTimeout(() => {
            // Canvas & UI elements
            drawing.canvas                = document.getElementById('main3DCanvas');
            drawing.angleSlider           = document.getElementById('angleSlider');
            drawing.angleInput            = document.getElementById('angleInput');
            drawing.sizeSlider            = document.getElementById('sizeSlider');
            drawing.sizeInput             = document.getElementById('sizeInput');
            drawing.resetTattooTransformBtn = document.getElementById('resetTattooTransformBtn');
            drawing.tattooControlsDiv     = document.getElementById('tattooControls');

            // Renderer
            drawing.renderer = new THREE.WebGLRenderer({ canvas: drawing.canvas, antialias: true, alpha: true });
            drawing.renderer.setSize(drawing.canvas.clientWidth, drawing.canvas.clientHeight);
            drawing.renderer.setPixelRatio(window.devicePixelRatio);

            // Scene & Camera
            drawing.scene = new THREE.Scene();
            drawing.camera = new THREE.PerspectiveCamera(
                75,
                drawing.canvas.clientWidth / drawing.canvas.clientHeight,
                0.1,
                1000
            );
            drawing.camera.position.z = 100;

            // Lights
            drawing.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
            dirLight.position.set(1, 1, 1).normalize();
            drawing.scene.add(dirLight);

            // Skin Plane
            drawing.skinMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(100, 100),
                new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide })
            );
            drawing.skinMesh.position.z = 0;
            drawing.scene.add(drawing.skinMesh);

            // Tattoo Plane
            drawing.tattooMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(40, 40),
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.99, side: THREE.DoubleSide })
            );
            drawing.tattooMesh.position.z = 1;
            drawing.tattooMesh.visible = false;
            drawing.scene.add(drawing.tattooMesh);

            // Animation Loop
            drawing.renderer.setAnimationLoop(() => {
                drawing.renderer.render(drawing.scene, drawing.camera);
            });

            // Events & UI
            drawing.setupEventListeners();
            drawing.statusMessage.textContent = 'Upload Skin Photo and Tattoo Design.';
            document.getElementById('drawingSection').style.display = 'block';

            // Option 2: Apply pending skin upload if present
            if (drawing.uploadedSkinPhotoFile) {
                drawing.handleSkinUpload(drawing.uploadedSkinPhotoFile);
                drawing.uploadedSkinPhotoFile = null;
            }
        }, 0);
    },

    setupEventListeners: () => {
        window.addEventListener('resize', drawing.onWindowResize);

        drawing.angleSlider.addEventListener('input', drawing.handleAngleSliderChange);
        drawing.angleInput.addEventListener('change', drawing.handleAngleInputChange);
        drawing.sizeSlider.addEventListener('input', drawing.handleSizeSliderChange);
        drawing.sizeInput.addEventListener('change', drawing.handleSizeInputChange);
        drawing.resetTattooTransformBtn.addEventListener('click', drawing.resetTattooTransform);

        document.getElementById('captureMaskBtn').addEventListener('click', drawing.captureMask);

        drawing.canvas.addEventListener('pointerdown', drawing.onPointerDown);
        drawing.canvas.addEventListener('pointermove', drawing.onPointerMove);
        drawing.canvas.addEventListener('pointerup', drawing.onPointerUp);
        drawing.canvas.addEventListener('pointerleave', drawing.onPointerUp);

        drawing.tattooControlsDiv.style.display = 'none';
    },

    loadTextureAndImage: (file, cb) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const texture = new THREE.TextureLoader().load(
                    e.target.result,
                    undefined,
                    undefined,
                    (err) => console.error('Error loading texture:', err)
                );
                texture.colorSpace = THREE.SRGBColorSpace;
                cb(texture, img);
            };
        };
        reader.readAsDataURL(file);
    },

    onWindowResize: () => {
        if (!drawing.canvas) return;
        drawing.renderer.setSize(drawing.canvas.clientWidth, drawing.canvas.clientHeight);
        drawing.camera.aspect = drawing.canvas.clientWidth / drawing.canvas.clientHeight;
        drawing.camera.updateProjectionMatrix();
        if (drawing.skinMesh.material.map && drawing.skinMesh.material.map.image) {
            const img = drawing.skinMesh.material.map.image;
            const aspectRatio = img.width / img.height;
            const canvasAspectRatio = drawing.canvas.clientWidth / drawing.canvas.clientHeight;
            const cameraZ = drawing.camera.position.z;
            const vFOV = drawing.camera.fov * THREE.MathUtils.DEG2RAD;
            const totalHeight = 2 * Math.tan(vFOV / 2) * cameraZ;
            const totalWidth = totalHeight * drawing.camera.aspect;
            let w, h;
            if (aspectRatio > canvasAspectRatio) {
                w = totalWidth;
                h = w / aspectRatio;
            } else {
                h = totalHeight;
                w = h * aspectRatio;
            }
            drawing.skinMesh.geometry.dispose();
            drawing.skinMesh.geometry = new THREE.PlaneGeometry(w, h);
            drawing.skinMesh.position.set(0, 0, 0);
        }
    },

    handleSkinUpload: (file) => {
        drawing.uploadedSkinPhotoFile = file;
        drawing.statusMessage.textContent = 'Loading skin photo...';
        drawing.loadTextureAndImage(file, (tex, img) => {
            const ar = img.width / img.height;
            const canvasAr = drawing.canvas.clientWidth / drawing.canvas.clientHeight;
            let w = 100, h = 100;
            const cameraZ = drawing.camera.position.z;
            const vFOV = drawing.camera.fov * THREE.MathUtils.DEG2RAD;
            const totalHeight = 2 * Math.tan(vFOV / 2) * cameraZ;
            const totalWidth = totalHeight * drawing.camera.aspect;
            if (ar > canvasAr) { w = totalWidth; h = w / ar; }
            else { h = totalHeight; w = h * ar; }
            drawing.skinMesh.geometry.dispose();
            drawing.skinMesh.geometry = new THREE.PlaneGeometry(w, h);
            drawing.skinMesh.material.map = tex;
            drawing.skinMesh.material.color.set(0xffffff);
            drawing.skinMesh.material.needsUpdate = true;
            drawing.skinMesh.position.set(0, 0, 0);
            drawing.statusMessage.textContent = 'Skin photo loaded. Now upload tattoo!';
        });
    },

    handleTattooUpload: (file) => {
        drawing.uploadedTattooDesignFile = file;
        drawing.statusMessage.textContent = 'Loading tattoo design...';
        drawing.loadTexture AndImage(file, (tex, img) => {
            drawing.uploadedTattooDesignImg = img;
            drawing.updateTattooDisplay();
            drawing.setAngle(0);
            drawing.setSize(1);
            drawing.tattooMesh.visible = true;
            document.getElementById('captureMaskBtn').disabled = false;
            drawing.tattooControlsDiv.style.display = 'flex';
            drawing.statusMessage.textContent = 'Tattoo loaded! Drag to move, Shift+Drag to scale, use slider for 2D angle.';
        });
    },

    updateTattooDisplay: () => { /* existing code... */ },
    setAngle: v => { /* existing code... */ },
    handleAngleSliderChange: () => { /* existing code... */ },
    handleAngleInputChange: () => { /* existing code... */ },
    setSize: v => { /* existing code... */ },
    handleSizeSliderChange: () => { /* existing code... */ },
    handleSizeInputChange: () => { /* existing code... */ },
    resetTattooTransform: () => { /* existing code... */ },
    getNormalizedPointerCoords: event => { /* existing code... */ },
    onPointerDown: event => { /* existing code... */ },
    onPointerMove: event => { /* existing code... */ },
    onPointerUp: () => { /* existing code... */ },
    captureMask: async () => { /* existing code... */ }
};

// Expose the drawing object globally so index.html can access it
window.drawing = drawing;
