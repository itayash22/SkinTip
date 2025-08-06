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
        // Deferring initialization to ensure canvas dimensions are available
        setTimeout(() => {
            // --- Get UI element references ---
            drawing.canvas = document.getElementById('main3DCanvas');
            drawing.statusMessage = document.getElementById('statusMessage');
            drawing.angleSlider = document.getElementById('angleSlider');
            drawing.angleInput = document.getElementById('angleInput');
            drawing.sizeSlider = document.getElementById('sizeSlider');
            drawing.sizeInput = document.getElementById('sizeInput');
            drawing.resetTattooTransformBtn = document.getElementById('resetTattooTransformBtn');
            drawing.tattooControlsDiv = document.getElementById('tattooControls');

            // --- Initialize THREE.js Scene ---
            drawing.renderer = new THREE.WebGLRenderer({ canvas: drawing.canvas, antialias: true, alpha: true });
            drawing.renderer.setSize(drawing.canvas.clientWidth, drawing.canvas.clientHeight);
            drawing.renderer.setPixelRatio(window.devicePixelRatio);

            drawing.scene = new THREE.Scene();
            drawing.camera = new THREE.PerspectiveCamera(75, drawing.canvas.clientWidth / drawing.canvas.clientHeight, 0.1, 1000);
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

            // Render loop
            drawing.renderer.setAnimationLoop(() => {
                drawing.renderer.render(drawing.scene, drawing.camera);
            });

            drawing.setupEventListeners();
            drawing.statusMessage.textContent = 'Upload Skin Photo and Tattoo Design.';

            const drawingSection = document.getElementById('drawingSection');
            if (drawingSection) drawingSection.style.display = 'block';
            const oldDrawingCanvas = document.getElementById('drawingCanvas');
            if (oldDrawingCanvas) oldDrawingCanvas.style.display = 'none';
            const oldContinueBtn = document.getElementById('continueBtn');
            if (oldContinueBtn) oldContinueBtn.style.display = 'none';
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

// --- Helper Functions ---
loadTextureAndImage: (file, cb) => {
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const texture = new THREE.TextureLoader().load(e.target.result, undefined, undefined, (err) => console.error('Error loading texture:', err));
            texture.colorSpace = THREE.SRGBColorSpace;
            cb(texture, img);
        };
    };
    reader.readAsDataURL(file);
},

