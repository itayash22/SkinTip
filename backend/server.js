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

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cimakagbgcbkwosavbyk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbWFrYWdiZ2Nia3dvc2F2YnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg3Nzc5MDMsImV4cCI6MjA2NDM1MzkwM30.Qj3ZKq-sZZWVdCoFEus5ggEIXSncGFm_FQZ9pEoLcaA';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Update rate limiter
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: false,
    skipSuccessfulRequests: false
});
app.use('/api/', limiter);

// Multer setup for file uploads (memory storage - no persistence)
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

// JWT Middleware
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
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;

        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if user exists
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .or(`email.eq.${email},username.eq.${username}`)
            .single();

        if (existing) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user
        const { data: user, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash: passwordHash,
                username
            })
            .select()
            .single();

        if (error) {
            console.error('Registration error:', error);
            return res.status(500).json({ error: 'Failed to create user' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Registration successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username
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

        // Get user
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
                username: user.username
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Correct Flux Fill function with proper BFL API parameters
async function generateWithFluxFill(prompt, imageBase64, maskBase64, apiKey) {
    console.log('=== Starting Flux Fill Inpainting ===');
    console.log('Prompt:', prompt);
    console.log('Image base64 length:', imageBase64.length);
    console.log('Mask base64 length:', maskBase64.length);
    
    try {
        // IMPORTANT: Based on BFL API documentation
        // The mask should be: BLACK = inpaint area, WHITE = preserve
        
        const requestBody = {
            prompt: prompt,
            image: imageBase64,
            mask: maskBase64,
            seed: Math.floor(Math.random() * 1000000),
            output_format: 'jpeg',
            safety_tolerance: 2,
            // Correct parameter names from BFL API:
            guidance_scale: 30,  // Higher values = stronger prompt adherence
            num_inference_steps: 50  // More steps = better quality
        };
        
        console.log('Request body keys:', Object.keys(requestBody));
        
        const response = await axios.post(
            'https://api.bfl.ai/v1/flux-pro-1.0-fill',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-key': apiKey
                },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );
        
        console.log('BFL API Response:', response.data);
        const taskId = response.data.id;
        
        if (!taskId) {
            throw new Error('No task ID received from API');
        }
        
        // Poll for result
        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = 2000; // 2 seconds
        
        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            
            try {
                const result = await axios.get(
                    `https://api.bfl.ai/v1/get_result?id=${taskId}`,
                    { 
                        headers: { 'x-key': apiKey },
                        timeout: 10000
                    }
                );
                
                console.log(`Polling attempt ${attempts}: ${result.data.status}`);
                
                if (result.data.status === 'Ready') {
                    const imageUrl = result.data.result.sample;
                    console.log('✅ Flux Fill completed successfully');
                    console.log('Result URL:', imageUrl);
                    return [imageUrl];
                }
                
                if (result.data.status === 'Error') {
                    console.error('❌ BFL API Error:', result.data);
                    throw new Error(`API Error: ${JSON.stringify(result.data)}`);
                }
                
                // Continue polling for Pending status
            } catch (pollError) {
                console.error(`Polling error at attempt ${attempts}:`, pollError.message);
                // Continue polling unless it's the last attempt
                if (attempts >= maxAttempts - 1) throw pollError;
            }
        }
        
        throw new Error('Generation timeout after ' + maxAttempts + ' attempts');
        
    } catch (error) {
        console.error('❌ Flux Fill API Error:', error.response?.data || error.message);
        if (error.response?.data) {
            console.error('Full error response:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

// Generate tattoo endpoint
app.post('/api/generate', upload.single('image'), async (req, res) => {
    try {
        console.log('=== Generate endpoint called ===');
        
        const { prompt, mask } = req.body;
        const styles = req.body.styles ? JSON.parse(req.body.styles) : [];
        const image = req.file;
        
        // Validate inputs
        if (!image || !prompt) {
            return res.status(400).json({ error: 'Image and prompt are required' });
        }
        
        if (!mask) {
            return res.status(400).json({ error: 'Mask is required - please draw the tattoo area' });
        }
        
        // Check if Flux API key is configured
        if (!process.env.FLUX_API_KEY) {
            console.log('⚠️ Flux API not configured, returning mock data');
            return res.json({
                images: [
                    'https://picsum.photos/512/512?random=1',
                    'https://picsum.photos/512/512?random=2',
                    'https://picsum.photos/512/512?random=3',
                    'https://picsum.photos/512/512?random=4'
                ]
            });
        }
        
        // Convert image buffer to base64 (no prefix)
        const imageBase64 = image.buffer.toString('base64');
        
        // Extract mask base64 (remove prefix if present)
        let maskBase64;
        if (mask.startsWith('data:')) {
            maskBase64 = mask.split(',')[1];
        } else {
            maskBase64 = mask;
        }
        
        // Validate base64 data
        if (!imageBase64 || imageBase64.length < 100) {
            return res.status(400).json({ error: 'Invalid image data' });
        }
        
        if (!maskBase64 || maskBase64.length < 100) {
            return res.status(400).json({ error: 'Invalid mask data' });
        }
        
        console.log('📊 Data sizes:');
        console.log('- Image base64 length:', imageBase64.length);
        console.log('- Mask base64 length:', maskBase64.length);
        console.log('- Styles:', styles);
        console.log('- Prompt:', prompt);
        
        // Build inpainting prompt specifically for Flux Fill
        // The prompt should describe ONLY what goes in the masked area
        let inpaintPrompt = "";
        
        // Add style prefix if specified
        if (styles.length > 0) {
            inpaintPrompt = styles.join(', ') + " style ";
        }
        
        // Core tattoo description
        inpaintPrompt += `tattoo design of ${prompt}`;
        
        // Add quality modifiers for better results
        inpaintPrompt += ", high quality tattoo art, detailed, on skin";
        
        console.log('🎨 Final inpainting prompt:', inpaintPrompt);
        
        // Generate using Flux Fill
        try {
            const images = await generateWithFluxFill(
                inpaintPrompt, 
                imageBase64,
                maskBase64,
                process.env.FLUX_API_KEY
            );
            
            if (!images || images.length === 0) {
                return res.status(500).json({ error: 'No images were generated' });
            }
            
            console.log(`✅ Successfully generated ${images.length} inpainted image(s)`);
            res.json({ images });
            
        } catch (generationError) {
            console.error('❌ Generation failed:', generationError.message);
            
            // Parse specific error messages
            if (generationError.response?.status === 401) {
                return res.status(401).json({ error: 'Invalid API key. Please check your Flux API configuration.' });
            }
            
            if (generationError.response?.status === 422) {
                const detail = generationError.response.data?.detail;
                if (detail) {
                    return res.status(422).json({ 
                        error: 'Invalid request to Flux API',
                        details: detail 
                    });
                }
            }
            
            if (generationError.response?.status === 429) {
                return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
            }
            
            // Generic error response
            return res.status(500).json({ 
                error: 'Failed to generate tattoo. Please try again.',
                details: generationError.message 
            });
        }
        
    } catch (error) {
        console.error('❌ Endpoint error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
    }
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SkinTip backend running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Flux API: ${process.env.FLUX_API_KEY ? 'Configured' : 'Not configured (using mock)'}`);
    console.log(`💾 Supabase: ${SUPABASE_URL ? 'Configured' : 'Not configured'}`);
});
