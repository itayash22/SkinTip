// frontend/js/image-utils.js

// ---- White/near-white → alpha (no libs) ----
async function cleanStencilWhiteBg(urlOrDataUrl, { soft = 235, hard = 252 } = {}) {
  // 1) Fetch as blob so we avoid tainted canvas (works for cross-origin URLs)
  const resp = await fetch(urlOrDataUrl, { mode: 'cors' });
  const srcBlob = await resp.blob();

  // 2) Decode with EXIF orientation if possible
  let bmpOrImg;
  if ('createImageBitmap' in window) {
    bmpOrImg = await createImageBitmap(srcBlob, { imageOrientation: 'from-image' });
  } else {
    bmpOrImg = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.src = URL.createObjectURL(srcBlob);
    });
  }

  const w = bmpOrImg.width || bmpOrImg.naturalWidth;
  const h = bmpOrImg.height || bmpOrImg.naturalHeight;

  // 3) Draw and read pixels
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, w, h);
  x.drawImage(bmpOrImg, 0, 0, w, h);

  const imgData = x.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Gentle white→alpha like your backend's colorToAlphaWhite()
  const ramp = Math.max(1, hard - soft); // softness of the transition
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const A = d[i + 3];

    const wmax = Math.max(R, G, B);
    let alpha = A;

    if (wmax >= soft) {
      const cut = Math.max(0, Math.min(1, (wmax - soft) / ramp)); // 0..1
      alpha = Math.round(A * (1 - cut));
      if (wmax >= hard) alpha = 0;
    }

    // Decontaminate fringing: un-premultiply white from RGB where 0<alpha<255
    if (alpha > 0 && alpha < 255) {
      const a = alpha / 255;
      d[i]     = Math.max(0, Math.min(255, Math.round((R - (1 - a) * 255) / a)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round((G - (1 - a) * 255) / a)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round((B - (1 - a) * 255) / a)));
    }

    d[i + 3] = alpha;
  }

  x.putImageData(imgData, 0, 0);

  // 4) Return a safe, same-origin blob URL (PNG keeps transparency)
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  return URL.createObjectURL(blob);
}

async function resizeImage(dataURL, originalMimeType, maxWidth, maxHeight, quality = 0.9) {
    // Turn dataURL into a Blob
    const blob = await (await fetch(dataURL)).blob();

    // Prefer createImageBitmap (applies EXIF orientation with the option below)
    let sourceW, sourceH, draw;
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      sourceW = bitmap.width;
      sourceH = bitmap.height;
      draw = (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h);
    } else {
      // Fallback path
      const img = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.src = URL.createObjectURL(blob);
      });
      sourceW = img.width;
      sourceH = img.height;
      draw = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h);
    }

    // Contain-fit into the target box (no cropping)
    const srcAR = sourceW / sourceH;
    const boxAR = maxWidth / maxHeight;
    let targetW, targetH;
    if (srcAR > boxAR) {
      targetW = maxWidth;
      targetH = Math.round(maxWidth / srcAR);
    } else {
      targetH = maxHeight;
      targetW = Math.round(maxHeight * srcAR);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: true });

    ctx.clearRect(0, 0, targetW, targetH);
    draw(ctx, targetW, targetH);

    const outputMimeType = 'image/png';
    const outputQuality = undefined; // Quality is only for JPEG

    return canvas.toDataURL(outputMimeType, outputQuality);
}