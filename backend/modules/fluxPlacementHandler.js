// backend/modules/fluxPlacementHandler.js
console.log('FLUX_HANDLER_VERSION: 2025-08-12_ADAPTIVE_SCALE_ENGINE_V2');

import axios from 'axios';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

// -----------------------------
// Supabase setup
// -----------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// -----------------------------
// External API keys
// -----------------------------
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const FLUX_API_KEY = process.env.FLUX_API_KEY;

// -----------------------------
// Behavior flags
// -----------------------------
const ADAPTIVE_SCALE_ENABLED  = (process.env.ADAPTIVE_SCALE_ENABLED  ?? 'true').toLowerCase() === 'true';
const ADAPTIVE_ENGINE_ENABLED = (process.env.ADAPTIVE_ENGINE_ENABLED ?? 'true').toLowerCase() === 'true';
const RESPECT_MASK_SIZE = (process.env.RESPECT_MASK_SIZE ?? 'false').toLowerCase() === 'true';
const GLOBAL_SCALE_UP         = Number(process.env.MODEL_SCALE_UP   || '1.00'); // optional global bump
const FLUX_SHRINK_FIX         = Number(process.env.FLUX_SHRINK_FIX  || '1.12'); // <— new: corrects consistent FLUX downsizing
const FLUX_ENGINE_DEFAULT     = (process.env.FLUX_ENGINE || 'kontext').toLowerCase(); // 'kontext' | 'fill'

// -----------------------------
// Small helpers
// -----------------------------
// Weighted mask from placed tattoo alpha
async function buildWeightedMaskFromPositioned(positionedCanvasPNG) {
  const meta = await sharp(positionedCanvasPNG).metadata();
  const w = meta.width, h = meta.height;

  const alpha = await sharp(positionedCanvasPNG)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer();

  const hard = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
    .threshold(1)
    .raw()
    .toBuffer();

  const dilated = await sharp(hard, { raw: { width: w, height: h, channels: 1 } })
    .blur(1.6)
    .threshold(1)
    .raw()
    .toBuffer();

  const eroded = await sharp(hard, { raw: { width: w, height: h, channels: 1 } })
    .blur(1.0)
    .threshold(200)
    .raw()
    .toBuffer();

  const N = w * h;
  const ring   = Buffer.alloc(N);
  const inside = Buffer.alloc(N);
  for (let i = 0; i < N; i++) {
    const r = Math.max(0, dilated[i] - eroded[i]); // edge band
    ring[i]   = r ? 255 : 0;         // full strength at edges
    inside[i] = eroded[i] ? 96 : 0;  // soft interior (~38%)
  }

  const weighted = Buffer.alloc(N);
  for (let i = 0; i < N; i++) weighted[i] = Math.max(ring[i], inside[i]);

  // === Build outputs ===
  const weightedMaskPNG = await sharp(weighted, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();

  // RGBA overlay, black RGB with alpha = ring (for subtle edge restore via multiply)
  const edgeRingRGBAraw = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    edgeRingRGBAraw[p + 0] = 0;       // R
    edg
