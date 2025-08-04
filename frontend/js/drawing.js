// frontend/js/drawing.js
import * as THREE from 'three';
// --- Interaction variables (Declared globally for the module) ---
let isDragging = false;
let dragMode = 'none'; // 'none', 'translate', 'scale'
const raycaster = new THREE.Raycaster(); // Used for detecting clicks on 3D objects
const pointer = new THREE.Vector2(); // Stores normalized mouse/touch coordinates
let dragOffset = new THREE.Vector3(); // Stores offset for smooth dragging (translation)
let initialScale = 1; // Stores tattooMesh scale at the start of a scaling gesture/drag
let initialPinchDistance = 0; // For touch-based pinch scaling

const drawing = { 

        // --- THREE.js Core Variables ---
    canvas: null, // This will be the main 3D canvas
    renderer: null,
    scene: null,
    camera: null,
    skinMesh: null, // 3D plane for the skin photo
    tattooMesh: null, // 3D plane for the tattoo silhouette

    // --- Image Storage ---
    uploadedSkinPhotoFile: null, // Original File object for skin (for Flux)
    uploadedTattooDesignFile: null, // Original File object for tattoo (for Flux)
    uploadedTattooDesignImg: null, // Original Image object (HTMLImageElement) for 2D manipulations

    // --- UI Element References ---
    statusMessage: null,
    angleSlider: null,
    angleInput: null,
    sizeSlider: null,
    sizeInput: null,
    resetTattooTransformBtn: null, // New reset button for 3D transform
    tattooControlsDiv: null, // Container for angle/size sliders

    init: (imageUrl) => { // imageUrl here is actually the resized skin photo DataURL
    // --- Get UI element references ---
    drawing.canvas = document.getElementById('main3DCanvas'); // Use the new 3D canvas ID
    drawing.statusMessage = document.getElementById('statusMessage');
    drawing.angleSlider = document.getElementById('angleSlider');
    drawing.angleInput = document.getElementById('angleInput');
    drawing.sizeSlider = document.getElementById('sizeSlider');
    drawing.sizeInput = document.getElementById('sizeInput');
    drawing.resetTattooTransformBtn = document.getElementById('resetTattooTransformBtn');
    drawing.tattooControlsDiv = document.getElementById('tattooControls'); // Container for angle/size sliders

    // --- Initialize THREE.js Scene ---
    drawing.renderer = new THREE.WebGLRenderer({ canvas: drawing.canvas, antialias: true, alpha: true });
    drawing.renderer.setSize(window.innerWidth, window.innerHeight);
    drawing.renderer.setPixelRatio(window.devicePixelRatio); 

    drawing.scene = new THREE.Scene();
    drawing.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    drawing.camera.position.z = 100; // Position camera back from the origin

    // Lights
    drawing.scene.add(new THREE.AmbientLight(0xffffff, 0.7)); // Soft ambient light
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(1, 1, 1).normalize();
    drawing.scene.add(dirLight);

    // Skin Plane (will load actual image via handleSkinUpload later)
    drawing.skinMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100), // Initial size, will be updated
        new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide })
    );
    drawing.skinMesh.position.z = 0;
    drawing.scene.add(drawing.skinMesh);

    // Tattoo Plane (hidden initially)
    drawing.tattooMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40), // Initial size, will be updated
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.99, side: THREE.DoubleSide })
    );
    drawing.tattooMesh.position.z = 1; // Slightly in front of skin
    drawing.tattooMesh.visible = false;
    drawing.scene.add(drawing.tattooMesh);

    // Render loop (continuous for smooth updates)
    drawing.renderer.setAnimationLoop(() => {
        drawing.renderer.render(drawing.scene, drawing.camera);
    });

    drawing.setupEventListeners();
    drawing.statusMessage.textContent = 'Upload Skin Photo and Tattoo Design.';

    // Hide the old 2D drawing section and its old continue button
    const drawingSection = document.getElementById('drawingSection');
    if (drawingSection) drawingSection.style.display = 'none'; 
    const oldContinueBtn = document.getElementById('continueBtn'); // Old ID for continue button
    if (oldContinueBtn) oldContinueBtn.style.display = 'none'; 
},

   setupEventListeners: () => {
    window.addEventListener('resize', drawing.onWindowResize); // Use the new resize handler

    // File Uploads (event listeners are added in index.html, but methods defined here)
    // They are handled by your existing main inline script, which will call drawing.handleSkinUpload etc.

    // Angle and Size Sliders
    drawing.angleSlider.addEventListener('input', drawing.handleAngleSliderChange);
    drawing.angleInput.addEventListener('change', drawing.handleAngleInputChange);
    drawing.sizeSlider.addEventListener('input', drawing.handleSizeSliderChange);
    drawing.sizeInput.addEventListener('change', drawing.handleSizeInputChange);
    drawing.resetTattooTransformBtn.addEventListener('click', drawing.resetTattooTransform);

    // Mask Capture Button (its ID is now 'captureMaskBtn')
    document.getElementById('captureMaskBtn').addEventListener('click', drawing.captureMask);

    // --- Mouse & Touch Interaction for Dragging and Scaling ---
    drawing.canvas.addEventListener('pointerdown', drawing.onPointerDown);
    drawing.canvas.addEventListener('pointermove', drawing.onPointerMove);
    drawing.canvas.addEventListener('pointerup', drawing.onPointerUp);
    drawing.canvas.addEventListener('pointerleave', drawing.onPointerUp); // End drag if pointer leaves canvas

    // Hide tattoo controls initially
    drawing.tattooControlsDiv.style.display = 'none';
},

  
};

// Expose the drawing object globally so index.html can access it
window.drawing = drawing;
