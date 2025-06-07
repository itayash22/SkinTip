// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL || 'https://cimakagbgcbkwosavbyk.supabase.co',
    process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbWFrYWdiZ2Nia3dvc2F2YnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg3Nzc5MDMsImV4cCI6MjA2NDM1MzkwM30.Qj3ZKq-sZZWVdCoFEus5ggEIXSncGFm_FQZ9pEoLcaA'
);
);

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());

// Multer setup for file uploads (memory storage - no persistence)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
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
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'SkinTip API is running' });
});

// Start server
app.listen(PORT, () => {
    console.log(`SkinTip backend running on port ${PORT}`);
});
