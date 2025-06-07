// frontend/js/config.js

const CONFIG = {
    API_URL: 'https://skintip-backend.onrender.com/api', // Update this when you deploy backend
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    DEFAULT_BRUSH_SIZE: 20,
    DAILY_LIMIT: 2
};

// Global state
const STATE = {
    user: null,
    token: null,
    currentImage: null,
    currentMask: null,
    generatedImages: [],
    currentArtists: [],
    currentSlide: 0
};

// Utility functions
const utils = {
    showLoading: (text = 'Loading...') => {
        console.log('Loading:', text);
    },
    
    hideLoading: () => {
        console.log('Loading complete');
    },
    
    showError: (message) => {
        alert(`Error: ${message}`);
    },
    
    getAuthHeaders: () => ({
        'Authorization': `Bearer ${STATE.token}`,
        'Content-Type': 'application/json'
    })
};
