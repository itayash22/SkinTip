// === drawing.js (additions) ================================================

// module-level state (add these near your other state vars)
let canvas, ctx;
let skinImg = null, tattooImg = null; // assume you already set these in init
const camera = { x: 0, y: 0, scale: 1 };
let panMode = false;

let tattoo = {
    x: 0,
    y: 0,
    scale: 1,
    angle: 0,
    width: 0,
    height: 0
};

let pointerDown = false;
let isDraggingTattoo = false;
let lastX = 0, lastY = 0;

// For pinch
const pointers = new Map();
let pinchStartDist = 0;
let pinchStartScale = 1;
let pinchCenter = { x: 0, y: 0 };
let pinchStartRotation = 0;
let initialTattooAngle = 0;

// --- helpers ---
function getDistance(p1, p2) {
  const dx = p1.x - p2.x, dy = p1.y - p2.y;
  return Math.sqrt(dx*dx + dy*dy);
}
function canvasPointFromClient(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// Call this anytime something changes
let rafId = 0;
function requestRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    render();
  });
}

// === PUBLIC: enable/disable pan mode ===
function setPanMode(enabled) {
  panMode = !!enabled;
}

// === INIT: extend your existing init to capture canvas/context refs ===
function init(skinDataURL, tattooURL) {
  canvas = document.getElementById('drawingCanvas');
  ctx = canvas.getContext('2d');

  const parent = canvas.parentElement;
  canvas.width = Math.floor(parent.clientWidth * window.devicePixelRatio);
  canvas.height = Math.floor(parent.clientHeight * window.devicePixelRatio);
  canvas.style.width = parent.clientWidth + 'px';
  canvas.style.height = parent.clientHeight + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Reset state for new images
  skinImg = null;
  tattooImg = null;
  pointers.clear();
  Object.assign(camera, { x: 0, y: 0, scale: 1 });
  Object.assign(tattoo, { x: 0, y: 0, scale: 1, angle: 0, width: 0, height: 0 });


  // 1. Load skin image first
  skinImg = new Image();
  skinImg.onload = () => {
    // 2. Once skin is loaded, center the camera
    centerSkin();
    requestRender(); // Render the skin immediately

    // 3. Then, load the tattoo image
    tattooImg = new Image();
    tattooImg.onload = () => {
      tattoo.width = tattooImg.width;
      tattoo.height = tattooImg.height;

      // 4. Position and scale the tattoo relative to the now-centered skin
      const skinWidthInWorld = skinImg.width;
      const desiredTattooWidth = skinWidthInWorld * 0.25; // Start at 25% of skin width
      tattoo.scale = desiredTattooWidth / tattoo.width;

      const centerX_css = canvas.clientWidth / 2;
      const centerY_css = canvas.clientHeight / 2;
      tattoo.x = (centerX_css - camera.x) / camera.scale;
      tattoo.y = (centerY_css - camera.y) / camera.scale;

      requestRender();
    };
    tattooImg.src = tattooURL;
  };
  skinImg.src = skinDataURL;

  attachPanHandlers();
}

function centerSkin() {
  // center the skin image at 1:1 scale if larger than canvas; adjust to fit width
  if (!skinImg || !skinImg.width) return;
  const cw = canvas.width, ch = canvas.height;
  const sw = skinImg.width, sh = skinImg.height;

  // fit width by default (you already resized to ~768, but mobile DPR may vary)
  const scaleX = cw / sw, scaleY = ch / sh;
  camera.scale = Math.min(scaleX, scaleY); // contain-fit
  // place centered
  camera.x = (cw - sw * camera.scale) * 0.5;
  camera.y = (ch - sh * camera.scale) * 0.5;
}

function attachPanHandlers() {
  // Avoid duplicate listeners
  if (canvas.__panHandlersAttached) return;
  canvas.__panHandlersAttached = true;

  // Use pointer events for both mouse and touch
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup',   onPointerUp,   { passive: false });
  canvas.addEventListener('pointercancel', onPointerUp, { passive: false });
  canvas.addEventListener('wheel', onWheelZoom, { passive: false }); // desktop wheel zoom
}

