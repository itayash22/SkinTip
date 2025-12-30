// frontend/js/config.js

const CONFIG = {
    API_URL: 'https://skintip-backend.onrender.com/api', // Update this when you deploy backend
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    DEFAULT_BRUSH_SIZE: 20,
    DAILY_LIMIT: 2, // This might become less relevant with token system
    INACTIVITY_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes inactivity timeout
    
    // Define token costs for each API action
    TOKEN_COSTS: {
        FLUX_PLACEMENT: 15 // Cost for one Flux tattoo placement (3 variations, watermarked)
    }
};

// Global state variables for the application
const STATE = {
    user: null, // Stores authenticated user info
    token: null, // Stores JWT token for API authentication
    userTokens: 0, // NEW: Tracks the user's current token balance
    uploadedTattooDesignBase64: null, // NEW: Stores the Base64 of the user's uploaded tattoo design
    currentImage: null, // Stores the user's uploaded skin photo (File object)
    currentMask: null, // Stores the Base64 of the drawing mask
    generatedImages: [], // Stores URLs of generated tattoo images from Flux
    currentArtists: [], // Stores loaded artist data
    currentSlide: 0 // For artist portfolio carousel
};

// Utility functions for common UI/API tasks
const utils = {
    showLoading: (text = 'Generating your tattoo designs...') => {
        const loadingOverlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        if (loadingOverlay && loadingText) {
            loadingText.textContent = text;
            loadingOverlay.style.display = 'flex'; // Use 'flex' for centering and visibility
            console.log('Loading overlay displayed:', text);
        } else {
            console.warn('Loading overlay elements (loadingOverlay or loadingText) not found. Cannot display loading.');
        }
    },

    hideLoading: () => {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
            console.log('Loading overlay hidden.');
        }
    },

    showError: (message) => {
        alert(`Error: ${message}`);
    },

    // Get authorization headers for API requests
    getAuthHeaders: () => {
        if (STATE.token) {
            return {
                'Authorization': `Bearer ${STATE.token}`,
                'Content-Type': 'application/json' // Default content type
            };
        }
        return { 'Content-Type': 'application/json' };
    },

    // Utility to update the token display on the UI
    updateTokenDisplay: () => {
        console.log('utils.updateTokenDisplay: Attempting to update UI with STATE.userTokens:', STATE.userTokens);
        const creditsRemainingDisplay = document.getElementById('creditsRemaining');
        if (creditsRemainingDisplay) {
            creditsRemainingDisplay.textContent = `${STATE.userTokens} tokens remaining`;
        }
        const generateCostDisplay = document.getElementById('generateCostDisplay');
        if (generateCostDisplay) {
            generateCostDisplay.textContent = CONFIG.TOKEN_COSTS.FLUX_PLACEMENT;
        }
    }
};
