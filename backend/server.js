// backend/server.js

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import jsonwebtoken from 'jsonwebtoken'; // Changed import for jsonwebtoken

import tokenService from './modules/tokenService.js';
import { placeTattooOnSkin } from './modules/fluxPlacementHandler.js';

// Load environment variables from .env file (for local development)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined. Please set it in your environment variables.');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Security and Middleware ---
app.set('trust proxy', 1);

const corsOptions = {
    origin: FRONTEND_URL === '*' ? '*' : FRONTEND_URL.endsWith('/') ? FRONTEND_URL.slice(0, -1) : FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-key'],
    credentials: true,
};
app.use(cors(corsOptions));
console.log(`CORS configured for origin: ${corsOptions.origin}`);

app.use(helmet());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again after 15 minutes",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.ip;
    },
});
app.use('/api/', apiLimiter);

const frontendStaticFilesPath = path.join(__dirname, '..', 'frontend');

console.log(`Attempting to serve static files from: ${frontendStaticFilesPath}`);

fs.access(frontendStaticFilesPath)
    .then(() => console.log(`Frontend static files directory exists at: ${frontendStaticFilesPath}`))
    .catch((err) => console.warn(`WARNING: Frontend static files directory does NOT exist at: ${frontendStaticFilesPath}. Error: ${err.message}. This will cause 404s for your frontend.`));

app.use(express.static(frontendStaticFilesPath));

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
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
        return res.sendStatus(401);
    }

    // Use jsonwebtoken.verify instead of jwt.verify
    jsonwebtoken.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification failed:', err.message);
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};


// --- API Endpoints ---

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Backend is healthy' });
});

app.post('/api/auth/register', async (req, res) => {
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

app.post('/api/auth/login', async (req, res) => {
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

app.post('/api/purchase-tokens', authenticateToken, async (req, res) => {
    const { amount } = req.body;
    console.log(`User ${req.user.userId} attempting to purchase ${amount} tokens.`);
    try {
        const newTokens = await tokenService.addTokens(req.user.userId, amount);
        res.status(200).json({ message: 'Tokens purchased successfully (simulated)', tokensRemaining: newTokens });
    } catch (error) {
        console.error('Token purchase error:', error.message);
        res.status(500).json({ error: 'Failed to purchase tokens' });
    }
});

app.post('/api/generate-final-tattoo', authenticateToken, async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Backend: Request received at /api/generate-final-tattoo`);
    console.log(`[${timestamp}] Backend: Request Headers:`, req.headers);

    const { tattooDesignImageBase64, skinPhotoBase64, maskDataBase64 } = req.body;

    console.log(`[${timestamp}] Backend: Request Body Keys:`, Object.keys(req.body));
    console.log(`[${timestamp}] Backend: tattooDesignImageBase64 present:`, !!tattooDesignImageBase64, `Length:`, tattooDesignImageBase64?.length || 0);
    console.log(`[${timestamp}] Backend: skinPhotoBase64 present:`, !!skinPhotoBase64, `Length:`, skinPhotoBase64?.length || 0);
    console.log(`[${timestamp}] Backend: maskDataBase64 present:`, !!maskDataBase64, `Length:`, maskDataBase64?.length || 0);

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
        const COST_PER_GENERATION = 15;

        // The deductTokens function already checks for sufficient tokens internally
        const tokensRemaining = await tokenService.deductTokens(userId, 'FLUX_PLACEMENT', COST_PER_GENERATION, 'Tattoo generation via Flux API');
        console.log(`[${timestamp}] User ${userId} tokens remaining after deduction: ${tokensRemaining}`);

        const tattooDesignBuffer = Buffer.from(tattooDesignImageBase64, 'base64');
        const skinPhotoBuffer = Buffer.from(skinPhotoBase64, 'base64');
        const maskDataBuffer = Buffer.from(maskDataBase64, 'base64');

        console.log(`[${timestamp}] Backend: Calling fluxPlacementHandler.placeTattooOnSkin for user ${userId}...`);
        const fluxResult = await placeTattooOnSkin(
            skinPhotoBuffer,
            tattooDesignBuffer,
            maskDataBuffer
        );
        console.log(`[${timestamp}] Backend: Flux placement successful for user ${userId}. Result from Flux:`, fluxResult);

        const generatedImageUrls = fluxResult?.output_images || [];
        console.log(`[${timestamp}] Backend: Generated URLs count: ${generatedImageUrls.length}`);

        res.status(200).json({
            message: 'Tattoo generated successfully!',
            generatedImageUrls: generatedImageUrls,
            tokensRemaining: tokensRemaining
        });

    } catch (error) {
        console.error(`[${timestamp}] Backend: Error during /api/generate-final-tattoo:`, error);
        if (error.message.includes('Insufficient tokens')) {
             return res.status(402).json({ error: error.message });
        }
        res.status(400).json({
            error: error.message || 'An unknown error occurred during tattoo generation.',
            details: process.env.NODE_ENV === 'production' ? undefined : error.stack
        });
    }
});


app.use('/api/*', (req, res) => {
    console.warn(`[${new Date().toISOString()}] Backend: 404 Not Found for API URL: ${req.originalUrl}`);
    res.status(404).send('API Endpoint Not Found');
});

app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Backend: Unhandled error:`, err.stack);
    res.status(500).send('Something broke on the server!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT}`);
});
