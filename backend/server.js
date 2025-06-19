// backend/server.js

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises'; // For fs.access to check directory existence

import { placeTattooOnSkin } from './modules/fluxPlacementHandler.js'; // Path is relative to server.js

// Load environment variables from .env file (for local development)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ESM equivalent of __dirname for serving static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Security and Middleware ---
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001', // Adjust for your frontend's domain
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-key'],
    credentials: true,
}));
app.use(helmet());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again after 15 minutes"
});
app.use('/api/', apiLimiter); // Apply rate limiting only to API routes

// Body parsing middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.raw({ type: 'image/*', limit: '50mb' }));

// --- Serve Static Frontend Files ---
// Based on your screenshot, the `frontend` folder is a sibling to `backend`,
// and `index.html` is directly inside `frontend`.
// Render clones your repo to `/opt/render/project/src/`.
// If `server.js` is in `/opt/render/project/src/backend/`,
// then `__dirname` is `/opt/render/project/src/backend/`.
// To reach `/opt/render/project/src/frontend/`, we need to go up one level (`..`)
// and then into `frontend`.
const frontendStaticFilesPath = path.join(__dirname, '..', 'frontend'); // Corrected path!

console.log(`Attempting to serve static files from: ${frontendStaticFilesPath}`);

// Check if the directory exists (helpful for debugging Render deployments)
fs.access(frontendStaticFilesPath)
    .then(() => console.log(`Frontend static files directory exists at: ${frontendStaticFilesPath}`))
    .catch((err) => console.warn(`WARNING: Frontend static files directory does NOT exist at: ${frontendStaticFilesPath}. Error: ${err.message}. This will cause 404s for your frontend.`));

app.use(express.static(frontendStaticFilesPath));

// Serve index.html for all unhandled routes (for SPAs)
// This should be the last route handler for frontend routing
app.get('*', (req, res) => {
    // We are looking for index.html directly inside the frontendStaticFilesPath
    const indexPath = path.join(frontendStaticFilesPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`Error serving index.html at ${indexPath}: ${err.message}`);
            // If index.html itself is not found, send a simple 404 or an error page
            res.status(404).send('Frontend not found or could not be served. Please check build process and deployment path.');
        }
    });
});


// --- API Endpoints ---

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Backend is healthy' });
});

app.post('/api/generate-final-tattoo', async (req, res) => {
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

        const finalResult = await placeTattooOnSkin(skinImageBuffer, tattooDesignBuffer, maskBuffer);

        res.status(200).json({ success: true, message: "Tattoo placement successful!", result: finalResult });

    } catch (error) {
        console.error("Error in /api/generate-final-tattoo endpoint:", error);
        res.status(500).json({ success: false, message: "Failed to generate final tattoo.", error: error.message });
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
