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

// --- Helper Functions ---
loadTextureAndImage: (file, cb) => {
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const texture = new THREE.TextureLoader().load(e.target.result, undefined, undefined, (err) => console.error('Error loading texture:', err));
            texture.colorSpace = THREE.SRGBColorSpace;
            cb(texture, img); // Pass both texture and original image object
        };
    };
    reader.readAsDataURL(file);
},

// --- Window Resize Handler ---
onWindowResize: () => {
    drawing.camera.aspect = window.innerWidth / window.innerHeight;
    drawing.camera.updateProjectionMatrix();
    drawing.renderer.setSize(window.innerWidth, window.innerHeight);

    if (drawing.skinMesh.material.map && drawing.skinMesh.material.map.image) {
        const img = drawing.skinMesh.material.map.image;
        const aspectRatio = img.width / img.height;
        const canvasAspectRatio = window.innerWidth / window.innerHeight;

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

// --- UI Event Handlers ---
handleSkinUpload: (e) => { // This will be called by index.html's handleSkinPhotoFile
    if (!e.target.files.length) return;
    drawing.uploadedSkinPhotoFile = e.target.files[0]; 
    drawing.statusMessage.textContent = 'Loading skin photo...';

    drawing.loadTextureAndImage(drawing.uploadedSkinPhotoFile, (tex, img) => {
        const ar = img.width / img.height;
        const canvasAr = window.innerWidth / window.innerHeight;

        let w = 100, h = 100; // Default values for world units
        const cameraZ = drawing.camera.position.z;
        const vFOV = drawing.camera.fov * THREE.MathUtils.DEG2RAD;
        const totalHeight = 2 * Math.tan(vFOV / 2) * cameraZ;
        const totalWidth = totalHeight * drawing.camera.aspect;

        if (ar > canvasAr) { 
            w = totalWidth;
            h = w / ar;
        } else { 
            h = totalHeight;
            w = h * ar;
        }
        
        drawing.skinMesh.geometry.dispose();
        drawing.skinMesh.geometry = new THREE.PlaneGeometry(w, h);
        drawing.skinMesh.material.map = tex;
        drawing.skinMesh.material.color.set(0xffffff); 
        drawing.skinMesh.material.needsUpdate = true;
        drawing.skinMesh.position.set(0, 0, 0); 

        drawing.statusMessage.textContent = 'Skin photo loaded. Now upload tattoo!';
    });
},

handleTattooUpload: (e) => { // This handles the tattoo design file (called by index.html's handleTattooDesignFile)
    if (!e.target.files.length) return;
    drawing.uploadedTattooDesignFile = e.target.files[0]; 
    drawing.statusMessage.textContent = 'Loading tattoo design...';

    drawing.loadTextureAndImage(drawing.uploadedTattooDesignFile, (tex, img) => {
        drawing.uploadedTattooDesignImg = img; // Store the original Image object
        
        // Initialize tattoo display with current angle (0) and size (1)
        drawing.updateTattooDisplay(); 
        drawing.setAngle(0); // This sets the Z rotation on the mesh and updates UI
        drawing.setSize(1);  // This sets the scale on the mesh and updates UI

        tattooMesh.visible = true; // Use tattooMesh directly as it's a top-level var
        // The 'continueBtn' now named 'captureMaskBtn' will be enabled
        document.getElementById('captureMaskBtn').disabled = false; 
        drawing.tattooControlsDiv.style.display = 'flex'; // Show angle/size controls

        drawing.statusMessage.textContent = 'Tattoo loaded! Drag to move, Shift+Drag to scale, use slider for 2D angle.';
    });
},

// Update tattoo texture: now it ONLY converts uploadedTattooDesignImg to silhouette
// It does NOT apply rotation or scaling here. Those are done by tattooMesh.rotation.z and tattooMesh.scale.
updateTattooDisplay: () => { 
    if (!drawing.uploadedTattooDesignImg) return;

    const img = drawing.uploadedTattooDesignImg;
    const offscreenCanvas = document.createElement('canvas');
    const ctx = offscreenCanvas.getContext('2d');

    // Canvas size for silhouette should be original image size, no scaling/rotation applied here
    offscreenCanvas.width = img.width;
    offscreenCanvas.height = img.height;

    ctx.drawImage(img, 0, 0);

    // Generate silhouette (green outline).
    const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha > 50) { 
            data[i] = 0;   
            data[i + 1] = 255; 
            data[i + 2] = 0;   
            data[i + 3] = 255; 
        } else {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0; 
        }
    }
    ctx.putImageData(imageData, 0, 0);

    if (drawing.tattooMesh.material.map) {
        drawing.tattooMesh.material.map.dispose();
    }

    const newTattooTexture = new THREE.CanvasTexture(offscreenCanvas);
    newTattooTexture.colorSpace = THREE.SRGBColorSpace;

    drawing.tattooMesh.material.map = newTattooTexture;
    drawing.tattooMesh.material.needsUpdate = true;

    // Adjust tattooMesh geometry aspect ratio. Scale is handled by tattooMesh.scale.
    const newAspectRatio = offscreenCanvas.width / offscreenCanvas.height;
    const currentBasePlaneWidth = 40; // Consistent base width for the mesh
    drawing.tattooMesh.geometry.dispose(); 
    drawing.tattooMesh.geometry = new THREE.PlaneGeometry(currentBasePlaneWidth, currentBasePlaneWidth / newAspectRatio);
    
    // UI update for angle/size is handled by setAngle/setSize directly
},

