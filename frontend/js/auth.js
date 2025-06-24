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
    userInfoSpan: null, // Ensure this is correctly referenced

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
        auth.userInfoSpan = document.getElementById('userInfo'); // Make sure this reference is solid

        // Initial UI update for the top-right area (based on loaded state)
        if (auth.userInfoSpan) {
            auth.userInfoSpan.textContent = STATE.user ? `${STATE.user.username || STATE.user.email} (${STATE.userTokens} tokens)` : 'Guest';
            auth.userInfoSpan.style.display = STATE.user ? 'inline-block' : 'none'; // Show/hide based on login
        }
        if (auth.logoutBtn) {
            auth.logoutBtn.style.display = STATE.token ? 'block' : 'none'; // Show/hide based on token presence
        }

        console.log('Auth init function started.');

        // Load token and user info from localStorage on init
        const savedToken = localStorage.getItem('jwt_token');
        const savedUser = localStorage.getItem('user_info');
        console.log('Auth init: Raw saved token:', savedToken);
        console.log('Auth init: Raw saved user:', savedUser);

        if (savedToken && savedUser) {
            STATE.token = savedToken;
            try {
                STATE.user = JSON.parse(savedUser);
                
                // --- JWT Expiration Check on Page Load ---
                // Ensure jwt-decode library is loaded in index.html for this to work
                if (typeof jwt_decode === 'function') {
                    const decodedToken = jwt_decode(savedToken);
                    // Check if token's expiration time (exp) is in the past
                    if (decodedToken.exp * 1000 < Date.now()) { // exp is in seconds, Date.now() is ms
                        console.log("Auth init: Token found but already expired. Forcing logout.");
                        auth.forceLogoutAndShowModal(); // Use the existing robust logout function
                        return; // Stop execution of init, effectively logging out
                    }
                } else {
                    console.warn("jwt-decode library not found. Skipping frontend JWT expiration check.");
                }
                // --- END JWT Expiration Check on Page Load ---

                STATE.userTokens = STATE.user.tokens_remaining; // Load tokens from saved user info
                console.log('Auth init: STATE.user.tokens_remaining from localStorage:', STATE.userTokens);
                auth.updateUIForAuth(true); // Update UI for logged-in state
            } catch (e) {
                console.error('Failed to parse user info or decode token from localStorage:', e); // Updated error message
                auth.clearAuthData(); // Clear corrupted or invalid token data
                auth.updateUIForAuth(false);
            }
        } else {
            auth.updateUIForAuth(false); // Update UI for logged-out state
        }

        // --- Handle Redirection based on Auth Status ---
        const currentPage = window.location.pathname.split('/').pop();

        if (!STATE.token && currentPage === 'index.html') {
            // Not logged in and trying to access main app, redirect to welcome
            window.location.href = 'welcome.html';
            return; // Stop further execution for this page load
        } else if (STATE.token && currentPage === 'welcome.html') {
            // Logged in and on welcome page, redirect to main app
            window.location.href = 'index.html';
            return; // Stop further execution for this page load
        }

        // Only set up event listeners if on a page that uses the modal or logout button
        if (auth.modal) { // Check if modal elements are present on this page (e.g., welcome.html)
            auth.authForm.addEventListener('submit', auth.handleAuthSubmit);
            auth.authSwitchLink.addEventListener('click', auth.toggleAuthMode);
        }
        if (auth.logoutBtn) { // Logout button is in index.html
            auth.logoutBtn.addEventListener('click', auth.logout);
        }

        // This log should now correctly reflect the user's state after all checks
        console.log(`Auth init: User state after init. Logged in: ${STATE.user ? 'Yes' : 'No'}, Tokens: ${STATE.userTokens}`);
    }, // End of init function

    // Show auth modal, optionally setting mode
    showModal: (mode = 'login') => {
        if (auth.modal) {
            auth.modal.style.display = 'block';
            auth.authError.textContent = ''; // Clear previous errors
            auth.authForm.reset(); // Clear form fields
            auth.setAuthMode(mode === 'register');
        }
    },

    forceLogoutAndShowModal: function() {
        console.log("Forcing logout due to expired session.");
        // Clear all stored authentication data
        localStorage.removeItem('jwt_token'); // Use 'jwt_token' as per your localStorage key
        localStorage.removeItem('user_info'); // Use 'user_info' as per your localStorage key
        // If you implement refresh tokens later, clear them here too
        // localStorage.removeItem('refreshToken');

        // Reset global STATE variables
        STATE.user = null;
        STATE.token = null;
        STATE.userTokens = 0; // Reset tokens

        // Update UI to reflect logged-out state
        if (typeof utils !== 'undefined' && utils.updateTokenDisplay) {
            utils.updateTokenDisplay();
        }
        if (auth.userInfoSpan) { // Use auth property
            auth.userInfoSpan.textContent = 'Guest';
            auth.userInfoSpan.style.display = 'inline-block'; // Ensure it's visible as 'Guest'
        }
        if (auth.logoutBtn) { // Use auth property
            auth.logoutBtn.style.display = 'none';
        }
        // Display login modal with a clear message (assuming showModal works for this)
        this.showModal(); // 'this' refers to the auth object
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

        try {
            const response = await fetch(`${CONFIG.API_URL}/auth/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();
            utils.hideLoading();

            if (!response.ok) {
                throw new Error(data.error || 'Authentication failed');
            }

            // Authentication successful
            STATE.token = data.token;
            STATE.user = data.user;
            STATE.userTokens = data.user.tokens_remaining; // Update global state
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_info', JSON.stringify(data.user));

            auth.hideModal();
            auth.updateUIForAuth(true); // Call updateUIForAuth to refresh display
            
            // Redirect to index.html after successful auth, if on welcome.html
            if (window.location.pathname.split('/').pop() === 'welcome.html') {
                window.location.href = 'index.html';
            }

        } catch (error) {
            utils.hideLoading();
            auth.authError.textContent = error.message;
            console.error('Authentication error:', error);
        }
    },

    logout: () => {
        auth.clearAuthData();
        auth.updateUIForAuth(false);
        // Redirect to welcome page after logout
        window.location.href = 'welcome.html';
    },

    clearAuthData: () => {
        STATE.token = null;
        STATE.user = null;
        STATE.userTokens = 0;
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_info');
    },

    updateUIForAuth: (isAuthenticated) => {
        // Use the already referenced elements (auth.userInfoSpan, auth.logoutBtn)
        const userInfoSpan = auth.userInfoSpan;
        const logoutBtn = auth.logoutBtn;
        // These elements are on welcome.html, so still get them here
        const loginBtn = document.getElementById('loginBtn'); 
        const registerBtn = document.getElementById('registerBtn');
        const heroRegisterBtn = document.getElementById('heroRegisterBtn');

        if (isAuthenticated) {
            if (userInfoSpan && STATE.user) {
                userInfoSpan.textContent = `${STATE.user.username || STATE.user.email} (${STATE.userTokens} tokens)`;
                userInfoSpan.style.display = 'inline-block'; // Ensure it's visible
            }
            if (logoutBtn) {
                logoutBtn.style.display = 'block'; // Show logout button
            }
            // Hide welcome page buttons if on welcome.html and logged in
            const currentPage = window.location.pathname.split('/').pop();
            if (currentPage === 'welcome.html') {
                if (loginBtn) loginBtn.style.display = 'none';
                if (registerBtn) registerBtn.style.display = 'none';
                if (heroRegisterBtn) heroRegisterBtn.style.display = 'none';
            }
        } else { // Not authenticated (logged out)
            if (userInfoSpan) {
                userInfoSpan.textContent = 'Guest'; // Set to Guest
                userInfoSpan.style.display = 'inline-block'; // Ensure it's visible as 'Guest'
            }
            if (logoutBtn) {
                logoutBtn.style.display = 'none'; // Hide logout button
            }
            // Show welcome page buttons if on welcome.html and logged out
            const currentPage = window.location.pathname.split('/').pop();
            if (currentPage === 'welcome.html') {
                if (loginBtn) loginBtn.style.display = 'inline-block';
                if (registerBtn) registerBtn.style.display = 'inline-block';
                if (heroRegisterBtn) heroRegisterBtn.style.display = 'inline-block';
            }
        }
    },
};

// Expose the auth object globally
window.auth = auth;
