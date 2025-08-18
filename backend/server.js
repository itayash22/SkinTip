// backend/server.js
// This file was last updated on 2025-06-14 (EOD) to fix ES Module import errors.

// --- START OF ACTUAL IMPORTS (SHOULD ONLY APPEAR ONCE) ---
import 'dotenv/config'; // Use 'dotenv/config' for top-level loading with ESM
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs'; // Corrected import for bcryptjs
import jwt from 'jsonwebtoken';
import sizeOf from 'image-size'; // image-size default export might be different, but typically it's named 'imageSize' or used as a function

// Import our new modularized services
import tokenService from './modules/tokenService.js'; // Added .js extension
import fluxKontextHandler from './modules/fluxPlacementHandler.js'; // Added .js extension
import fetch from 'node-fetch';
// --- END OF ACTUAL IMPORTS ---

// Function to generate a dynamic timestamp for deployment tracking
const getDeploymentTimestamp = () => new Date().toISOString();
console.log(`SERVER_DEPLOY_TIMESTAMP: ${getDeploymentTimestamp()}`);

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

console.log('SERVER STARTUP DEBUG: process.env.FRONTEND_URL =', process.env.FRONTEND_URL);

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY || !process.env.JWT_SECRET || !process.env.FLUX_API_KEY) {
    console.error('CRITICAL ERROR: One or more required environment variables are missing!');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Middleware
app.use(helmet());

app.use((req, res, next) => {
    next();
});

app.use(cors({
    origin: [
        process.env.FRONTEND_URL,
        'https://itayash22.github.io',
        'http://localhost:8080',
        'http://127.0.0.1:8080'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-key'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    trustProxy: 1
});
app.use('/api/', limiter);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024
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

app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'SLATE API is running' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'SLATE API is running' });
});

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Authentication error:', error.message);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;

        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .or(`email.eq.${email},username.eq.${username}`)
            .single();

        if (existingUser) {
            return res.status(409).json({ error: 'User with this email or username already exists' });
        }

        const passwordHash = await bcryptjs.hash(password, 10);

        const { data: newUser, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash: passwordHash,
                username,
                tokens_remaining: 20
            })
            .select()
            .single();

        if (error) {
            console.error('Registration error:', error);
            return res.status(500).json({ error: 'Failed to create user' });
        }

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

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcryptjs.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

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

app.get('/api/styles-with-stencils', async (req, res) => {
    try {
        // 1. Fetch all stencils with their artists
        const { data: stencils, error: stencilsError } = await supabase
            .from('stencils')
            .select('*, artists (*)');
        if (stencilsError) throw stencilsError;

        // 2. Fetch all styles
        const { data: styles, error: stylesError } = await supabase
            .from('styles')
            .select('*');
        if (stylesError) throw stylesError;

        // 3. Fetch all join table entries
        const { data: stencilStyleLinks, error: linksError } = await supabase
            .from('stencil_styles')
            .select('*');
        if (linksError) throw linksError;

        // 4. Process the data
        const stylesMap = styles.reduce((acc, style) => {
            acc[style.id] = style.name;
            return acc;
        }, {});

        const stylesWithStencils = {};

        // Initialize all styles from the styles table
        styles.forEach(style => {
            stylesWithStencils[style.name] = [];
        });
        stylesWithStencils['Freestyle'] = [];

        stencils.forEach(stencil => {
            const stencilInfo = {
                id: stencil.id,
                name: stencil.name,
                imageUrl: stencil.image_url,
                price: stencil.stencil_price,
                artist: {
                    name: stencil.artists ? stencil.artists.name : 'Unknown Artist',
                    whatsapp: stencil.artists ? stencil.artists.whatsapp_number : ''
                }
            };

            const links = stencilStyleLinks.filter(link => link.stencil_id === stencil.id);
            if (links.length > 0) {
                links.forEach(link => {
                    const styleName = stylesMap[link.style_id];
                    if (styleName) {
                        stylesWithStencils[styleName].push(stencilInfo);
                    }
                });
            } else {
                stylesWithStencils['Freestyle'].push(stencilInfo);
            }
        });

        // Filter out styles that have no stencils, except for Freestyle
        const finalStyles = {};
        for (const styleName in stylesWithStencils) {
            if (stylesWithStencils[styleName].length > 0 || styleName === 'Freestyle') {
                finalStyles[styleName] = stylesWithStencils[styleName];
            }
        }


        res.json(finalStyles);
    } catch (error) {
        console.error('Error fetching styles with stencils:', error);
        res.status(500).json({ error: 'Failed to fetch stencil data' });
    }
});