// Angle and Size Control Logic
setAngle: (v) => {
    drawing.tattooMesh.rotation.z = THREE.MathUtils.degToRad(v);
    drawing.angleSlider.value = v;
    drawing.angleInput.value = v;
},
handleAngleSliderChange: () => {
    let angle = parseInt(drawing.angleSlider.value);
    drawing.setAngle(angle);
},
handleAngleInputChange: () => {
    let value = parseInt(drawing.angleInput.value);
    if (isNaN(value)) value = 0;
    value = Math.max(-180, Math.min(180, value)); 
    drawing.setAngle(value);
},

setSize: (v) => {
    drawing.tattooMesh.scale.set(v, v, v); 
    drawing.sizeSlider.value = v;
    drawing.sizeInput.value = v;
},
handleSizeSliderChange: () => {
    let size = parseFloat(drawing.sizeSlider.value);
    drawing.setSize(size);
},
handleSizeInputChange: () => {
    let value = parseFloat(drawing.sizeInput.value);
    if (isNaN(value)) value = 1;
    value = Math.max(0.1, Math.min(3, value)); // Clamp to slider's min/max
    drawing.setSize(value);
},

// Reset Angle, Size, and Position
resetTattooTransform: () => {
    drawing.setAngle(0);
    drawing.setSize(1);
    drawing.tattooMesh.position.set(0, 0, 1); // Reset position to initial
},

// --- Mouse/Touch Interaction ---
getNormalizedPointerCoords: (event) => {
    const rect = drawing.canvas.getBoundingClientRect();
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;
    
    pointer.x = ((clientX - rect.left) / drawing.canvas.width) * 2 - 1;
    pointer.y = -(((clientY - rect.top) / drawing.canvas.height) * 2 - 1);
    return pointer;
},

