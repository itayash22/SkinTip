import * as THREE from 'three';

/* ============================================================
   Client-side white → alpha knockout for preview
   - Detects near-uniform white and converts it to transparency
   - Preserves edges to avoid chewing through linework
   - Decontaminates RGB to remove white halos
   Returns a dataURL('image/png')
   ============================================================ */
async function knockoutWhiteToAlphaClient(imageOrDataURL, opts = {}) {
    const soft = opts.soft ?? 235;   // start fading above this
    const hard = opts.hard ?? 252;   // fully transparent above this
    const edgeT = opts.edgeT ?? 20;  // edge threshold

    const img = await new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = typeof imageOrDataURL === 'string'
            ? imageOrDataURL
            : URL.createObjectURL(imageOrDataURL);
    });

    const w = img.naturalWidth, h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    // Quick uniform-white check from the four corners
    function cornerStats(x, y, size) {
        const d = ctx.getImageData(x, y, size, size).data;
        let r=0,g=0,b=0, n = size*size;
        for (let i=0;i<n;i++){ r+=d[i*4]; g+=d[i*4+1]; b+=d[i*4+2]; }
        return [r/n, g/n, b/n];
    }
    const s = Math.max(4, Math.floor(Math.min(w, h) * 0.05));
    const c1 = cornerStats(0,0,s), c2 = cornerStats(w-s,0,s),
          c3 = cornerStats(0,h-s,s), c4 = cornerStats(w-s,h-s,s);
    const mean = [
        (c1[0]+c2[0]+c3[0]+c4[0])/4,
        (c1[1]+c2[1]+c3[1]+c4[1])/4,
        (c1[2]+c2[2]+c3[2]+c4[2])/4
    ];
    const nearWhite = (mean[0] >= 242 && mean[1] >= 242 && mean[2] >= 242);

    // If not near-white, just return original (backend will handle complex cases)
    if (!nearWhite) {
        return canvas.toDataURL('image/png');
    }

    // Pixel buffers
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Build crude edge mask (3x3 Laplacian on luminance) to protect lines
    const gray = new Uint8ClampedArray(w*h);
    for (let i=0, p=0; i<gray.length; i++, p+=4) {
        const R=d[p], G=d[p+1], B=d[p+2];
        gray[i] = (0.2126*R + 0.7152*G + 0.0722*B) | 0;
    }
    const edge = new Uint8ClampedArray(w*h);
    const k = [0,-1,0,-1,4,-1,0,-1,0];
    for (let y=1; y<h-1; y++){
        for (let x=1; x<w-1; x++){
            let acc=0, idx = y*w+x, i=0;
            for (let ky=-1; ky<=1; ky++){
                for (let kx=-1; kx<=1; kx++){
                    acc += gray[idx + ky*w + kx] * k[i++];
                }
            }
            edge[idx] = acc > edgeT ? 255 : 0;
        }
    }

    // Color-to-alpha with decontamination (remove white matte)
    const ramp = Math.max(1, hard - soft);
    const bgR = mean[0], bgG = mean[1], bgB = mean[2];

    for (let i=0, p=0; i<w*h; i++, p+=4) {
        const R=d[p], G=d[p+1], B=d[p+2], A=d[p+3];
        const wmax = Math.max(R,G,B);
        let alpha = A;

        if (wmax >= soft) {
            const cut = Math.max(0, Math.min(1, (wmax - soft) / ramp)); // 0..1
            alpha = Math.round(A * (1 - cut));
            if (wmax >= hard) alpha = 0;
        }
        // Preserve edges (don’t erase lines)
        if (edge[i] === 255) alpha = Math.max(alpha, A);

        // Decontaminate RGB from white matte: F=(C-(1-a)*bg)/a
        if (alpha > 0 && alpha < 255) {
            const a = alpha / 255;
            d[p  ] = Math.max(0, Math.min(255, Math.round((R - (1 - a) * bgR) / a)));
            d[p+1] = Math.max(0, Math.min(255, Math.round((G - (1 - a) * bgG) / a)));
            d[p+2] = Math.max(0, Math.min(255, Math.round((B - (1 - a) * bgB) / a)));
        }
        d[p+3] = alpha;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
}

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
    originalImage: null,

    init: (skinImageUrl, tattooImageUrl) => {
        // --- Renderer & Scene ---
        const canvas = document.getElementById('drawingCanvas');
        if (!canvas) {
            console.error("DEBUG: drawingCanvas not found!");
            return;
        }
        drawing.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
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
            drawing.originalImage = img; // Store the original image element
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

        // IMPORTANT: for the tattoo we first knock out white → transparent (preview-only)
        drawing.loadTattooTexture(tattooImageUrl, (tex, img) => {
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

    // NEW: tattoo loader that runs client-side white→alpha before creating the texture
    loadTattooTexture: (url, cb) => {
        (async () => {
            try {
                const cleanedDataUrl = await knockoutWhiteToAlphaClient(url);
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    const tex = new THREE.Texture(img);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.needsUpdate = true;
                    cb(tex, img);
                };
                img.src = cleanedDataUrl;
            } catch (e) {
                console.warn('CTA preview cleanup failed, using original tattoo image:', e);
                // Fallback: load original
                drawing.loadTexture(url, cb);
            }
        })();
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

            const planeWidth = drawing.skinMesh.geometry.parameters.width;
            const planeHeight = drawing.skinMesh.geometry.parameters.height;
            const maskWidth = drawing.originalImage.width;
            const maskHeight = drawing.originalImage.height;

            console.log(`DEBUG: Generating mask with dimensions: ${maskWidth}x${maskHeight}`);

            const orthoCamera = new THREE.OrthographicCamera(-planeWidth / 2, planeWidth / 2, planeHeight / 2, -planeHeight / 2, 1, 1000);
            orthoCamera.position.z = 100;

            const maskScene = new THREE.Scene();
            // The background is intentionally left transparent

            // Clone the tattoo mesh, but use its original material (with the texture)
            const maskTattoo = drawing.tattooMesh.clone();

            // Manually copy transformations to the clone (position and scale, but not rotation)
            maskTattoo.position.copy(drawing.tattooMesh.position);
            maskTattoo.rotation.set(0, 0, 0);
            maskTattoo.scale.copy(drawing.tattooMesh.scale);

            maskScene.add(maskTattoo);

            const currentRenderTarget = drawing.renderer.getRenderTarget();
            const renderTarget = new THREE.WebGLRenderTarget(maskWidth, maskHeight);
            drawing.renderer.setRenderTarget(renderTarget);

            // Clear the render target to transparent before rendering
            drawing.renderer.setClearColor(0x000000, 0);
            drawing.renderer.clear();

            drawing.renderer.render(maskScene, orthoCamera);

            const pixels = new Uint8Array(maskWidth * maskHeight * 4);
            drawing.renderer.readRenderTargetPixels(renderTarget, 0, 0, maskWidth, maskHeight, pixels);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = maskWidth;
            tempCanvas.height = maskHeight;
            const ctx = tempCanvas.getContext('2d');
            const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), maskWidth, maskHeight);

            createImageBitmap(imageData).then(bitmap => {
                ctx.scale(1, -1);
                ctx.translate(0, -maskHeight);
                ctx.drawImage(bitmap, 0, 0);

                drawing.selectedArea = tempCanvas.toDataURL('image/png');
                console.log("DEBUG: Mask with transformed texture generated and stored.");
                console.log(`DEBUG: Generated Mask Data URL: ${drawing.selectedArea}`);

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
