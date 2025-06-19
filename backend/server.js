// backend/server.js

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises'; // For fs.access to check directory existence

import tokenService from './modules/tokenService.js'; // Ensure correct import for ESM
import { placeTattooOnSkin } from './modules/fluxPlacementHandler.js';

// Load environment variables from .env file (for local development)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000; // Changed default to 10000 as per README
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001'; // Default for local frontend
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined. Please set it in your environment variables.');
    process.exit(1);
}

// ESM equivalent of __dirname for serving static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Security and Middleware ---

// Trust proxy for Render deployment to correctly identify client IPs for rate limiting
// This addresses the "ERR_ERL_UNEXPECTED_X_FORWARDED_FOR" warning
app.set('trust proxy', 1);

// CORS Configuration
const corsOptions = {
    origin: FRONTEND_URL === '*' ? '*' : FRONTEND_URL.endsWith('/') ? FRONTEND_URL.slice(0, -1) : FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-key'],
    credentials: true,
};
app.use(cors(corsOptions));
console.log(`CORS configured for origin: ${corsOptions.origin}`);

// JSON body parser with increased limit for image base64 data
app.use(express.json({ limit: '50mb' })); // This will correctly parse the base64 JSON payload
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // For URL-encoded bodies if used

// Rate Limiting (adjust as needed)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again after 15 minutes",
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.ip;
    },
});
app.use('/api/', apiLimiter);


// Serve Static Frontend Files
const frontendStaticFilesPath = path.join(__dirname, '..', 'frontend');

console.log(`Attempting to serve static files from: ${frontendStaticFilesPath}`);

fs.access(frontendStaticFilesPath)
    .then(() => console.log(`Frontend static files directory exists at: ${frontendStaticFilesPath}`))
    .catch((err) => console.warn(`WARNING: Frontend static files directory does NOT exist at: ${frontendStaticFilesPath}. Error: ${err.message}. This will cause 404s for your frontend.`));

app.use(express.static(frontendStaticFilesPath));

// Serve index.html for all unhandled routes (for SPAs) - ensures deep links work
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        // If it's an API route, let subsequent middleware handle it (e.g., 404 handler)
        return next();
    }
    const indexPath = path.join(frontendStaticFilesPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`Error serving index.html at ${indexPath}: ${err.message}`);
            res.status(404).send('Frontend not found or could not be served. Please check build process and deployment path.');
        }
    });
});


// Middleware to protect routes and add user to request
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        console.log('Authentication failed: No token provided.');
        return res.sendStatus(401); // Unauthorized
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification failed:', err.message);
            return res.sendStatus(403); // Forbidden (invalid token)
        }
        req.user = user; // Attach user payload to request
        next();
    });
};


// --- API Endpoints ---

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Backend is healthy' });
});

