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
// --- END OF ACTUAL IMPORTS ---

// Function to generate a dynamic timestamp for deployment tracking
const getDeploymentTimestamp = () => new Date().toISOString();
console.log(`SERVER_DEPLOY_TIMESTAMP: ${getDeploymentTimestamp()}`);

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

console.log('SERVER STARTUP DEBUG: process.env.FRONTEND_URL =', process.env.FRONTEND_URL);

// Initialize Supabase - SECURITY: Separate clients for different access levels
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY || !process.env.JWT_SECRET || !process.env.FLUX_API_KEY) {
    console.error('CRITICAL ERROR: One or more required environment variables are missing!');
    process.exit(1);
}

// Public client for read operations (uses anon key with RLS)
const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Service client for authenticated/admin operations (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// JWT token expiration times
const ACCESS_TOKEN_EXPIRY = '15m';  // Short-lived access token
const REFRESH_TOKEN_EXPIRY = '7d';  // Longer-lived refresh token

// Middleware
app.use(helmet());

app.use((req, res, next) => {
    next();
});

app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'https://itayash22.github.io',
            'http://localhost:8080',
            'http://127.0.0.1:8080'
        ].filter(Boolean);

        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            const msg = `The CORS policy for this site does not allow access from Origin ${origin}. You should ensure your FRONTEND_URL environment variable is set correctly on Render or add ${origin} to allowed list.`;
            console.error('CORS ERROR: Blocking origin -', origin, msg);
            return callback(new Error(msg), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-key'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// General rate limiter
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

// Expensive endpoint rate limiter (for generate-final-tattoo: 20/hour)
const expensiveLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many generation requests. Please try again later. Limit: 20 per hour.' },
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP
        return req.user?.id || req.ip;
    }
});

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
    res.json({ status: 'OK', message: 'SkinTip API is running' });
});

// Comprehensive health monitoring endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        checks: {}
    };
    
    try {
        // Check Supabase connection
        const startDb = Date.now();
        const { error: dbError } = await supabase.from('users').select('id').limit(1);
        health.checks.database = {
            status: dbError ? 'ERROR' : 'OK',
            responseTime: Date.now() - startDb,
            error: dbError?.message
        };
    } catch (e) {
        health.checks.database = { status: 'ERROR', error: e.message };
    }
    
    try {
        // Check Flux API (just verify key exists)
        health.checks.fluxApi = {
            status: process.env.FLUX_API_KEY ? 'CONFIGURED' : 'NOT_CONFIGURED'
        };
    } catch (e) {
        health.checks.fluxApi = { status: 'ERROR', error: e.message };
    }
    
    // Overall status
    const hasErrors = Object.values(health.checks).some(c => c.status === 'ERROR');
    health.status = hasErrors ? 'DEGRADED' : 'OK';
    
    res.status(hasErrors ? 503 : 200).json(health);
});