onPointerDown: (event) => {
    // Only allow left mouse button (0) or first touch (touchstart)
    if ((event.button === 0 || event.type === 'touchstart') && drawing.tattooMesh.visible) {
        drawing.getNormalizedPointerCoords(event); // Update pointer vector
        drawing.raycaster.setFromCamera(drawing.pointer, drawing.camera);

        const intersects = drawing.raycaster.intersectObject(drawing.tattooMesh, false); // false for no recursion

        if (intersects.length > 0) {
            isDragging = true;
            drawing.canvas.style.cursor = 'grabbing';

            // Get initial intersection point with the plane of the tattooMesh
            const intersectPoint = new THREE.Vector3();
            const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), -drawing.tattooMesh.position.z); // Plane at tattoo's Z
            drawing.raycaster.ray.intersectPlane(planeZ, intersectPoint);
            
            drawing.dragOffset.copy(intersectPoint).sub(drawing.tattooMesh.position);

            if (event.shiftKey || (event.touches && event.touches.length > 1)) {
                dragMode = 'scale';
                initialScale = drawing.tattooMesh.scale.x; // Store current scale for relative scaling
                // For touch scaling, store initial distance
                if (event.touches && event.touches.length > 1) {
                    const dx = event.touches[0].clientX - event.touches[1].clientX;
                    const dy = event.touches[0].clientY - event.touches[1].clientY;
                    initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
                }
            } else {
                dragMode = 'translate';
            }
            event.preventDefault(); // Prevent browser default (like scrolling/text selection)
        }
    },

    onPointerMove: (event) => {
        if (!isDragging || !drawing.tattooMesh.visible) return;

        drawing.getNormalizedPointerCoords(event); // Update pointer vector

        if (dragMode === 'translate') {
            drawing.raycaster.setFromCamera(drawing.pointer, drawing.camera);
            const currentTattooPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -drawing.tattooMesh.position.z); 
            const intersectPoint = new THREE.Vector3();
            drawing.raycaster.ray.intersectPlane(currentTattooPlane, intersectPoint);
            
            if (intersectPoint) { // Ensure intersectPoint is valid
                drawing.tattooMesh.position.copy(intersectPoint).sub(drawing.dragOffset);
            }

        } else if (dragMode === 'scale') {
            if (event.touches && event.touches.length > 1) {
                // Pinch scale (two fingers)
                const dx = event.touches[0].clientX - event.touches[1].clientX;
                const dy = event.touches[0].clientY - event.touches[1].clientY;
                const currentPinchDistance = Math.hypot(dx, dy); // Use Math.hypot for distance
                if (initialPinchDistance > 0) {
                    const scaleFactor = currentPinchDistance / initialPinchDistance;
                    let newScale = initialScale * scaleFactor;
                    newScale = Math.max(parseFloat(drawing.sizeSlider.min), Math.min(parseFloat(drawing.sizeSlider.max), newScale));
                    drawing.setSize(newScale); // Use setSize to update tattooMesh.scale and UI
                }
            } else {
                // Mouse scale (Shift + Drag vertical movement)
                const sensitivity = 0.005; // Adjust this value for mouse scaling speed
                const currentY = pointer.y; // Current normalized pointer Y
                const startY = offset.y; // Initial normalized Y of click stored in offset (offset here is initial click point)
                
                const scaleFactor = 1 + (currentY - startY) * sensitivity; 
                let newScale = initialScale * scaleFactor;

                newScale = Math.max(parseFloat(drawing.sizeSlider.min), Math.min(parseFloat(drawing.sizeSlider.max), newScale));
                drawing.setSize(newScale); // Use setSize to update tattooMesh.scale and UI
            }
        }
        event.preventDefault(); 
    },

    onPointerUp: () => {
        isDragging = false;
        dragMode = 'none';
        drawing.canvas.style.cursor = 'grab'; 
        drawing.dragOffset.set(0,0,0); 
        initialScale = drawing.tattooMesh.scale.x; // Update initial scale for next drag
    },

    // --- Mask Capture (Modified to generate rotated/scaled tattoo for Flux) ---
    // This is the function called when 'Generate Tattoo on Skin' is clicked.
    // --- Mask Capture (Modified to generate rotated/scaled tattoo for Flux) ---