function isValidBase64(str) {
    if (!str || str.length < 100) return false;
    try {
        return Buffer.from(str, 'base64').toString('base64') === str;
    } catch (e) {
        console.warn("isValidBase64 check failed for string (first 50 chars):", str.substring(0, 50) + "...");
        return false;
    }
}

app.post('/api/admin/debug-add-tokens', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const amountToAdd = parseInt(req.body.amount);

        if (isNaN(amountToAdd) || amountToAdd <= 0) {
            return res.status(400).json({ error: 'Invalid amount. Must be a positive number.' });
        }

        console.log(`DEBUG: Attempting direct Supabase token addition for user ${userId}, amount: ${amountToAdd}`);

        const { data: currentUser, error: fetchError } = await supabase
            .from('users')
            .select('tokens_remaining')
            .eq('id', userId)
            .single();

        if (fetchError || !currentUser) {
            console.error('DEBUG: Failed to fetch current tokens:', fetchError?.message || 'User not found.');
            return res.status(404).json({ error: 'User not found or failed to retrieve current token balance.' });
        }

        const newTokensRemaining = currentUser.tokens_remaining + amountToAdd;

        const { data, error } = await supabase
            .from('users')
            .update({ tokens_remaining: newTokensRemaining })
            .eq('id', userId);

        if (error) {
            console.error('DEBUG: Direct Supabase token update failed:', error.message);
            throw new Error(`Supabase update failed: ${error.message}`);
        }

        console.log(`DEBUG: Successfully added ${amountToAdd} tokens directly for user ${userId}. New balance: ${newTokensRemaining}`);

        res.json({
            message: `Successfully added ${amountToAdd} tokens directly. New balance: ${newTokensRemaining}.`,
            tokens_remaining: newTokensRemaining
        });
    } catch (error) {
        console.error('DEBUG: Error in /api/admin/debug-add-tokens:', error.message);
        res.status(500).json({ error: `Failed to add tokens via debug endpoint: ${error.message}` });
    }
});

