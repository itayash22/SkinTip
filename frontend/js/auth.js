// frontend/js/auth.js

const auth = {
    modal: null,
    authForm: null,
    authTitle: null,
    emailInput: null,
    passwordInput: null,
    usernameGroup: null,
    usernameInput: null,
    authSwitchText: null,
    authSwitchLink: null,
    authError: null,
    logoutBtn: null,
    userInfoSpan: null,

    isRegisterMode: false,

    init: () => {
        // Get elements for the modal (which is now in welcome.html)
        auth.modal = document.getElementById('authModal');
        auth.authForm = document.getElementById('authForm');
        auth.authTitle = document.getElementById('authTitle');
        auth.emailInput = document.getElementById('email');
        auth.passwordInput = document.getElementById('password');
        auth.usernameGroup = document.getElementById('usernameGroup');
        auth.usernameInput = document.getElementById('username');
        auth.authSwitchText = document.getElementById('authSwitchText');
        auth.authSwitchLink = document.getElementById('authSwitchLink');
        auth.authError = document.getElementById('authError');
        
        // These elements are in index.html, but auth.js needs to manage them globally
        auth.logoutBtn = document.getElementById('logoutBtn');
        auth.userInfoSpan = document.getElementById('userInfo');

        console.log('Auth init function started.');

        // Load token and user info from localStorage on init
        const savedToken = localStorage.getItem('jwt_token');
        const savedRefreshToken = localStorage.getItem('refresh_token');
        const savedUser = localStorage.getItem('user_info');
        const savedExpiresAt = localStorage.getItem('token_expires_at');
        console.log('Auth init: Raw saved token:', savedToken);
        console.log('Auth init: Raw saved user:', savedUser);

        if (savedToken && savedUser) {
            STATE.token = savedToken;
            STATE.refreshToken = savedRefreshToken;
            STATE.tokenExpiresAt = savedExpiresAt ? parseInt(savedExpiresAt) : null;
            
            try {
                STATE.user = JSON.parse(savedUser);
                STATE.userTokens = STATE.user.tokens_remaining;
                console.log('Auth init: STATE.user.tokens_remaining from localStorage:', STATE.userTokens);
                
                // Check if token is expired or about to expire
                const now = Date.now();
                if (STATE.tokenExpiresAt && STATE.tokenExpiresAt <= now) {
                    // Token already expired - try to refresh immediately
                    console.log('Token expired, attempting refresh...');
                    auth.refreshAccessToken().then(success => {
                        if (!success) {
                            utils.showToast('Session expired. Please log in again.', 'info', 0, 'Log In', () => auth.showModal('login'));
                            auth.forceLogoutAndShowModal();
                        }
                    });
                } else if (STATE.tokenExpiresAt) {
                    // Schedule refresh before expiry
                    auth.scheduleTokenRefresh();
                }
                
                auth.updateUIForAuth(true);
            } catch (e) {
                console.error('Failed to parse user info from localStorage:', e);
                auth.clearAuthData();
                auth.updateUIForAuth(false);
            }
        } else {
            auth.updateUIForAuth(false);
        }

        // Only set up event listeners if on a page that uses the modal or logout button
        if (auth.modal) { 
             auth.authForm.addEventListener('submit', auth.handleAuthSubmit);
             auth.authSwitchLink.addEventListener('click', auth.toggleAuthMode);
             
             // NEW: Close modal button
             const closeBtn = document.getElementById('closeAuthModalBtn');
             if (closeBtn) {
                 closeBtn.addEventListener('click', auth.hideModal);
             }
        }
        
        // NEW: Login/Register buttons in navbar (if they exist)
        const navLoginBtn = document.getElementById('loginBtn');
        const navRegisterBtn = document.getElementById('registerBtn');
        if (navLoginBtn) navLoginBtn.addEventListener('click', () => auth.showModal('login'));
        if (navRegisterBtn) navRegisterBtn.addEventListener('click', () => auth.showModal('register'));

        if (auth.logoutBtn) { // Logout button is in index.html
            auth.logoutBtn.addEventListener('click', auth.logout);
        }

    },

    // Show auth modal, optionally setting mode
    showModal: (mode = 'login') => {
        if (auth.modal) {
            auth.modal.style.display = 'flex'; // Use flex for centering
            auth.authError.textContent = ''; // Clear previous errors
            auth.authForm.reset(); // Clear form fields
            auth.setAuthMode(mode === 'register');
        }
    },

    hideModal: () => {
        if (auth.modal) {
            auth.modal.style.display = 'none';
        }
    },

    setAuthMode: (isRegister) => {
        auth.isRegisterMode = isRegister;
        if (isRegister) {
            auth.authTitle.textContent = 'Register for SkinTip';
            auth.authSwitchText.textContent = 'Already have an account?';
            auth.authSwitchLink.textContent = 'Login';
            auth.authForm.querySelector('button[type="submit"]').textContent = 'Register';
            auth.usernameGroup.style.display = 'block';
            auth.usernameInput.setAttribute('required', 'required');
        } else {
            auth.authTitle.textContent = 'Login to SkinTip';
            auth.authSwitchText.textContent = "Don't have an account?";
            auth.authSwitchLink.textContent = 'Register';
            auth.authForm.querySelector('button[type="submit"]').textContent = 'Login';
            auth.usernameGroup.style.display = 'none';
            auth.usernameInput.removeAttribute('required');
        }
    },

    toggleAuthMode: (e) => {
        e.preventDefault();
        auth.setAuthMode(!auth.isRegisterMode);
    },

    handleAuthSubmit: async (e) => {
        e.preventDefault();
        auth.authError.textContent = ''; // Clear previous errors
        utils.showLoading('Authenticating...');

        const email = auth.emailInput.value;
        const password = auth.passwordInput.value;
        const username = auth.usernameInput.value; // Only used for register

        let endpoint = auth.isRegisterMode ? 'register' : 'login';
        let body = { email, password };
        if (auth.isRegisterMode) {
            body.username = username;
        }
        // --- START DEBUGGING SNIPPET for handleAuthSubmit ---
        console.log('DEBUG: Attempting authentication API call.');
        console.log('DEBUG: Endpoint:', `${CONFIG.API_URL}/auth/${endpoint}`);
        console.log('DEBUG: Request Body:', JSON.stringify(body));
        // --- END DEBUGGING SNIPPET ---

        try {
            const response = await fetch(`${CONFIG.API_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
    });

    // --- START DEBUGGING SNIPPET for response ---
    console.log('DEBUG: API Response Status:', response.status);
    console.log('DEBUG: API Response OK:', response.ok);
    // --- END DEBUGGING SNIPPET ---

    const data = await response.json(); // Attempt to parse JSON even if !response.ok
                                        // Make sure this doesn't fail if response is empty

    // --- START DEBUGGING SNIPPET for response data ---
    console.log('DEBUG: API Response Data:', data);
    // --- END DEBUGGING SNIPPET ---

    utils.hideLoading();

    if (!response.ok) {
        auth.authError.textContent = data.error || 'Authentication failed (unknown error)'; // Show error from backend
        console.error('Authentication failed:', data.error || 'Unknown API error');
        return; // Stop here if login failed via backend response
    }

    // Authentication successful
    STATE.token = data.token;
    STATE.refreshToken = data.refreshToken;
    STATE.user = data.user;
    STATE.userTokens = data.user.tokens_remaining;
    STATE.tokenExpiresAt = Date.now() + CONFIG.ACCESS_TOKEN_DURATION_MS;
    
    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('refresh_token', data.refreshToken);
    localStorage.setItem('user_info', JSON.stringify(data.user));
    localStorage.setItem('token_expires_at', STATE.tokenExpiresAt.toString());

    // Schedule automatic token refresh before expiry
    auth.scheduleTokenRefresh();

    auth.hideModal();
    auth.updateUIForAuth(true);

    // No longer redirecting to index.html from welcome.html as we are staying on index.html
    // if (window.location.pathname.split('/').pop() === 'welcome.html') {
    //     window.location.href = 'index.html';
    // }
    
    // Refresh page to ensure all states are clean if needed, or just let it be
    // location.reload(); 

} catch (error) {
    utils.hideLoading();
    auth.authError.textContent = error.message; // Display the fetch error message
    console.error('Authentication Network Error:', error);
    // --- START DEBUGGING SNIPPET for fetch error ---
    console.log('DEBUG: Full network error object:', error);
    // --- END DEBUGGING SNIPPET ---

    // If it's a network error during login, it's often a sign of session issues or backend problems
    if (error.message.includes('Failed to fetch') || (error instanceof TypeError)) {
         utils.showError('Couldn\'t connect. Please check your internet and try again.');
         // Optionally, if login specifically fails due to network, you might also trigger a hard logout/modal
         // if you suspect a deeper issue preventing *any* communication with the backend.
         // For now, let's just log and display the error message.
         // If you want to force logout here:
         // if (typeof auth !== 'undefined' && auth.forceLogoutAndShowModal) {
         //     auth.forceLogoutAndShowModal();
         // }
    }
}
    },

    logout: () => {
        auth.clearAuthData();
        auth.updateUIForAuth(false);
        // No longer redirecting to welcome page
        // window.location.href = 'index.html'; // Optionally refresh the page
        location.reload(); 
    },

    clearAuthData: () => {
        // Clear refresh timer
        if (STATE.tokenRefreshTimer) {
            clearTimeout(STATE.tokenRefreshTimer);
            STATE.tokenRefreshTimer = null;
        }
        STATE.token = null;
        STATE.refreshToken = null;
        STATE.tokenExpiresAt = null;
        STATE.user = null;
        STATE.userTokens = 0;
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_info');
        localStorage.removeItem('token_expires_at');
    },

    // Schedule automatic token refresh before expiry
    scheduleTokenRefresh: () => {
        if (STATE.tokenRefreshTimer) {
            clearTimeout(STATE.tokenRefreshTimer);
        }
        
        const timeUntilExpiry = STATE.tokenExpiresAt - Date.now();
        const refreshIn = Math.max(0, timeUntilExpiry - CONFIG.TOKEN_REFRESH_BUFFER_MS);
        
        console.log(`Token refresh scheduled in ${Math.round(refreshIn / 1000)} seconds`);
        
        STATE.tokenRefreshTimer = setTimeout(async () => {
            console.log('Auto-refreshing access token...');
            const success = await auth.refreshAccessToken();
            if (!success) {
                utils.showToast('Session expired. Please log in again.', 'info', 0, 'Log In', () => auth.showModal('login'));
                auth.forceLogoutAndShowModal();
            }
        }, refreshIn);
    },

    // Refresh access token using refresh token
    refreshAccessToken: async () => {
        if (!STATE.refreshToken) {
            console.log('No refresh token available');
            return false;
        }
        
        try {
            const response = await fetch(`${CONFIG.API_URL}/auth/refresh-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: STATE.refreshToken })
            });
            
            if (!response.ok) {
                console.error('Token refresh failed:', response.status);
                return false;
            }
            
            const data = await response.json();
            STATE.token = data.token;
            STATE.tokenExpiresAt = Date.now() + CONFIG.ACCESS_TOKEN_DURATION_MS;
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('token_expires_at', STATE.tokenExpiresAt.toString());
            
            // Schedule next refresh
            auth.scheduleTokenRefresh();
            console.log('Access token refreshed successfully');
            return true;
        } catch (error) {
            console.error('Token refresh error:', error);
            return false;
        }
    },

    // Force logout and show login modal (called when token expires during API call)
    forceLogoutAndShowModal: () => {
        auth.clearAuthData();
        auth.updateUIForAuth(false);
        auth.showModal('login');
    },

    updateUIForAuth: (isAuthenticated) => {
        // Ensure userInfoSpan and logoutBtn are correctly referenced before using them
        const userInfoSpan = document.getElementById('userInfo');
        const logoutBtn = document.getElementById('logoutBtn');
        const loginBtn = document.getElementById('loginBtn');
        const registerBtn = document.getElementById('registerBtn');
        const deleteAccountBtn = document.getElementById('deleteAccountBtn');

        if (isAuthenticated) {
            if (userInfoSpan && STATE.user) { // Check STATE.user exists too
                userInfoSpan.textContent = `${STATE.user.username || STATE.user.email} (${STATE.userTokens} tokens)`;
                userInfoSpan.style.display = 'inline-block'; // Ensure it's visible
            }
            if (logoutBtn) {
                logoutBtn.style.display = 'inline-block';
            }
            if (deleteAccountBtn) {
                deleteAccountBtn.style.display = 'inline-block';
            }
            if (loginBtn) loginBtn.style.display = 'none';
            if (registerBtn) registerBtn.style.display = 'none';
            
            utils.updateTokenDisplay(); // Refresh token display on app page (index.html)
            
            // Start inactivity timer after successful authentication
            if (typeof window.startInactivityTimer === 'function') {
                window.startInactivityTimer();
            }
        } else { // Not authenticated
            if (userInfoSpan) {
                userInfoSpan.textContent = '';
                userInfoSpan.style.display = 'none'; // Hide if not logged in
            }
            if (logoutBtn) {
                logoutBtn.style.display = 'none';
            }
            if (deleteAccountBtn) {
                deleteAccountBtn.style.display = 'none';
            }
            if (loginBtn) loginBtn.style.display = 'inline-block';
            if (registerBtn) registerBtn.style.display = 'inline-block';
        }
    }
};

// Expose the auth object globally
window.auth = auth;
