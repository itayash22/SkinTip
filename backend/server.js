const express = require('express');
const cors = require('cors');

const app = express();

// Get port from Railway
const PORT = parseInt(process.env.PORT) || 3000;

// Enable trust proxy - IMPORTANT for Railway
app.set('trust proxy', true);

// Basic middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Health check routes - MUST be before other routes
app.get('/', (req, res) => {
    res.status(200).send('SkinTip API is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', port: PORT });
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'SkinTip API' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server - Railway style
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on 0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Server stopped');
    });
});