// Internal endpoint for cron-based cleanup of expired images
app.post('/api/internal/cleanup-expired-images', async (req, res) => {
    // Verify cron secret
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) {
        return res.status(403).json({ error: 'Invalid cron secret' });
    }
    
    try {
        const now = new Date().toISOString();
        
        // Find expired images
        const { data: expiredImages, error: fetchError } = await supabase
            .from('image_metadata')
            .select('id, storage_path')
            .lt('expires_at', now)
            .is('deleted_at', null)
            .limit(100);
        
        if (fetchError) {
            throw new Error(`Failed to fetch expired images: ${fetchError.message}`);
        }
        
        let deletedCount = 0;
        const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';
        
        for (const img of expiredImages || []) {
            try {
                // Delete from storage
                if (img.storage_path) {
                    await supabase.storage.from(bucket).remove([img.storage_path]);
                }
                
                // Mark as deleted in metadata
                await supabase
                    .from('image_metadata')
                    .update({ deleted_at: now })
                    .eq('id', img.id);
                
                deletedCount++;
            } catch (e) {
                console.error(`Failed to delete image ${img.id}:`, e.message);
            }
        }
        
        console.log(`Cleanup: Deleted ${deletedCount} expired images`);
        res.json({ deleted: deletedCount, checked: expiredImages?.length || 0 });
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({ error: 'Cleanup failed', details: error.message });
    }
});

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if token is blacklisted
        const { data: blacklisted } = await supabase
            .from('token_blacklist')
            .select('id')
            .eq('token', token)
            .single();
        
        if (blacklisted) {
            return res.status(403).json({ error: 'Token has been revoked' });
        }
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        req.user = user;
        req.token = token; // Store token for potential blacklisting on logout
        next();
    } catch (error) {
        console.error('Authentication error:', error.message);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Admin-only middleware
const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Log user events (analytics/tracking)
app.post('/api/log-event', authenticateToken, async (req, res) => {
    try {
        const { eventType, artistId, stencilId, timestamp, extraDetails } = req.body;
        const userId = req.user.id;

        if (!eventType) {
            return res.status(400).json({ error: 'Event type is required' });
        }

        // Validate UUIDs if provided (prevent SQL injection)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (artistId && !uuidRegex.test(artistId)) {
            return res.status(400).json({ error: 'Invalid artist ID format' });
        }
        if (stencilId && !uuidRegex.test(stencilId)) {
            return res.status(400).json({ error: 'Invalid stencil ID format' });
        }

        const { error } = await supabase
            .from('user_events')
            .insert({
                user_id: userId,
                event_type: eventType,
                artist_id: artistId || null,
                stencil_id: stencilId || null,
                extra_details: extraDetails || null,
                created_at: timestamp || new Date().toISOString()
            });

        if (error) {
            console.error('Failed to log user event:', error.message);
            // Don't block user experience for logging failures
            return res.status(200).json({ logged: false, message: 'Event logging skipped' });
        }

        res.json({ logged: true });
    } catch (error) {
        console.error('Error in /api/log-event:', error.message);
        // Return 200 to not block user experience
        res.status(200).json({ logged: false, message: 'Event logging skipped' });
    }
});

// Get all artists (public endpoint - uses anon key)
app.get('/api/artists', async (req, res) => {
    try {
        const { data, error } = await supabasePublic
            .from('artists')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching artists:', error.message);
            return res.status(500).json({ error: 'Failed to fetch artists' });
        }

        // Transform data for frontend compatibility
        const artists = (data || []).map(artist => ({
            id: artist.id,
            name: artist.name,
            location: artist.location || 'Unknown',
            bio: artist.bio || '',
            styles: artist.styles || [],
            portfolio: artist.portfolio_urls || [],
            whatsapp: artist.whatsapp || '',
            likes: artist.likes || 0
        }));

        res.json(artists);
    } catch (error) {
        console.error('Error in /api/artists:', error.message);
        res.status(500).json({ error: 'Failed to fetch artists' });
    }
});