function onPointerDown(e) {
  e.preventDefault();
  const pt = canvasPointFromClient(e);
  pointers.set(e.pointerId, pt);
  canvas.setPointerCapture(e.pointerId);

  if (panMode) {
    if (pointers.size === 1) {
      pointerDown = true;
      lastX = pt.x;
      lastY = pt.y;
    } else if (pointers.size === 2) {
      pointerDown = false; // Stop single-finger panning
      const [a, b] = [...pointers.values()];
      pinchStartDist = getDistance(a, b);
      pinchStartScale = camera.scale;
      pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  } else { // Tattoo mode
    if (pointers.size === 1) {
      isDraggingTattoo = true;
      lastX = pt.x;
      lastY = pt.y;
    } else if (pointers.size === 2) {
      isDraggingTattoo = false; // Stop single-finger dragging
      const [a, b] = [...pointers.values()];
      pinchStartDist = getDistance(a, b);
      pinchStartScale = tattoo.scale;
      pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinchStartRotation = Math.atan2(b.y - a.y, b.x - a.x);
      initialTattooAngle = tattoo.angle;
    }
  }
}

function onPointerMove(e) {
  e.preventDefault();
  if (!pointers.has(e.pointerId)) return;
  const pt = canvasPointFromClient(e);
  pointers.set(e.pointerId, pt);

  if (panMode) {
    if (pointers.size === 1 && pointerDown) {
      const dx = pt.x - lastX;
      const dy = pt.y - lastY;
      camera.x += dx;
      camera.y += dy;
      lastX = pt.x;
      lastY = pt.y;
      requestRender();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = getDistance(a, b);
      if (pinchStartDist > 0) {
        const scaleFactor = dist / pinchStartDist;
        const newScale = Math.max(0.3, Math.min(5, pinchStartScale * scaleFactor));
        const cx = pinchCenter.x, cy = pinchCenter.y;
        camera.x = cx - (cx - camera.x) * (newScale / camera.scale);
        camera.y = cy - (cy - camera.y) * (newScale / camera.scale);
        camera.scale = newScale;
        requestRender();
      }
    }
  } else { // Tattoo manipulation
    if (pointers.size === 1 && isDraggingTattoo) {
      const dx = (pt.x - lastX) / camera.scale;
      const dy = (pt.y - lastY) / camera.scale;
      tattoo.x += dx;
      tattoo.y += dy;
      lastX = pt.x;
      lastY = pt.y;
      requestRender();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = getDistance(a, b);
      if (pinchStartDist > 0) {
        const scaleFactor = dist / pinchStartDist;
        const newScale = Math.max(0.1, Math.min(5, pinchStartScale * scaleFactor));

        const canvasPinchX = (a.x + b.x) / 2;
        const canvasPinchY = (a.y + b.y) / 2;

        // Convert pinch center to world coordinates
        const worldPinchX = (canvasPinchX - camera.x) / camera.scale;
        const worldPinchY = (canvasPinchY - camera.y) / camera.scale;

        // Adjust tattoo position to zoom towards the pinch center
        tattoo.x = worldPinchX - (worldPinchX - tattoo.x) * (newScale / tattoo.scale);
        tattoo.y = worldPinchY - (worldPinchY - tattoo.y) * (newScale / tattoo.scale);

        tattoo.scale = newScale;

        const currentRotation = Math.atan2(b.y - a.y, b.x - a.x);
        const rotationDelta = currentRotation - pinchStartRotation;
        tattoo.angle = initialTattooAngle + rotationDelta;

        requestRender();
      }
    }
  }
}

function onPointerUp(e) {
  e.preventDefault();
  canvas.releasePointerCapture?.(e.pointerId);
  pointers.delete(e.pointerId);

  // Reset state when no pointers are left
  if (pointers.size === 0) {
    pointerDown = false;
    isDraggingTattoo = false;
  }
  // If one pointer remains, transition from pinch to drag
  else if (pointers.size === 1) {
    const remainingPointer = [...pointers.values()][0];
    lastX = remainingPointer.x;
    lastY = remainingPointer.y;

    // Re-enable the correct drag mode
    if (panMode) {
        pointerDown = true;
        isDraggingTattoo = false; // ensure tattoo drag is off
    } else {
        isDraggingTattoo = true;
        pointerDown = false; // ensure pan drag is off
    }
    // Reset pinch state
    pinchStartDist = 0;
  }
}

function onWheelZoom(e) {
  if (!panMode) return;
  e.preventDefault();
  const pt = canvasPointFromClient(e);
  const zoom = Math.exp(-e.deltaY / 300); // smooth
  const newScale = Math.max(0.3, Math.min(5, camera.scale * zoom));

  // zoom to cursor
  const cx = pt.x, cy = pt.y;
  camera.x = cx - (cx - camera.x) * (newScale / camera.scale);
  camera.y = cy - (cy - camera.y) * (newScale / camera.scale);
  camera.scale = newScale;

  requestRender();
}

// === RENDER: apply camera transform to draw skin and tattoo in the same space ===
function render() {
  if (!ctx || !canvas) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // world transform (skin + tattoo move together)
  ctx.setTransform(camera.scale, 0, 0, camera.scale, camera.x, camera.y);

  // draw skin first
  if (skinImg) {
    ctx.drawImage(skinImg, 0, 0);
  }

  // draw tattoo
  if (tattooImg) {
    ctx.save();
    ctx.translate(tattoo.x, tattoo.y);
    ctx.rotate(tattoo.angle);
    ctx.scale(tattoo.scale, tattoo.scale);
    ctx.drawImage(tattooImg, -tattoo.width / 2, -tattoo.height / 2);
    ctx.restore();
  }

  // if you draw guides/selection, draw them here (still in world coords)
}

// === MASK: make sure the same camera transform is considered ===
async function updateMask() {
  if (!skinImg) return;
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = skinImg.width;
  offscreenCanvas.height = skinImg.height;
  const offscreenCtx = offscreenCanvas.getContext('2d');

  if (tattooImg) {
    offscreenCtx.save();
    // Use the tattoo's world coordinates, scale, and rotation directly
    offscreenCtx.translate(tattoo.x, tattoo.y);
    offscreenCtx.rotate(tattoo.angle);
    offscreenCtx.scale(tattoo.scale, tattoo.scale);
    offscreenCtx.drawImage(tattooImg, -tattoo.width / 2, -tattoo.height / 2);
    offscreenCtx.restore();
  }

  const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 0) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  offscreenCtx.putImageData(imageData, 0, 0);

  window.drawing.selectedArea = offscreenCanvas.toDataURL('image/png');
}

// === EXPORT the new API ===
window.drawing = window.drawing || {};
window.drawing.setPanMode = setPanMode;
window.drawing.init = init;
window.drawing.updateMask = updateMask;
window.drawing.setTattooRotation = (angle) => {
    tattoo.angle = angle * (Math.PI / 180);
    requestRender();
};
window.drawing.setTattooScale = (scale) => {
    tattoo.scale = scale;
    requestRender();
};
window.drawing.clearCanvas = () => {
    if (ctx) {
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
};


// If you export via ES module, also export named:
export { setPanMode, init, updateMask };
