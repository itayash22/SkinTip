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
        const savedUser = localStorage.getItem('user_info');
        console.log('Auth init: Raw saved token:', savedToken);
        console.log('Auth init: Raw saved user:', savedUser);

        if (savedToken && savedUser) {
            STATE.token = savedToken;
            try {
                STATE.user = JSON.parse(savedUser);
                STATE.userTokens = STATE.user.tokens_remaining; // Load tokens from saved user info
                console.log('Auth init: STATE.user.tokens_remaining from localStorage:', STATE.userTokens);
                auth.updateUIForAuth(true); // Update UI for logged-in state
            } catch (e) {
                console.error('Failed to parse user info from localStorage:', e);
                auth.clearAuthData(); // Clear corrupted data
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

        console.log('Auth init: User logged in from localStorage. Current STATE.userTokens:', STATE.userTokens);
    },

    // Show auth modal, optionally setting mode
    showModal: (mode = 'login') => {
        if (auth.modal) {
            auth.modal.style.display = 'block';
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
            auth.updateUIForAuth(true);
            
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
        if (isAuthenticated) {
            if (auth.userInfoSpan) {
                auth.userInfoSpan.textContent = `${STATE.user.username || STATE.user.email} (${STATE.userTokens} tokens)`;
            }
            if (auth.logoutBtn) {
                auth.logoutBtn.style.display = 'inline-block';
            }
            // Hide welcome page buttons if on welcome.html and logged in
            if (window.location.pathname.split('/').pop() === 'welcome.html') {
                document.getElementById('loginBtn')?.style.display = 'none';
                document.getElementById('registerBtn')?.style.display = 'none';
                document.getElementById('heroRegisterBtn')?.style.display = 'none';
            }
            utils.updateTokenDisplay(); // Refresh token display on app page
        } else {
            if (auth.userInfoSpan) {
                auth.userInfoSpan.textContent = '';
            }
            if (auth.logoutBtn) {
                auth.logoutBtn.style.display = 'none';
            }
            // Show welcome page buttons if on welcome.html and logged out
            if (window.location.pathname.split('/').pop() === 'welcome.html') {
                document.getElementById('loginBtn')?.style.display = 'inline-block';
                document.getElementById('registerBtn')?.style.display = 'inline-block';
                document.getElementById('heroRegisterBtn')?.style.display = 'inline-block';
            }
        }
    }
};

// Expose the auth object globally
window.auth = auth;
