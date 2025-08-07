import * as THREE from 'three';

const drawing = {
    renderer: null,
    scene: null,
    camera: null,
    skinMesh: null,
    tattooMesh: null,
    isDragging: false,
    dragOffset: new THREE.Vector3(),
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    selectedArea: null,

    init: (skinImageUrl, tattooImageUrl) => {
        // --- Renderer & Scene ---
        const canvas = document.getElementById('drawingCanvas');
        if (!canvas) {
            console.error("DEBUG: drawingCanvas not found!");
            return;
        }
        drawing.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        drawing.renderer.setSize(600, 450); // Initial size, will be adjusted
        drawing.scene = new THREE.Scene();
        drawing.scene.background = new THREE.Color(0xeeeeee);

        // --- Camera & Light ---
        drawing.camera = new THREE.PerspectiveCamera(75, 600 / 450, 0.1, 1000);
        drawing.camera.position.z = 100;
        drawing.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

        // --- Skin & Tattoo meshes ---
        drawing.skinMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide })
        );
        drawing.scene.add(drawing.skinMesh);

        drawing.tattooMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(50, 50),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, side: THREE.DoubleSide })
        );
        drawing.tattooMesh.visible = false;
        drawing.tattooMesh.position.z = 1; // Ensure tattoo is in front of skin
        drawing.scene.add(drawing.tattooMesh);

        // --- Load Textures ---
        drawing.loadTexture(skinImageUrl, (tex, img) => {
            const ar = img.width / img.height;
            const canvasWidth = 600;
            const canvasHeight = canvasWidth / ar;

            drawing.renderer.setSize(canvasWidth, canvasHeight);
            drawing.camera.aspect = canvasWidth / canvasHeight;
            drawing.camera.updateProjectionMatrix();

            // Adjust camera position to fit image
            const vFOV = THREE.MathUtils.degToRad(drawing.camera.fov);
            const height = 2 * Math.tan(vFOV / 2) * 100;
            const width = height * drawing.camera.aspect;

            drawing.skinMesh.geometry.dispose();
            drawing.skinMesh.geometry = new THREE.PlaneGeometry(width, height);
            drawing.skinMesh.material.map = tex;
            drawing.skinMesh.material.color.set(0xffffff);
            drawing.skinMesh.material.needsUpdate = true;
        });

        drawing.loadTexture(tattooImageUrl, (tex, img) => {
            const ar = img.width / img.height;
            const tattooHeight = 50; // Base size
            const tattooWidth = tattooHeight * ar;

            drawing.tattooMesh.geometry.dispose();
            drawing.tattooMesh.geometry = new THREE.PlaneGeometry(tattooWidth, tattooHeight);
            drawing.tattooMesh.material.map = tex;
            drawing.tattooMesh.visible = true;
            drawing.tattooMesh.material.needsUpdate = true;
        });

        // --- Animation loop ---
        drawing.renderer.setAnimationLoop(() => drawing.renderer.render(drawing.scene, drawing.camera));

        document.getElementById('drawingSection').style.display = 'block';
        document.getElementById('drawingSection').scrollIntoView({ behavior: 'smooth' });

        drawing.setupEventListeners();
    },

    loadTexture: (url, cb) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            cb(tex, img);
        };
        img.src = url;
    },

    setupEventListeners: () => {
        const canvas = drawing.renderer.domElement;
        const rotationSlider = document.getElementById('rotationSlider');
        const sizeSlider = document.getElementById('sizeSlider');
        const rotationValue = document.getElementById('rotationValue');
        const sizeValue = document.getElementById('sizeValue');

        // Sliders
        rotationSlider.addEventListener('input', (e) => {
            const angle = parseInt(e.target.value, 10);
            drawing.tattooMesh.rotation.z = THREE.MathUtils.degToRad(angle);
            rotationValue.textContent = `${angle}°`;
        });
        sizeSlider.addEventListener('input', (e) => {
            const scale = parseFloat(e.target.value) / 100;
            drawing.tattooMesh.scale.set(scale, scale, scale);
            sizeValue.textContent = `${Math.round(scale * 100)}%`;
        });

        // Dragging
        canvas.addEventListener('pointerdown', drawing.onPointerDown);
        canvas.addEventListener('pointermove', drawing.onPointerMove);
        canvas.addEventListener('pointerup', drawing.onPointerUp);
        canvas.addEventListener('pointerleave', drawing.onPointerUp);
    },

    onPointerDown: (event) => {
        if (event.button !== 0) return;
        const pointer = drawing.pointer;
        pointer.x = (event.offsetX / drawing.renderer.domElement.clientWidth) * 2 - 1;
        pointer.y = -(event.offsetY / drawing.renderer.domElement.clientHeight) * 2 + 1;

        drawing.raycaster.setFromCamera(pointer, drawing.camera);
        const intersects = drawing.raycaster.intersectObject(drawing.tattooMesh);

        if (intersects.length > 0) {
            drawing.isDragging = true;
            const intersectPoint = intersects[0].point;
            drawing.dragOffset.copy(intersectPoint).sub(drawing.tattooMesh.position);
        }
    },

    onPointerMove: (event) => {
        if (!drawing.isDragging) return;
        const pointer = drawing.pointer;
        pointer.x = (event.offsetX / drawing.renderer.domElement.clientWidth) * 2 - 1;
        pointer.y = -(event.offsetY / drawing.renderer.domElement.clientHeight) * 2 + 1;

        drawing.raycaster.setFromCamera(pointer, drawing.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -drawing.tattooMesh.position.z);
        const intersect = new THREE.Vector3();

        if (drawing.raycaster.ray.intersectPlane(plane, intersect)) {
            drawing.tattooMesh.position.copy(intersect).sub(drawing.dragOffset);
        }
    },

    onPointerUp: () => {
        drawing.isDragging = false;
    },

    updateMask: () => {
        return new Promise((resolve) => {
            console.log("DEBUG: updateMask started.");
            if (!drawing.renderer || !drawing.originalImage || !drawing.skinMesh) {
                console.error("DEBUG: Cannot generate mask: components not initialized.");
                return resolve();
            }

            // Get the dimensions of the plane in the 3D scene
            const planeWidth = drawing.skinMesh.geometry.parameters.width;
            const planeHeight = drawing.skinMesh.geometry.parameters.height;

            // Get the dimensions of the original (resized) skin image
            const maskWidth = drawing.originalImage.width;
            const maskHeight = drawing.originalImage.height;

            console.log(`DEBUG: Generating mask with dimensions: ${maskWidth}x${maskHeight}`);

            // 1. Create an orthographic camera that looks at the 3D plane
            const orthoCamera = new THREE.OrthographicCamera(-planeWidth / 2, planeWidth / 2, planeHeight / 2, -planeHeight / 2, 1, 1000);
            orthoCamera.position.z = 100;

            // 2. Create a temporary scene for mask rendering
            const maskScene = new THREE.Scene();
            maskScene.background = new THREE.Color(0x000000); // Black background

            // 3. Clone the tattoo mesh and give it a pure white material
            const maskTattoo = drawing.tattooMesh.clone();
            maskTattoo.material = new THREE.MeshBasicMaterial({ color: 0xffffff });

            maskScene.add(maskTattoo);

            // 5. Render the mask scene to a render target of the correct size
            const currentRenderTarget = drawing.renderer.getRenderTarget();
            const renderTarget = new THREE.WebGLRenderTarget(maskWidth, maskHeight);
            drawing.renderer.setRenderTarget(renderTarget);
            drawing.renderer.render(maskScene, orthoCamera);

            // 6. Read the pixels from the render target
            const pixels = new Uint8Array(maskWidth * maskHeight * 4);
            drawing.renderer.readRenderTargetPixels(renderTarget, 0, 0, maskWidth, maskHeight, pixels);

            // Create a 2D canvas to transfer the pixels to
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = maskWidth;
            tempCanvas.height = maskHeight;
            const ctx = tempCanvas.getContext('2d');
            const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), maskWidth, maskHeight);

            // The image is flipped vertically from WebGL, so we need to flip it back
            createImageBitmap(imageData).then(bitmap => {
                ctx.scale(1, -1);
                ctx.translate(0, -maskHeight);
                ctx.drawImage(bitmap, 0, 0);

                // 7. Get the final Data URL
                drawing.selectedArea = tempCanvas.toDataURL('image/png');
                console.log("DEBUG: Mask generated and stored.");

                // 8. Clean up and restore original state
                drawing.renderer.setRenderTarget(currentRenderTarget);
                renderTarget.dispose();

                resolve();
            });
        });
    },

    clearCanvas: () => {
        if (drawing.renderer) {
            drawing.renderer.setAnimationLoop(null);
            drawing.renderer.dispose();
            drawing.renderer = null;
        }
        drawing.scene = null;
        drawing.camera = null;
        drawing.skinMesh = null;
        drawing.tattooMesh = null;
        drawing.selectedArea = null;
    }
};

window.drawing = drawing;