// Get tattoo styles with their stencils (public endpoint - uses anon key)
app.get('/api/styles-with-stencils', async (req, res) => {
    try {
        // First get stencils - try simpler query first (using public client)
        const { data: stencils, error: stencilError } = await supabasePublic
            .from('tattoo_sketches')
            .select('*');

        if (stencilError) {
            console.error('Error fetching stencils:', stencilError);
            return res.status(500).json({ 
                error: 'Failed to fetch stencils', 
                details: stencilError.message,
                code: stencilError.code,
                hint: stencilError.hint
            });
        }
        
        console.log('Fetched stencils count:', stencils?.length || 0);
        
        // Filter active stencils in code
        const activeStencils = (stencils || []).filter(s => s.is_active !== false);

        // Get artists separately
        const artistIds = [...new Set(activeStencils.map(s => s.artist_id).filter(Boolean))];
        let artistMap = {};
        
        if (artistIds.length > 0) {
            const { data: artists, error: artistError } = await supabasePublic
                .from('artists')
                .select('id, name, whatsapp')
                .in('id', artistIds);
            
            if (!artistError && artists) {
                artists.forEach(a => { artistMap[a.id] = a; });
            }
        }

        // Group stencils by style
        const styleMap = {};
        activeStencils.forEach(stencil => {
            const style = stencil.style || 'Other';
            if (!styleMap[style]) {
                styleMap[style] = [];
            }
            const artist = stencil.artist_id ? artistMap[stencil.artist_id] : null;
            styleMap[style].push({
                id: stencil.id,
                imageUrl: stencil.image_url,
                tags: stencil.tags || [],
                isArtistSketch: !!stencil.is_artist_sketch,
                artist: artist ? {
                    id: artist.id,
                    name: artist.name,
                    whatsapp: artist.whatsapp
                } : null
            });
        });

        res.json(styleMap);
    } catch (error) {
        console.error('Error in /api/styles-with-stencils:', error);
        res.status(500).json({ error: 'Failed to fetch stencils', details: error.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;

        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Validate username (alphanumeric, 3-30 chars)
        const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
        if (!usernameRegex.test(username)) {
            return res.status(400).json({ error: 'Username must be 3-30 alphanumeric characters' });
        }

        // SECURITY: Use separate queries to avoid SQL injection via .or()
        const { data: existingEmail } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();
            
        const { data: existingUsername } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (existingEmail || existingUsername) {
            return res.status(409).json({ error: 'User with this email or username already exists' });
        }

        const passwordHash = await bcryptjs.hash(password, 12); // Increased rounds

        const { data: newUser, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash: passwordHash,
                username,
                tokens_remaining: 20,
                is_admin: false
            })
            .select()
            .single();

        if (error) {
            console.error('Registration error:', error);
            return res.status(500).json({ error: 'Failed to create user' });
        }

        // Generate short-lived access token
        const accessToken = jwt.sign(
            { userId: newUser.id, email: newUser.email, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );
        
        // Generate refresh token
        const refreshToken = jwt.sign(
            { userId: newUser.id, type: 'refresh' },
            process.env.JWT_SECRET,
            { expiresIn: REFRESH_TOKEN_EXPIRY }
        );
        
        // Store refresh token in database
        await supabase.from('refresh_tokens').insert({
            user_id: newUser.id,
            token: refreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

        res.json({
            message: 'Registration successful',
            token: accessToken,
            refreshToken,
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

        // Generate short-lived access token
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );
        
        // Generate refresh token
        const refreshToken = jwt.sign(
            { userId: user.id, type: 'refresh' },
            process.env.JWT_SECRET,
            { expiresIn: REFRESH_TOKEN_EXPIRY }
        );
        
        // Store refresh token in database
        await supabase.from('refresh_tokens').insert({
            user_id: user.id,
            token: refreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

        res.json({
            message: 'Login successful',
            token: accessToken,
            refreshToken,
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

// Refresh token endpoint
app.post('/api/auth/refresh-token', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }
        
        // Verify refresh token
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(403).json({ error: 'Invalid or expired refresh token' });
        }
        
        if (decoded.type !== 'refresh') {
            return res.status(403).json({ error: 'Invalid token type' });
        }
        
        // Check if refresh token exists in database
        const { data: storedToken, error: tokenError } = await supabase
            .from('refresh_tokens')
            .select('*')
            .eq('token', refreshToken)
            .eq('user_id', decoded.userId)
            .single();
        
        if (tokenError || !storedToken) {
            return res.status(403).json({ error: 'Refresh token not found or revoked' });
        }
        
        // Check if expired
        if (new Date(storedToken.expires_at) < new Date()) {
            await supabase.from('refresh_tokens').delete().eq('id', storedToken.id);
            return res.status(403).json({ error: 'Refresh token expired' });
        }
        
        // Get user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', decoded.userId)
            .single();
        
        if (userError || !user) {
            return res.status(403).json({ error: 'User not found' });
        }
        
        // Generate new access token
        const newAccessToken = jwt.sign(
            { userId: user.id, email: user.email, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );
        
        res.json({
            token: newAccessToken,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                tokens_remaining: user.tokens_remaining
            }
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// Logout endpoint - blacklists current token
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        // Blacklist the current access token
        const token = req.token;
        const decoded = jwt.decode(token);
        
        await supabase.from('token_blacklist').insert({
            token,
            user_id: req.user.id,
            expires_at: new Date(decoded.exp * 1000).toISOString()
        });
        
        // Also delete any refresh tokens for this user (optional: could keep them)
        // await supabase.from('refresh_tokens').delete().eq('user_id', req.user.id);
        
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
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

// Admin-only endpoint to add tokens to a user (SECURED with requireAdmin)
app.post('/api/admin/add-tokens', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { targetUserId, amount } = req.body;
        const amountToAdd = parseInt(amount);

        if (!targetUserId || isNaN(amountToAdd) || amountToAdd <= 0) {
            return res.status(400).json({ error: 'Valid targetUserId and positive amount required.' });
        }

        const { data: targetUser, error: fetchError } = await supabase
            .from('users')
            .select('tokens_remaining')
            .eq('id', targetUserId)
            .single();

        if (fetchError || !targetUser) {
            return res.status(404).json({ error: 'Target user not found.' });
        }

        const newTokensRemaining = targetUser.tokens_remaining + amountToAdd;

        const { error } = await supabase
            .from('users')
            .update({ tokens_remaining: newTokensRemaining })
            .eq('id', targetUserId);

        if (error) {
            throw new Error(`Supabase update failed: ${error.message}`);
        }

        console.log(`Admin ${req.user.id} added ${amountToAdd} tokens to user ${targetUserId}. New balance: ${newTokensRemaining}`);

        res.json({
            message: `Successfully added ${amountToAdd} tokens. New balance: ${newTokensRemaining}.`,
            tokens_remaining: newTokensRemaining
        });
    } catch (error) {
        console.error('Error in /api/admin/add-tokens:', error.message);
        res.status(500).json({ error: 'Failed to add tokens' });
    }
});

// Admin-only endpoint to upload new sketches to the database (RESTORED)
app.post('/api/admin/upload-sketch', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        const { style, isArtistSketch, tags, artistId, newArtistName, newArtistWhatsapp, newArtistLocation, newArtistInstagram } = req.body;
        const imageFile = req.file;

        if (!imageFile) {
            return res.status(400).json({ error: 'Image file is required.' });
        }

        let finalArtistId = artistId;

        // 1. Handle New Artist creation if needed
        if (isArtistSketch === 'true' && newArtistName) {
            const { data: newArtist, error: artistError } = await supabase
                .from('artists')
                .insert({
                    name: newArtistName,
                    whatsapp_number: newArtistWhatsapp || '',
                    location: newArtistLocation || '',
                    portfolio_urls: newArtistInstagram ? [newArtistInstagram] : []
                })
                .select()
                .single();

            if (artistError) throw artistError;
            finalArtistId = newArtist.id;
        }

        // 2. Upload image to Supabase Storage
        const fileName = `${Date.now()}-${imageFile.originalname}`;
        const filePath = `sketches/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
            .from(process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos')
            .upload(filePath, imageFile.buffer, {
                contentType: imageFile.mimetype,
                upsert: true
            });

        if (uploadError) throw uploadError;

        // Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from(process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos')
            .getPublicUrl(filePath);

        // 3. Insert record into tattoo_sketches
        const { data: sketch, error: sketchError } = await supabase
            .from('tattoo_sketches')
            .insert({
                image_url: publicUrl,
                style: style || 'Freestyle',
                is_artist_sketch: isArtistSketch === 'true',
                artist_id: finalArtistId || null,
                tags: tags ? tags.split(',').map(t => t.trim()) : [],
                is_active: true
            })
            .select()
            .single();

        if (sketchError) throw sketchError;

        res.json({ success: true, sketch });

    } catch (error) {
        console.error('Error in upload-sketch:', error);
        res.status(500).json({ error: error.message || 'Failed to upload sketch' });
    }
});

app.post('/api/generate-final-tattoo',
    authenticateToken,
    expensiveLimiter,
    upload.fields([
        { name: 'skinImage', maxCount: 1 },
        { name: 'tattooDesignImage', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            console.log('API: /api/generate-final-tattoo endpoint called.');

            const userId = req.user.id;
            const { mask, prompt: userPromptText } = req.body;
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
                process.env.FLUX_API_KEY // Corresponds to 'fluxApiKey' in fluxPlacementHandler.js
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

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
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
    console.log(`🚀 SkinTip backend running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Flux API: ${process.env.FLUX_API_KEY ? 'Configured' : 'Not configured (using mock)'}`);
    console.log(`🔗 Supabase URL: ${SUPABASE_URL ? 'Configured' : 'Not configured'}`);
    console.log(`🔐 Supabase Service Key: ${SUPABASE_SERVICE_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`📦 Supabase Storage Bucket: ${process.env.SUPABASE_STORAGE_BUCKET ? 'Configured' : 'Not configured'}`);
});
