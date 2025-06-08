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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
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

// Helper function to generate multiple variations
async function generateMultipleVariations(prompt, imageBase64, apiKey) {
    const promises = [];
    
    // Create 4 requests with different seeds
    for (let i = 0; i < 4; i++) {
        promises.push(
            axios.post(
                'https://api.bfl.ai/v1/flux-kontext-pro',
                {
                    prompt: prompt,
                    input_image: imageBase64,
                    seed: Math.floor(Math.random() * 1000000),
                    output_format: 'jpeg',
                    safety_tolerance: 2
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-key': apiKey
                    }
                }
            )
        );
    }
    
    // Submit all requests at once
    const submissions = await Promise.all(promises);
    const taskIds = submissions.map(r => r.data.id);
    console.log('Submitted 4 variations, task IDs:', taskIds);
    
    // Poll all tasks for results
    const images = [];
    for (let i = 0; i < taskIds.length; i++) {
        const taskId = taskIds[i];
        let attempts = 0;
        
        while (attempts < 60) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const result = await axios.get(
                `https://api.bfl.ai/v1/get_result?id=${taskId}`,
                { headers: { 'x-key': apiKey } }
            );
            
            if (result.data.status === 'Ready') {
                images.push(result.data.result.sample);
                console.log(`Variation ${i + 1} complete`);
                break;
            }
            
            if (result.data.status === 'Error') {
                console.error(`Variation ${i + 1} failed:`, result.data);
                images.push(null); // Push null for failed generations
                break;
            }
        }
    }
    
    return images.filter(img => img !== null); // Return only successful images
}

// Generate tattoo endpoint
app.post('/api/generate', upload.single('image'), async (req, res) => {
    try {
        const { prompt, mask } = req.body;
        const styles = req.body.styles ? JSON.parse(req.body.styles) : [];
        const image = req.file;

        if (!image || !prompt) {
            return res.status(400).json({ error: 'Image and prompt are required' });
        }

        // Check if Flux API key is configured
        if (!process.env.FLUX_API_KEY) {
            console.log('Flux API not configured, returning mock data');
            return res.json({
                images: [
                    'https://picsum.photos/512/512?random=1',
                    'https://picsum.photos/512/512?random=2',
                    'https://picsum.photos/512/512?random=3',
                    'https://picsum.photos/512/512?random=4'
                ]
            });
        }

        // Convert image buffer to base64
        const imageBase64 = image.buffer.toString('base64');
        
        // Build a context-aware prompt for Flux Kontext Pro
        const buildKontextPrompt = (userPrompt, selectedStyles) => {
            // Base instruction for adding tattoo
            let kontextPrompt = "Add a tattoo design ";
            
            // Add location if mentioned in the prompt
            if (userPrompt.toLowerCase().includes('arm')) {
                kontextPrompt += "on the arm ";
            } else if (userPrompt.toLowerCase().includes('back')) {
                kontextPrompt += "on the back ";
            } else if (userPrompt.toLowerCase().includes('chest')) {
                kontextPrompt += "on the chest ";
            } else if (userPrompt.toLowerCase().includes('leg')) {
                kontextPrompt += "on the leg ";
            } else {
                kontextPrompt += "on the visible skin area ";
            }
            
            // Add style specifications
            if (selectedStyles.length > 0) {
                kontextPrompt += `in ${selectedStyles.join(' and ')} style `;
            }
            
            // Add the user's description
            kontextPrompt += `depicting ${userPrompt}. `;
            
            // Important: Preserve everything else
            kontextPrompt += "Keep the person, clothing, background, and all other elements exactly the same. Only add the tattoo design on the skin, making it look realistic and naturally integrated with the skin tone and lighting.";
            
            return kontextPrompt;
        };
        
        // Generate 4 variations with different prompts/seeds
        console.log('Generating 4 tattoo variations...');
        const images = await generateMultipleVariations(
            buildKontextPrompt(prompt, styles), 
            imageBase64, 
            process.env.FLUX_API_KEY
        );
        
        if (images.length === 0) {
            return res.status(500).json({ error: 'All generation attempts failed' });
        }
        
        console.log(`Successfully generated ${images.length} variations`);
        res.json({ images });

    } catch (error) {
        console.error('Generation error:', error.response?.data || error.message);
        
        if (error.response?.status === 401) {
            return res.status(401).json({ error: 'Invalid Flux API key' });
        }
        
        if (error.response?.status === 429) {
            return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
        }
        
        res.status(500).json({ error: 'Failed to generate tattoo' });
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
});