app.post('/api/generate-final-tattoo',
    authenticateToken,
    upload.fields([
        { name: 'skinImage', maxCount: 1 },
        { name: 'tattooDesignImage', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            console.log('API: /api/generate-final-tattoo endpoint called.');

            const userId = req.user.id;
            const { mask, prompt: userPromptText, tattooAngle } = req.body;
            const skinImageFile = req.files.skinImage ? req.files.skinImage[0] : null;
            const tattooDesignImageFile = req.files.tattooDesignImage ? req.files.tattooDesignImage[0] : null;

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
                    tokens_remaining: req.user.tokens_remaining
                });
            }

            const tokensRequired = process.env.NODE_ENV === 'development' ? 0 : 15;
            const hasEnoughTokens = await tokenService.checkTokens(userId, 'FLUX_PLACEMENT', tokensRequired);
            if (!hasEnoughTokens) {
                return res.status(402).json({ error: `Insufficient tokens. This action costs ${tokensRequired} tokens.` });
            }

            const skinImageBuffer = skinImageFile.buffer;
            const tattooDesignImageBase64 = tattooDesignImageFile.buffer.toString('base64');

            if (!isValidBase64(tattooDesignImageBase64) || !isValidBase64(mask)) {
                console.error('Server: Invalid Base64 data detected for tattoo design or mask. Returning 400.');
                return res.status(400).json({ error: 'Invalid image data detected during processing.' });
            }

            let skinImageDimensions, tattooDesignDimensions, maskDimensions;
            try {
                skinImageDimensions = sizeOf(skinImageBuffer);
                tattooDesignDimensions = sizeOf(Buffer.from(tattooDesignImageBase64, 'base64'));
                maskDimensions = sizeOf(Buffer.from(mask, 'base64'));

                console.log(`Skin Image Dims: ${skinImageDimensions.width}x${skinImageDimensions.height}`);
                console.log(`Tattoo Design Dims: ${tattooDesignDimensions.width}x${tattooDesignDimensions.height}`);
                console.log(`Mask Dims: ${maskDimensions.width}x${maskDimensions.height}`);

                if (skinImageDimensions.width !== maskDimensions.width || skinImageDimensions.height !== maskDimensions.height) {
                    console.error('Skin image and Mask dimensions do NOT match!');
                    return res.status(400).json({ error: 'Skin image and mask dimensions must be identical.' });
                }
            } catch (dimError) {
                console.error('Error getting image/mask dimensions:', dimError.message);
                return res.status(500).json({ error: 'Failed to read image dimensions for validation.' });
            }

            // --- CRITICAL FIX HERE: ARGUMENT ORDER ---
            // The 'prompt: userPromptText' from req.body is no longer passed to fluxKontextHandler.placeTattooOnSkin
            const generatedImageUrls = await fluxKontextHandler.placeTattooOnSkin(
                skinImageBuffer,
                tattooDesignImageBase64,
                mask,
                userId,          // Corresponds to 'userId' in fluxPlacementHandler.js
                3,               // Corresponds to 'numVariations' in fluxPlacementHandler.js
                process.env.FLUX_API_KEY, // Corresponds to 'fluxApiKey' in fluxPlacementHandler.js
                parseInt(tattooAngle)
            );
            // --- END CRITICAL FIX ---

            const newTokens = await tokenService.deductTokens(userId, 'FLUX_PLACEMENT', tokensRequired, `Tattoo placement for user ${userId}`);
            console.log('Tokens deducted successfully. New balance:', newTokens);

            res.json({
                images: generatedImageUrls,
                tokens_remaining: newTokens
            });

        } catch (error) {
            console.error('API Error in /api/generate-final-tattoo:', error);

            if (error.message.includes('Flux API: Content Moderated')) {
                return res.status(403).json({
                    error: error.message,
                });
            }

            if (error.message.includes('Insufficient tokens')) {
                return res.status(402).json({ error: error.message });
            }
            if (error.message.includes('Invalid file type') || error instanceof multer.MulterError) {
                let errorMessage = 'File upload error.';
                if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                    errorMessage = 'One of the uploaded files is too large. Maximum size is 5MB per file.';
                } else {
                    errorMessage = error.message;
                }
                return res.status(400).json({ error: errorMessage });
            }
            if (error.message.includes('Skin image and mask dimensions do NOT match') ||
                error.message.includes('Invalid image data detected') ||
                error.message.includes('Failed to read image dimensions') ||
                error.message.includes('Invalid tattoo design image data') ||
                error.message.includes('Drawn mask area is too small or empty') ||
                error.message.includes('Failed to resize tattoo design for placement') ||
                error.message.includes('No images were generated across all attempts') ||
                error.message.includes('Tattoo design has a complex or non-uniform background') ||
                error.message.includes('Failed to sample tattoo design pixels for background detection') ||
                error.message.includes('Invalid pixel data obtained for background detection')) {
                return res.status(400).json({ error: `Image processing error: ${error.message}` });
            }
            if (error.message.includes('Flux API generation error') ||
                error.message.includes('Refinement timeout') ||
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

app.post('/api/share-on-whatsapp', authenticateToken, async (req, res) => {
    // Note: This endpoint requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to be set in the environment variables.
    const { artistWhatsapp, imageUrls, artistName } = req.body;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error('WhatsApp API credentials are not configured on the server.');
        return res.status(500).json({ error: 'WhatsApp integration is not configured.' });
    }

    if (!artistWhatsapp || !imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
        return res.status(400).json({ error: 'Missing required parameters for sharing.' });
    }

    const whatsappApiUrl = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
    const headers = {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
    };

    try {
        console.log(`[WhatsApp Debug] Initiating share to: ${artistWhatsapp}`);
        const payload = {
            messaging_product: 'whatsapp',
            to: artistWhatsapp,
            type: 'image',
            image: {
                link: imageUrls[0],
                caption: `Hi ${artistName}! Check out this design.`
            }
        };

        console.log('[WhatsApp Debug] Sending payload:', JSON.stringify(payload, null, 2));

        const response = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        const responseBody = await response.json();
        console.log(`[WhatsApp Debug] Response Status: ${response.status} ${response.statusText}`);
        console.log('[WhatsApp Debug] Response Body:', JSON.stringify(responseBody, null, 2));

        if (!response.ok) {
            throw new Error(`WhatsApp API responded with status ${response.status}: ${JSON.stringify(responseBody)}`);
        }

        res.json({ success: true, message: 'Successfully shared to WhatsApp.' });

    } catch (error) {
        console.error('[WhatsApp Error] Failed to send WhatsApp message:', error.message);
        res.status(500).json({
            error: 'Failed to send message via WhatsApp.',
            details: error.message
        });
    }
});

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
    console.log(`🚀 SLATE backend running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Flux API: ${process.env.FLUX_API_KEY ? 'Configured' : 'Not configured (using mock)'}`);
    console.log(`🔗 Supabase URL: ${SUPABASE_URL ? 'Configured' : 'Not configured'}`);
    console.log(`🔐 Supabase Service Key: ${SUPABASE_SERVICE_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`📦 Supabase Storage Bucket: ${process.env.SUPABASE_STORAGE_BUCKET ? 'Configured' : 'Not configured'}`);
});
