// frontend/js/auth.js

const auth = {
    isLogin: true,
    
    init: () => {
        // frontend/js/auth.js
const auth = {
    isLogin: true,

    init: () => {
        console.log('Auth init function started.'); // ADD THIS LINE

        // Check for saved token and user (demo mode - just check localStorage)
        const savedToken = localStorage.getItem('skintip_token');
        const savedUser = localStorage.getItem('skintip_user');

        console.log('Saved token:', savedToken); // ADD THIS LINE
        console.log('Saved user:', savedUser);   // ADD THIS LINE

        if (savedToken && savedUser) {
            STATE.token = savedToken;
            STATE.user = JSON.parse(savedUser);
            utils.updateTokenDisplay();
            auth.updateUI();
            auth.hideModal();
            console.log('User logged in from localStorage, UI updated.'); // ADD THIS LINE
        } else {
            auth.showModal();
            console.log('No saved login, showing login modal.'); // ADD THIS LINE
        }
        // ... rest of auth.init() ...
    },
    // ... rest of auth module ...
};
        // Check for saved token and user (demo mode - just check localStorage)
        const savedToken = localStorage.getItem('skintip_token');
        const savedUser = localStorage.getItem('skintip_user');
        
        if (savedToken && savedUser) {
            STATE.token = savedToken;
            STATE.user = JSON.parse(savedUser);
            // Crucial: Update tokens display on login if user data loaded from localStorage
            utils.updateTokenDisplay(); 
            auth.updateUI();
            auth.hideModal();
        } else {
            auth.showModal();
        }
        
        // Setup event listeners
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
        const username = document.getElementById('username').value || email.split('@')[0]; // Default username if not provided
        
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
            STATE.userTokens = data.user.tokens_remaining; // Update global state tokens
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
