// backend/server.js

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { placeTattooOnSkin } from './modules/fluxPlacementHandler.js'; // Adjust path as needed
import bodyParser from 'body-parser'; // To parse JSON bodies

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for image data
app.use(bodyParser.raw({ type: 'image/*', limit: '50mb' })); // For direct image uploads if needed

// Serve static files (your frontend build)
app.use(express.static(path.join(__dirname, '../frontend/build'))); // Adjust path to your frontend build folder

// Root endpoint for health check or serving index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html')); // Adjust path
});

// API Endpoint for tattoo generation
app.post('/api/generate-final-tattoo', async (req, res) => {
    // In a real application, you'd handle file uploads more robustly.
    // For this example, we'll assume req.body contains the image buffers
    // This is a simplified example. You'll likely receive base64 encoded strings
    // or multipart form data for image uploads, and need to convert them to buffers.
    // Example: If receiving base64:
    // const skinImageBuffer = Buffer.from(req.body.skinImageBase64, 'base64');
    // const tattooDesignBuffer = Buffer.from(req.body.tattooDesignBase64, 'base64');
    // const maskBuffer = Buffer.from(req.body.maskBase64, 'base64');

    // Placeholder: In a real scenario, these buffers would come from your frontend's upload.
    // For testing, you might need to load dummy buffers or mock this.
    // IMPORTANT: Replace these with actual image buffers from your request body/upload.
    let skinImageBuffer;
    let tattooDesignBuffer;
    let maskBuffer;

    try {
        // Example: If your frontend sends images as base64 in a JSON body
        if (req.body.skinImageBase64 && req.body.tattooDesignBase64 && req.body.maskBase64) {
            skinImageBuffer = Buffer.from(req.body.skinImageBase64, 'base64');
            tattooDesignBuffer = Buffer.from(req.body.tattooDesignBase64, 'base64');
            maskBuffer = Buffer.from(req.body.maskBase64, 'base64');
        } else {
            return res.status(400).json({ success: false, message: "Missing image data (skinImageBase64, tattooDesignBase64, maskBase64) in request body." });
        }

        const finalResult = await placeTattooOnSkin(skinImageBuffer, tattooDesignBuffer, maskBuffer);

        // Assuming finalResult contains a URL or relevant data from Flux
        res.status(200).json({ success: true, message: "Tattoo placement successful!", result: finalResult });

    } catch (error) {
        console.error("Error in /api/generate-final-tattoo endpoint:", error);
        res.status(500).json({ success: false, message: "Failed to generate final tattoo.", error: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