// User authentication routes (keeping current structure)
app.post('/api/auth/register', async (req, res) => { // Added /auth prefix as per auth.js
    const { email, password, username } = req.body;
    console.log(`Register attempt for email: ${email}`);
    try {
        const { user, token, tokensRemaining } = await tokenService.registerUser(email, password, username);
        res.status(201).json({ message: 'User registered successfully', user: { id: user.id, email: user.email, username: user.username, tokens_remaining: tokensRemaining }, token });
    } catch (error) {
        console.error('Registration error:', error.message);
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => { // Added /auth prefix as per auth.js
    const { email, password } = req.body;
    console.log(`Login attempt for email: ${email}`);
    try {
        const { user, token, tokensRemaining } = await tokenService.loginUser(email, password);
        res.status(200).json({ message: 'Login successful', user: { id: user.id, email: user.email, username: user.username, tokens_remaining: tokensRemaining }, token });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(401).json({ error: error.message });
    }
});

app.get('/api/user/tokens', authenticateToken, async (req, res) => {
    try {
        const tokensRemaining = await tokenService.getUserTokens(req.user.userId);
        res.status(200).json({ tokensRemaining });
    } catch (error) {
        console.error('Error fetching user tokens:', error.message);
        res.status(500).json({ error: 'Failed to fetch tokens' });
    }
});

// Token purchase (dummy/placeholder, real integration would use Stripe)
app.post('/api/purchase-tokens', authenticateToken, async (req, res) => {
    const { amount } = req.body; // Amount of tokens to purchase
    console.log(`User ${req.user.userId} attempting to purchase ${amount} tokens.`);
    try {
        const newTokens = await tokenService.addTokens(req.user.userId, amount);
        res.status(200).json({ message: 'Tokens purchased successfully (simulated)', tokensRemaining: newTokens });
    } catch (error) {
        console.error('Token purchase error:', error.message);
        res.status(500).json({ error: 'Failed to purchase tokens' });
    }
});


// Main endpoint for AI tattoo generation
app.post('/api/generate-final-tattoo', authenticateToken, async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Backend: Request received at /api/generate-final-tattoo`);
    console.log(`[${timestamp}] Backend: Request Headers:`, req.headers);

    // --- Validate and log incoming base64 data ---
    const { tattooDesignImageBase64, skinPhotoBase64, maskDataBase64 } = req.body;

    console.log(`[${timestamp}] Backend: Request Body Keys:`, Object.keys(req.body));
    console.log(`[${timestamp}] Backend: tattooDesignImageBase64 present:`, !!tattooDesignImageBase64, `Length:`, tattooDesignImageBase64?.length || 0);
    console.log(`[${timestamp}] Backend: skinPhotoBase64 present:`, !!skinPhotoBase64, `Length:`, skinPhotoBase64?.length || 0);
    console.log(`[${timestamp}] Backend: maskDataBase64 present:`, !!maskDataBase64, `Length:`, maskDataBase64?.length || 0);

    // Basic validation
    if (!tattooDesignImageBase64 || !skinPhotoBase64 || !maskDataBase64) {
        const missing = [];
        if (!tattooDesignImageBase64) missing.push('tattooDesignImageBase64');
        if (!skinPhotoBase64) missing.push('skinPhotoBase64');
        if (!maskDataBase64) missing.push('maskDataBase64');
        console.error(`[${timestamp}] Backend: Missing required image data in JSON payload: ${missing.join(', ')}`);
        return res.status(400).json({ error: `Missing one or more required image inputs: ${missing.join(', ')}` });
    }

    try {
        const userId = req.user.userId;
        const COST_PER_GENERATION = 15; // As per your business model (15 tokens)

        // Check if user has enough tokens
        const tokensRemaining = await tokenService.deductTokens(userId, 'FLUX_PLACEMENT', COST_PER_GENERATION, 'Tattoo generation via Flux API');
        console.log(`[${timestamp}] User ${userId} tokens remaining after deduction: ${tokensRemaining}`);

        // Convert base64 strings to Buffers for `sharp` and `Flux API`
        const tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
        const skinPhotoBuffer = Buffer.from(skinPhotoBase64, 'base64');
        const maskDataBuffer = Buffer.from(maskDataBase64, 'base64');

        // Process images and call Flux API
        console.log(`[${timestamp}] Backend: Calling fluxPlacementHandler.placeTattooOnSkin for user ${userId}...`);
        const fluxResult = await placeTattooOnSkin(
            skinPhotoBuffer,
            tattooDesignBuffer,
            maskDataBuffer
        );
        console.log(`[${timestamp}] Backend: Flux placement successful for user ${userId}. Result from Flux:`, fluxResult);

        // Assuming fluxResult contains the generated image URLs in an array, e.g., fluxResult.output_images
        const generatedImageUrls = fluxResult?.output_images || [];
        console.log(`[${timestamp}] Backend: Generated URLs count: ${generatedImageUrls.length}`);

        // Send back the URLs of the generated images and updated token count
        res.status(200).json({
            message: 'Tattoo generated successfully!',
            generatedImageUrls: generatedImageUrls, // Ensure this matches frontend expectation
            tokensRemaining: tokensRemaining // Send updated token count
        });

    } catch (error) {
        console.error(`[${timestamp}] Backend: Error during /api/generate-final-tattoo:`, error);
        // Provide more detail in the error response for debugging
        // Check for specific error messages from tokenService for better client feedback
        if (error.message.includes('Insufficient tokens')) {
             return res.status(402).json({ error: error.message }); // 402 Payment Required
        }
        res.status(400).json({ // Use 400 for client-side errors, 500 for server errors
            error: error.message || 'An unknown error occurred during tattoo generation.',
            details: process.env.NODE_ENV === 'production' ? undefined : error.stack // Include stack trace only in dev
        });
    }
});


// Catch-all for undefined /api routes
app.use('/api/*', (req, res) => {
    console.warn(`[${new Date().toISOString()}] Backend: 404 Not Found for API URL: ${req.originalUrl}`);
    res.status(404).send('API Endpoint Not Found');
});


// Error handling middleware (should be the last app.use())
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Backend: Unhandled error:`, err.stack);
    res.status(500).send('Something broke on the server!');
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
