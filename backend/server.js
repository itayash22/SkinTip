const express = require('express');
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
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

console.log('Server setup complete');
