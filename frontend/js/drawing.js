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

        setTimeout(() => {
            // --- Core setup (deferred slightly to avoid paint jank) ---
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

            // --- Option 2: If a skin file was preloaded before init(), apply it now ---
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

    // ... rest of your functions unchanged ...

};

// Expose the drawing object globally
window.drawing = drawing;
