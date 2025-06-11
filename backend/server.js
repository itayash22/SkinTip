
// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sizeOf = require('image-size');

// Import our new modularized services
const tokenService = require('./modules/tokenService');
const fluxKontextHandler = require( './modules/fluxPlacementHandler');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase (for auth routes and token service init if needed)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // For frontend auth (if backend uses it)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // For backend operations (token service, storage)

// Ensure keys are present early
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY || !process.env.JWT_SECRET || !process.env.FLUX_API_KEY) {
    console.error('CRITICAL ERROR: One or more required environment variables are missing!');
    process.exit(1); // Exit if critical env vars are not set
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // Use anon key for general supabase client init

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Update rate limiter - Adjust trustProxy for Render (proxy environment)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    trustProxy: 1 // Crucial for Render: trusts the first proxy hop to get real IP
});
app.use('/api/', limiter);

// Multer setup for file uploads (memory storage for efficiency)
// This setup is for the /api/generate-final-tattoo endpoint, accepting two image files.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG and WebP are allowed.'));
        }
    }
});

// Health check routes
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'SkinTip API is running' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'SkinTip API is running' });
});

// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        // Verify the JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Fetch user from Supabase to ensure token corresponds to an active user
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        req.user = user; // Attach user object to request
        next();
    } catch (error) {
        // Handle token expiration or invalid token
        console.error('Authentication error:', error.message);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;

        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if user exists (email or username)
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .or(`email.eq.${email},username.eq.${username}`)
            .single();

        if (existingUser) {
            return res.status(409).json({ error: 'User with this email or username already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user in Supabase (with initial tokens)
        const { data: newUser, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash: passwordHash,
                username,
                tokens_remaining: 20 // Grant initial free tokens
            })
            .select()
            .single();

        if (error) {
            console.error('Registration error:', error);
            return res.status(500).json({ error: 'Failed to create user' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Registration successful',
            token,
            user: {
                id: newUser.id,
                email: newUser.email,
                username: newUser.username,
                tokens_remaining: newUser.tokens_remaining
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Get user from Supabase
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                tokens_remaining: user.tokens_remaining
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Helper function to validate base64 (already in fluxKontextHandler, but good to keep general util here)
function isValidBase64(str) {
    if (!str || str.length < 100) return false;
    try {
        return Buffer.from(str, 'base64').toString('base64') === str;
    } catch (e) {
        console.warn("isValidBase64 check failed for string (first 50 chars):", str.substring(0, 50) + "...");
        return false;
    }
}

// --- NEW TEMPORARY ENDPOINT TO ADD TOKENS FOR TESTING ---
// !!! WARNING: This endpoint should be removed or heavily secured (e.g., admin-only) in production. !!!
app.post('/api/add-test-tokens', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const amount = req.body.amount || 200; // Default to 200 tokens if not specified

        console.log(`Attempting to add ${amount} test tokens for user ${userId}.`);

        const newBalance = await tokenService.addTokens(userId, amount, `Manual test token addition by user ${userId}`);
        
        res.json({
            message: `Successfully added ${amount} tokens. New balance: ${newBalance}.`,
            tokens_remaining: newBalance
        });
    } catch (error) {
        console.error('Error adding test tokens:', error);
        res.status(500).json({ error: `Failed to add test tokens: ${error.message}` });
    }
});
// --- END TEMPORARY ENDPOINT ---


// --- NEW GENERATION ENDPOINT: /api/generate-final-tattoo ---
app.post('/api/generate-final-tattoo',
    authenticateToken, // Authenticate user
    upload.fields([ // Expects two image files
        { name: 'skinImage', maxCount: 1 },
        { name: 'tattooDesignImage', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            console.log('API: /api/generate-final-tattoo endpoint called.');

            const userId = req.user.id; // User ID from authenticated token
            const { mask, prompt: userPromptText } = req.body; // 'mask' is base64, 'prompt' is optional text
            const skinImageFile = req.files.skinImage ? req.files.skinImage[0] : null;
            const tattooDesignImageFile = req.files.tattooDesignImage ? req.files.tattooDesignImage[0] : null;

            // --- Input Validation ---
            if (!skinImageFile || !tattooDesignImageFile || !mask) {
                return res.status(400).json({ error: 'Skin image, tattoo design, and mask are all required.' });
            }

            if (!process.env.FLUX_API_KEY) {
                console.log('Flux API Key not configured. Returning mock data.');
                return res.json({
                    images: [
                        'https://picsum.photos/512/512?random=1',
                        'https://picsum.photos/512/512?random=2',
                        'https://picsum.photos/512/512?random=3'
                    ],
                    tokens_remaining: req.user.tokens_remaining // Return current user tokens
                });
            }

            // --- Token Check ---
            const tokensRequired = process.env.NODE_ENV === 'development' ? 0 : 15; // Set to 0 in dev for free testing
            const hasEnoughTokens = await tokenService.checkTokens(userId, 'FLUX_PLACEMENT', tokensRequired);
            if (!hasEnoughTokens) {
                return res.status(402).json({ error: `Insufficient tokens. This action costs ${tokensRequired} tokens.` });
            }

            // --- Prepare Image Data ---
            const skinImageBuffer = skinImageFile.buffer;
            const tattooDesignImageBase64 = tattooDesignImageFile.buffer.toString('base64');

            // Basic validation for base64 strings after conversion from buffer for consistency
            if (!isValidBase64(tattooDesignImageBase64) || !isValidBase64(mask)) {
                console.error('Server: Invalid Base64 data detected for tattoo design or mask.');
                return res.status(400).json({ error: 'Invalid image data detected during processing.' });
            }

            // --- Dimension Check ---
            let skinImageDimensions, tattooDesignDimensions, maskDimensions;
            try {
                skinImageDimensions = sizeOf(skinImageBuffer);
                tattooDesignDimensions = sizeOf(Buffer.from(tattooDesignImageBase64, 'base64'));
                maskDimensions = sizeOf(Buffer.from(mask, 'base64'));

                console.log(`Skin Image Dims: ${skinImageDimensions.width}x${skinImageDimensions.height}`);
                console.log(`Tattoo Design Dims: ${tattooDesignDimensions.width}x${tattooDesignDimensions.height}`);
                console.log(`Mask Dims: ${maskDimensions.width}x${maskDimensions.height}`);

                // All three should match for optimal inpainting
                if (skinImageDimensions.width !== maskDimensions.width || skinImageDimensions.height !== maskDimensions.height) {
                    console.error('Skin image and Mask dimensions do NOT match!');
                    return res.status(400).json({ error: 'Skin image and mask dimensions must be identical.' });
                }
                // Tattoo design image dimensions should be reasonably sized, not necessarily exact match to skin.
                // Flux Kontext will handle scaling the reference_image within the mask.
                console.log('Skin Image Base64 (first 100 chars):', skinImageBuffer.toString('base64').substring(0, 100) + '...');
                console.log('Tattoo Design Base64 (first 100 chars):', tattooDesignImageBase64.substring(0, 100) + '...');
                console.log('Mask Base64 (first 100 chars):', mask.substring(0, 100) + '...');

            } catch (dimError) {
                console.error('Error getting image/mask dimensions:', dimError.message);
                return res.status(500).json({ error: 'Failed to read image dimensions for validation.' });
            }

            // --- Call Flux Kontext Placement Handler ---
            const generatedImageUrls = await fluxKontextHandler.placeTattooOnSkin(
                skinImageBuffer,
                tattooDesignImageBase64,
                mask,
                userPromptText, // Pass user's optional prompt text (it's gone from UX, but keep param for now)
                userId,
                3, // numVariations: Request 3 images
                process.env.FLUX_API_KEY
            );

            // --- Deduct Tokens on Success ---
            const newTokens = await tokenService.deductTokens(userId, 'FLUX_PLACEMENT', tokensRequired, `Tattoo placement for user ${userId}`);
            console.log('Tokens deducted successfully. New balance:', newTokens);

            res.json({
                images: generatedImageUrls,
                tokens_remaining: newTokens // Send updated token balance to frontend
            });

        } catch (error) {
            console.error('API Error in /api/generate-final-tattoo:', error);

            if (error.message.includes('Insufficient tokens')) {
                return res.status(402).json({ error: error.message });
            }
            if (error.message.includes('Invalid file type') || error instanceof multer.MulterError) {
                let errorMessage = 'File upload error.';
                if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                    errorMessage = 'One of the uploaded files is too large. Maximum size is 5MB per file.';
                } else {
                    errorMessage = error.message; // Use specific error message if available
                }
                return res.status(400).json({ error: errorMessage });
            }
            if (error.message.includes('Image and mask dimensions do NOT match') ||
                error.message.includes('Invalid image data detected') ||
                error.message.includes('Failed to read image dimensions') ||
                error.message.includes('Invalid tattoo design image data')) {
                return res.status(400).json({ error: `Image processing error: ${error.message}` });
            }
            if (error.message.includes('Flux API generation error') ||
                error.message.includes('Generation timeout') ||
                error.message.includes('Mask inversion failed') ||
                error.message.includes('Failed to upload image to storage')) {
                return res.status(500).json({ error: `AI generation or storage failed: ${error.message}` });
            }

            res.status(500).json({
                error: 'An internal server error occurred during tattoo generation.',
                details: error.message
            });
        }
    }
);

// Error handling middleware (catches errors from previous middleware/routes)
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'One of the uploaded files is too large. Maximum size is 5MB per file.' });
        }
        return res.status(400).json({ error: `File upload error: ${error.message}` });
    }
    console.error('Unhandled Server Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SkinTip backend running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Flux API: ${process.env.FLUX_API_KEY ? 'Configured' : 'Not configured (using mock)'}`);
    console.log(`🔗 Supabase URL: ${SUPABASE_URL ? 'Configured' : 'Not configured'}`);
    console.log(`🔐 Supabase Service Key: ${SUPABASE_SERVICE_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`📦 Supabase Storage Bucket: ${process.env.SUPABASE_STORAGE_BUCKET ? 'Configured' : 'Not configured'}`);
});
