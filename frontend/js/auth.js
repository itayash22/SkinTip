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

        const currentPage = window.location.pathname.split('/').pop();

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
            // Not logged in
            auth.updateUIForAuth(false); // Update UI for logged-out state
            // If on the welcome page AND not logged in, explicitly hide the modal on load
            if (currentPage === 'welcome.html' && auth.modal) {
                auth.hideModal(); // Ensure it's hidden if it's the welcome page and user is not logged in
            }
        }

        // --- Handle Redirection based on Auth Status ---
        // This must come AFTER auth.updateUIForAuth because it relies on STATE.token to be set
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
        // --- START DEBUGGING SNIPPET for handleAuthSubmit ---
console.log('DEBUG: Attempting authentication API call.');
console.log('DEBUG: Endpoint:', `<span class="math-inline">\{CONFIG\.API\_URL\}/auth/</span>{endpoint}`);
console.log('DEBUG: Request Body:', JSON.stringify(body));
// --- END DEBUGGING SNIPPET ---

        try {
    const response = await fetch(`<span class="math-inline">\{CONFIG\.API\_URL\}/auth/</span>{endpoint}`, {
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
    auth.authError.textContent = error.message; // Display the fetch error message
    console.error('Authentication Network Error:', error);
    // --- START DEBUGGING SNIPPET for fetch error ---
    console.log('DEBUG: Full network error object:', error);
    // --- END DEBUGGING SNIPPET ---

    // If it's a network error during login, it's often a sign of session issues or backend problems
    if (error.message.includes('Failed to fetch') || (error instanceof TypeError)) {
         utils.showError('Login failed: Network or server issue. Please try again.');
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
        // Ensure userInfoSpan and logoutBtn are correctly referenced before using them
        const userInfoSpan = document.getElementById('userInfo');
        const logoutBtn = document.getElementById('logoutBtn');
        const loginBtn = document.getElementById('loginBtn'); // For welcome.html
        const registerBtn = document.getElementById('registerBtn'); // For welcome.html
        const heroRegisterBtn = document.getElementById('heroRegisterBtn'); // For welcome.html

        if (isAuthenticated) {
            if (userInfoSpan && STATE.user) { // Check STATE.user exists too
                userInfoSpan.textContent = `${STATE.user.username || STATE.user.email} (${STATE.userTokens} tokens)`;
                userInfoSpan.style.display = 'inline-block'; // Ensure it's visible
            }
            if (logoutBtn) {
                logoutBtn.style.display = 'inline-block';
            }
            // Hide welcome page buttons if on welcome.html and logged in
            const currentPage = window.location.pathname.split('/').pop();
            if (currentPage === 'welcome.html') {
                if (loginBtn) loginBtn.style.display = 'none';
                if (registerBtn) registerBtn.style.display = 'none';
                if (heroRegisterBtn) heroRegisterBtn.style.display = 'none';
            }
            utils.updateTokenDisplay(); // Refresh token display on app page (index.html)
        } else { // Not authenticated
            if (userInfoSpan) {
                userInfoSpan.textContent = '';
                userInfoSpan.style.display = 'none'; // Hide if not logged in
            }
            if (logoutBtn) {
                logoutBtn.style.display = 'none';
            }
            // Show welcome page buttons if on welcome.html and logged out
            const currentPage = window.location.pathname.split('/').pop();
            if (currentPage === 'welcome.html') {
                if (loginBtn) loginBtn.style.display = 'inline-block';
                if (registerBtn) registerBtn.style.display = 'inline-block';
                if (heroRegisterBtn) heroRegisterBtn.style.display = 'inline-block';
            }
        }
    }
};

// Expose the auth object globally
window.auth = auth;
