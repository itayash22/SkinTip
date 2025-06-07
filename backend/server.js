const express = require('express');
console.log('Environment check:');
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting server...');

// Basic middleware
app.use(express.json());

// Logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Routes
app.get('/', (req, res) => {
    console.log('Root route handler executed');
    res.json({ status: 'OK', message: 'SkinTip API is running' });
});

app.get('/api/health', (req, res) => {
    console.log('Health route handler executed');
    res.json({ status: 'OK', message: 'SkinTip API health check' });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
// Start server
const server = app.listen(PORT, '0.0.0.0', (err) => {
    if (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
    console.log(`Railway should proxy to this server`);
});

// Keep the process alive
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server');
    server.close(() => {
        console.log('Server closed');
    });
});

console.log('Server setup complete');
