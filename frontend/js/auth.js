// frontend/js/auth.js

const auth = {
    isLogin: true,
    
    init: async () => { // Made init async to allow for API call
        const savedToken = localStorage.getItem('skintip_token');
        
        if (savedToken) {
            STATE.token = savedToken;
            try {
                // Fetch fresh user data from backend using the saved token
                const response = await fetch(`${CONFIG.API_URL}/auth/me`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${savedToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    STATE.user = data.user; // Get fresh user object
                    STATE.userTokens = data.user.tokens_remaining; // Crucial: Update global state tokens from fresh data
                    auth.updateUI(); // Update UI with fresh user info
                    utils.updateTokenDisplay(); // Call global utility to update token display
                    auth.hideModal(); // Hide modal if successfully logged in
                } else {
                    // Token might be invalid or expired, clear session and show login
                    console.error('Failed to fetch fresh user data:', response.status);
                    auth.logout(); // Force logout
                }
            } catch (error) {
                console.error('Network error during user data refresh:', error);
                auth.logout(); // Force logout on network error
            }
        } else {
            // No token, show login modal
            auth.showModal();
        }
        
        // Setup event listeners (remain the same)
        document.getElementById('authForm').addEventListener('submit', auth.handleSubmit);
        document.getElementById('authSwitchLink').addEventListener('click', auth.toggleMode);
        document.getElementById('logoutBtn').addEventListener('click', auth.logout);
    },
    
    showModal: () => {
        document.getElementById('authModal').style.display = 'block';
    },
    
    hideModal: () => {
        document.getElementById('authModal').style.display = 'none';
    },
    
    toggleMode: (e) => {
        e.preventDefault();
        auth.isLogin = !auth.isLogin;
        
        const title = document.getElementById('authTitle');
        const submitBtn = document.querySelector('#authForm button[type="submit"]');
        const switchText = document.getElementById('authSwitchText');
        const switchLink = document.getElementById('authSwitchLink');
        const usernameGroup = document.getElementById('usernameGroup');
        
        if (auth.isLogin) {
            title.textContent = 'Login to SkinTip';
            submitBtn.textContent = 'Login';
            switchText.textContent = "Don't have an account?";
            switchLink.textContent = 'Register';
            usernameGroup.style.display = 'none';
            document.getElementById('username').removeAttribute('required');
        } else {
            title.textContent = 'Create Your Account';
            submitBtn.textContent = 'Register';
            document.getElementById('username').setAttribute('required', 'required'); // Ensure required when registering
            switchText.textContent = 'Already have an account?';
            switchLink.textContent = 'Login';
            usernameGroup.style.display = 'block';
        }
        
        document.getElementById('authError').textContent = '';
    },
    
    handleSubmit: async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const username = document.getElementById('username').value || email.split('@')[0];
        
        const endpoint = auth.isLogin ? '/auth/login' : '/auth/register';
        const body = auth.isLogin ? 
            { email, password } : 
            { email, password, username };
        
        try {
            const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Authentication failed');
            }
            
            // Save token and user data (including tokens_remaining)
            STATE.token = data.token;
            STATE.user = data.user; // This now includes tokens_remaining from backend
            STATE.userTokens = data.user.tokens_remaining; // Update global state tokens from fresh login/register
            localStorage.setItem('skintip_token', data.token);
            localStorage.setItem('skintip_user', JSON.stringify(data.user)); // Store full user object
            
            // Update UI (user info in navbar, tokens display)
            auth.updateUI();
            utils.updateTokenDisplay(); // Call global utility to update token display
            auth.hideModal();
            
        } catch (error) {
            document.getElementById('authError').textContent = error.message;
        }
    },
    
    updateUI: () => {
        if (STATE.user) {
            document.getElementById('userInfo').textContent = `Welcome, ${STATE.user.username}`;
            document.getElementById('logoutBtn').style.display = 'inline-block';
        } else {
            document.getElementById('userInfo').textContent = '';
            document.getElementById('logoutBtn').style.display = 'none';
        }
    },
    
    logout: () => {
        STATE.user = null;
        STATE.token = null;
        STATE.userTokens = 0; // Clear tokens on logout
        localStorage.removeItem('skintip_token'); // Remove token from localStorage
        localStorage.removeItem('skintip_user');
        auth.updateUI();
        utils.updateTokenDisplay(); // Refresh token display
        auth.showModal(); // Show login modal
        
        // Reset form for next login/register
        document.getElementById('authForm').reset();
    }
};