// This is the function called when 'Generate Tattoo on Skin' is clicked.
captureMask: async () => {
    if (!drawing.tattooMesh.visible || !drawing.skinMesh.material.map || !drawing.uploadedTattooDesignImg) {
        drawing.statusMessage.textContent = 'Error: Upload both skin photo and tattoo first.';
        return null;
    }

    drawing.statusMessage.textContent = 'Capturing mask...';

    // 1. Generate the mask (silhouette of the 3D-positioned tattoo)
    // This process renders the 3D tattooMesh (with its current 3D position, scale, and Z-rotation)
    // to an offscreen 2D canvas, creating the mask.
    const rect = drawing.canvas.getBoundingClientRect();
    const maskRenderTarget = new THREE.WebGLRenderTarget(rect.width, rect.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        encoding: THREE.sRGBEncoding
    });

    // Store original states to restore later
    const originalClearColor = new THREE.Color();
    drawing.renderer.getClearColor(originalClearColor);
    const originalClearAlpha = drawing.renderer.getClearAlpha();
    const originalBackground = drawing.scene.background;
    const originalTattooMaterial = drawing.tattooMesh.material;

    // Set up scene for mask capture (black background, white tattoo)
    drawing.scene.background = null;
    drawing.renderer.setClearColor(0x000000, 0);
    drawing.tattooMesh.material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: false, side: THREE.DoubleSide });
    drawing.skinMesh.visible = false; // Hide skin photo for mask generation

    drawing.renderer.setRenderTarget(maskRenderTarget);
    drawing.renderer.render(drawing.scene, drawing.camera);

    // Read pixels
    const pixelBuffer = new Uint8Array(rect.width * rect.height * 4);
    drawing.renderer.readRenderTargetPixels(maskRenderTarget, 0, 0, rect.width, rect.height, pixelBuffer);

    // Restore renderer and scene state
    drawing.renderer.setRenderTarget(null);
    drawing.tattooMesh.material = originalTattooMaterial;
    drawing.skinMesh.visible = true;
    drawing.scene.background = originalBackground;
    drawing.renderer.setClearColor(originalClearColor, originalClearAlpha);

    // Create 2D canvas for mask Blob
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = rect.width;
    maskCanvas.height = rect.height;
    const maskCtx = maskCanvas.getContext('2d');
    const imageData = maskCtx.createImageData(maskCanvas.width, maskCtx.height);
    imageData.data.set(pixelBuffer);
    maskCtx.putImageData(imageData, 0, 0);

    const maskBlob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'));
    console.log('Generated Mask Blob (from 3D view):', maskBlob);

    // 2. Prepare the original tattoo image, ROTATED AND SCALED, for Flux
    const finalTattooDesignCanvas = document.createElement('canvas');
    const finalTattooDesignCtx = finalTattooDesignCanvas.getContext('2d');
    
    const img = drawing.uploadedTattooDesignImg;
    const angle = parseFloat(drawing.angleInput.value); // Get final angle from UI slider
    const scale = parseFloat(drawing.sizeInput.value); // Get final scale from UI slider (this is the scale factor for the IMAGE CONTENT)

    // Calculate canvas size to accommodate rotated and scaled image
    const finalWidth = img.width * scale;
    const finalHeight = img.height * scale;
    const diagonal = Math.hypot(finalWidth, finalHeight);
    finalTattooDesignCanvas.width = diagonal;
    finalTattooDesignCanvas.height = diagonal;
    
    // Draw rotated and scaled original tattoo image onto new canvas
    finalTattooDesignCtx.translate(finalTattooDesignCanvas.width / 2, finalTattooDesignCanvas.height / 2);
    finalTattooDesignCtx.rotate(angle * THREE.MathUtils.DEG2RAD);
    finalTattooDesignCtx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height); // Draw image without additional scaling
    finalTattooDesignCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

    const finalTattooDesignBlob = await new Promise(resolve => finalTattooDesignCanvas.toBlob(resolve, 'image/png'));
    console.log('Rotated & Scaled Original Tattoo Design Blob (for Flux):', finalTattooDesignBlob);

    // Update STATE with the new mask and tattoo design
    STATE.currentMask = maskBlob; // This should be the mask blob
    STATE.uploadedTattooDesignBase64 = URL.createObjectURL(finalTattooDesignBlob); // This is a temporary URL for the new blob

    drawing.statusMessage.textContent = 'Masks generated! Ready to send.';
    
    // This is where you would return or trigger the main app logic to send the data.
    // The existing 'continueBtn' logic in index.html will pick this up from the STATE object.
    return { mask: maskBlob, tattooDesign: finalTattooDesignBlob };
}
};

// Expose the drawing object globally so index.html can access it
window.drawing = drawing;
