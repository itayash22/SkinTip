// backend/server.js

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser'; // For parsing request bodies
import cors from 'cors'; // For CORS headers
import helmet from 'helmet'; // For security headers
import rateLimit from 'express-rate-limit'; // For rate limiting

import { placeTattooOnSkin } from './modules/fluxPlacementHandler.js'; // Adjust path if your structure differs

// Load environment variables from .env file (for local development)
dotenv.config();

const app = express();
// Render sets the PORT env variable for you; use 3000 for local dev fallback
const PORT = process.env.PORT || 3000;

// ESM equivalent of __dirname for serving static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Security and Middleware ---
app.use(cors({
    // Configure CORS based on your frontend's domain in production
    // For development, you might use '*':
    // origin: '*',
    origin: process.env.FRONTEND_URL || 'http://localhost:3001', // Example: Replace with your actual frontend URL
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-key'],
    credentials: true,
}));
app.use(helmet()); // Adds various security HTTP headers

// Apply rate limiting to all requests
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: "Too many requests from this IP, please try again after 15 minutes"
});
app.use(apiLimiter);

// Body parsing middleware
// Increase limit as images can be large when sent as base64
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.raw({ type: 'image/*', limit: '50mb' })); // For direct binary image uploads if used

// --- Serve Static Frontend Files ---
// This assumes your frontend is built into a 'dist' or 'build' folder
// at the root of your *entire project repository* on Render.
// If your project structure is:
// / (repo root)
//   /backend
//     server.js
//     package.json
//   /frontend  (e.g., React app)
//     /build   (output after 'npm run build' in frontend)
//
// Then the path to your frontend build folder from the backend's server.js will be different.
// COMMON RENDER MONOREPO SETUP: Render clones your entire repo to `/opt/render/project/src/`.
// If your frontend build output is in `frontend/build` relative to the repo root,
// then the path from your `server.js` (which is in `backend/`) would be `../frontend/build`.

const frontendBuildPath = path.join(__dirname, '..', '..', 'frontend', 'build'); // Adjust this path carefully!

// Test if the frontend build path exists during startup
// In a typical Render monorepo setup:
// - `__dirname` is `/opt/render/project/src/backend`
// - `path.join(__dirname, '..', '..', 'frontend', 'build')` resolves to `/opt/render/project/src/frontend/build`
// This matches the error you saw previously.
console.log(`Attempting to serve static files from: ${frontendBuildPath}`);

// Check if the directory exists (optional, but helpful for debugging Render issues)
import fs from 'fs/promises'; // For fs.access
fs.access(frontendBuildPath)
    .then(() => console.log(`Frontend build directory exists at: ${frontendBuildPath}`))
    .catch(() => console.warn(`WARNING: Frontend build directory does NOT exist at: ${frontendBuildPath}. This may cause 404s for static files.`));


app.use(express.static(frontendBuildPath));

// Serve index.html for all unhandled routes (for SPAs)
// This should be the last route handler
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuildPath, 'index.html'), (err) => {
        if (err) {
            console.error(`Error serving index.html: ${err.message}`);
            // If index.html itself is not found, send a 404 or a simple message
            res.status(404).send('Frontend not found or could not be served. Check build process and paths.');
        }
    });
});


// --- API Endpoints ---

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Backend is healthy' });
});

// Endpoint to generate final tattoo
app.post('/api/generate-final-tattoo', async (req, res) => {
    // IMPORTANT: How you receive images from the frontend will dictate this part.
    // This example assumes you send base64 encoded images in a JSON body.
    let skinImageBuffer;
    let tattooDesignBuffer;
    let maskBuffer;

    try {
        if (!req.body || !req.body.skinImageBase64 || !req.body.tattooDesignBase64 || !req.body.maskBase64) {
            return res.status(400).json({ success: false, message: "Missing required image data (skinImageBase64, tattooDesignBase64, maskBase64) in request body." });
        }

        skinImageBuffer = Buffer.from(req.body.skinImageBase64, 'base64');
        tattooDesignBuffer = Buffer.from(req.body.tattooDesignBase64, 'base64');
        maskBuffer = Buffer.from(req.body.maskBase64, 'base64');

        // Call the Flux placement handler
        const finalResult = await placeTattooOnSkin(skinImageBuffer, tattooDesignBuffer, maskBuffer);

        // Send back the result received from Flux
        res.status(200).json({ success: true, message: "Tattoo placement successful!", result: finalResult });

    } catch (error) {
        console.error("Error in /api/generate-final-tattoo endpoint:", error);
        // Respond with a 500 and the error message
        res.status(500).json({ success: false, message: "Failed to generate final tattoo.", error: error.message });
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