// --- Window Resize Handler ---
onWindowResize: () => {
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

// --- UI Event Handlers ---
handleSkinUpload: (file) => {
    drawing.uploadedSkinPhotoFile = file; 
    drawing.statusMessage.textContent = 'Loading skin photo...';

    drawing.loadTextureAndImage(drawing.uploadedSkinPhotoFile, (tex, img) => {
        const ar = img.width / img.height;
        const canvasAr = drawing.canvas.clientWidth / drawing.canvas.clientHeight;

        let w = 100, h = 100;
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

handleTattooUpload: (file) => {
    drawing.uploadedTattooDesignFile = file; 
    drawing.statusMessage.textContent = 'Loading tattoo design...';

    drawing.loadTextureAndImage(drawing.uploadedTattooDesignFile, (tex, img) => {
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

updateTattooDisplay: () => { 
    if (!drawing.uploadedTattooDesignImg) return;

    const img = drawing.uploadedTattooDesignImg;
    const offscreenCanvas = document.createElement('canvas');
    const ctx = offscreenCanvas.getContext('2d');

    offscreenCanvas.width = img.width;
    offscreenCanvas.height = img.height;

    ctx.drawImage(img, 0, 0);

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

    const newAspectRatio = offscreenCanvas.width / offscreenCanvas.height;
    const currentBasePlaneWidth = 40;
    drawing.tattooMesh.geometry.dispose(); 
    drawing.tattooMesh.geometry = new THREE.PlaneGeometry(currentBasePlaneWidth, currentBasePlaneWidth / newAspectRatio);
},

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
    value = Math.max(0.1, Math.min(3, value));
    drawing.setSize(value);
},

resetTattooTransform: () => {
    drawing.setAngle(0);
    drawing.setSize(1);
    drawing.tattooMesh.position.set(0, 0, 1);
},

// --- Mouse/Touch Interaction ---
getNormalizedPointerCoords: (event) => {
    const rect = drawing.canvas.getBoundingClientRect();
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;
    
    pointer.x = ((clientX - rect.left) / drawing.canvas.clientWidth) * 2 - 1;
    pointer.y = -(((clientY - rect.top) / drawing.canvas.clientHeight) * 2 - 1);
    return pointer;
},

onPointerDown: (event) => {
    if ((event.button === 0 || event.type === 'touchstart') && drawing.tattooMesh.visible) {
        drawing.getNormalizedPointerCoords(event);
        raycaster.setFromCamera(pointer, drawing.camera);

        const intersects = raycaster.intersectObject(drawing.tattooMesh, false);

        if (intersects.length > 0) {
            isDragging = true;
            drawing.canvas.style.cursor = 'grabbing';

            const intersectPoint = new THREE.Vector3();
            const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), -drawing.tattooMesh.position.z);
            raycaster.ray.intersectPlane(planeZ, intersectPoint);
            
            dragOffset.copy(intersectPoint).sub(drawing.tattooMesh.position);

            if (event.shiftKey || (event.touches && event.touches.length > 1)) {
                dragMode = 'scale';
                initialScale = drawing.tattooMesh.scale.x;
                if (event.touches && event.touches.length > 1) {
                    const dx = event.touches[0].clientX - event.touches[1].clientX;
                    const dy = event.touches[0].clientY - event.touches[1].clientY;
                    initialPinchDistance = Math.hypot(dx, dy);
                }
            } else {
                dragMode = 'translate';
            }
            event.preventDefault();
        }
    }
},

onPointerMove: (event) => {
    if (!isDragging || !drawing.tattooMesh.visible) return;
    const localPointer = drawing.getNormalizedPointerCoords(event);
    
    if (dragMode === 'translate') {
        raycaster.setFromCamera(localPointer, drawing.camera);
        const currentTattooPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -drawing.tattooMesh.position.z);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(currentTattooPlane, intersectPoint);
        
        if (intersectPoint) {
            drawing.tattooMesh.position.copy(intersectPoint).sub(dragOffset);
        }

    } else if (dragMode === 'scale') {
        if (event.touches && event.touches.length > 1) {
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            const currentPinchDistance = Math.hypot(dx, dy);
            if (initialPinchDistance > 0) {
                const scaleFactor = currentPinchDistance / initialPinchDistance;
                let newScale = initialScale * scaleFactor;
                newScale = Math.max(parseFloat(drawing.sizeSlider.min), Math.min(parseFloat(drawing.sizeSlider.max), newScale));
                drawing.setSize(newScale);
            }
        } else {
            const sensitivity = 0.005;
            // The 'offset' variable was an error. We use the initial pointer Y from onPointerDown.
            // Re-using dragOffset from onPointerDown for a relative y-movement calculation.
            const startY = dragOffset.y;
            const scaleFactor = 1 + (localPointer.y - startY) * sensitivity;
            let newScale = initialScale * scaleFactor;

            newScale = Math.max(parseFloat(drawing.sizeSlider.min), Math.min(parseFloat(drawing.sizeSlider.max), newScale));
            drawing.setSize(newScale);
        }
    }
    event.preventDefault();
},

onPointerUp: () => {
    isDragging = false;
    dragMode = 'none';
    drawing.canvas.style.cursor = 'grab';
    dragOffset.set(0, 0, 0);
    initialScale = drawing.tattooMesh.scale.x;
},

// --- Mask Capture (Modified to generate rotated/scaled tattoo for Flux) ---
captureMask: async () => {
    if (!drawing.tattooMesh.visible || !drawing.skinMesh.material.map || !drawing.uploadedTattooDesignImg) {
        drawing.statusMessage.textContent = 'Error: Upload both skin photo and tattoo first.';
        return;
    }

    drawing.statusMessage.textContent = 'Capturing mask...';
    
    // Create a new offscreen canvas for the final mask, matching the skin image dimensions
    const skinImg = drawing.skinMesh.material.map.image;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = skinImg.width;
    maskCanvas.height = skinImg.height;
    const maskCtx = maskCanvas.getContext('2d');
    
    // Get the tattoo's current position, rotation, and scale from the THREE.js mesh
    const tattooMeshWorldPosition = new THREE.Vector3();
    drawing.tattooMesh.getWorldPosition(tattooMeshWorldPosition);
    const tattooRotationZ = drawing.tattooMesh.rotation.z;
    const tattooScale = drawing.tattooMesh.scale.x;

    // Project the 3D position to 2D screen coordinates to get pixel position
    const screenPos = tattooMeshWorldPosition.clone().project(drawing.camera);
    const canvasRect = drawing.canvas.getBoundingClientRect();
    const pixelX = (screenPos.x * 0.5 + 0.5) * canvasRect.width;
    const pixelY = (-screenPos.y * 0.5 + 0.5) * canvasRect.height;
    
    // Draw the tattoo image onto the mask canvas with its current position, rotation, and scale
    const img = drawing.uploadedTattooDesignImg;
    const scaledWidth = img.width * tattooScale;
    const scaledHeight = img.height * tattooScale;
    
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.translate(pixelX, pixelY);
    maskCtx.rotate(tattooRotationZ);
    maskCtx.drawImage(img, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
    maskCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

    // Convert the mask to a silhouette (white on transparent)
    const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha > 50) { 
            data[i] = 255; // White
            data[i + 1] = 255; 
            data[i + 2] = 255;
            data[i + 3] = 255;
        } else {
            data[i] = 0;   // Transparent
            data[i + 1] = 0; 
            data[i + 2] = 0;
            data[i + 3] = 0;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    
    // Get the mask blob
    const maskBlob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'));
    console.log('Generated Mask Blob (from 3D view):', maskBlob);

    // Prepare the original tattoo image, without transformations, for Flux.
    // The backend now expects the original, non-scaled image.
    const originalTattooBlob = await (await fetch(drawing.uploadedTattooDesignImg.src)).blob();
    
    // Update STATE with the new mask and original tattoo design
    window.STATE.currentMask = maskBlob;
    window.STATE.uploadedTattooDesignFile = originalTattooBlob;

    drawing.statusMessage.textContent = 'Masks generated! Ready to send.';
    
    // The main script will pick up these blobs from the global STATE object
    return { mask: maskBlob, tattooDesign: originalTattooBlob };
},

};

// Expose the drawing object globally so index.html can access it
window.drawing = drawing;
