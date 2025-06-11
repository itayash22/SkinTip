// frontend/js/auth.js

// Define updateUI and hideModal as standalone functions first.
// This ensures they are fully parsed and available before being referenced as methods of 'auth'.
function updateAuthUI() {
    if (STATE.user) {
        document.getElementById('userInfo').textContent = `Welcome, ${STATE.user.username}`;
        document.getElementById('logoutBtn').style.display = 'inline-block';
    } else {
        document.getElementById('userInfo').textContent = '';
        document.getElementById('logoutBtn').style.display = 'none';
    }
}

function hideAuthModal() {
    document.getElementById('authModal').style.display = 'none';
}

const auth = {
    isLogin: true,
    
    init: () => {
        console.log('Auth init function started.'); 
        // Check for saved token and user (demo mode - just check localStorage)
        const savedToken = localStorage.getItem('skintip_token');
        const savedUser = localStorage.getItem('skintip_user'); // Corrected from sk-intip_user
        
        console.log('Saved token:', savedToken);
        console.log('Saved user:', savedUser);
        
        if (savedToken && savedUser) {
            STATE.token = savedToken;
            STATE.user = JSON.parse(savedUser);
            // Crucial: Update tokens display on login if user data loaded from localStorage
            utils.updateTokenDisplay(); 
            updateAuthUI(); // Call the standalone function
            hideAuthModal(); // Call the standalone function
            console.log('User logged in from localStorage, UI updated.'); 
        } else {
            auth.showModal(); // This method is simple enough to be part of the object literal.
            console.log('No saved login, showing login modal.'); 
        }
        
        // Setup event listeners
        document.getElementById('authForm').addEventListener('submit', auth.handleSubmit);
        document.getElementById('authSwitchLink').addEventListener('click', auth.toggleMode);
        document.getElementById('logoutBtn').addEventListener('click', auth.logout);
    },
    
    showModal: () => {
        document.getElementById('authModal').style.display = 'block';
    },
    
    // Assign the standalone functions to the object properties
    updateUI: updateAuthUI, 
    hideModal: hideAuthModal,
    
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
            localStorage.setItem('skintip_user', JSON.stringify(data.user)); // Corrected from sk-intip_user
            
            // Update UI (user info in navbar, tokens display)
            updateAuthUI(); // Call the standalone function
            utils.updateTokenDisplay(); // Call global utility to update token display
            hideAuthModal(); // Call the standalone function
            
        } catch (error) {
            document.getElementById('authError').textContent = error.message;
        }
    },
    
    logout: () => {
        STATE.user = null;
        STATE.token = null;
        STATE.userTokens = 0; // Clear tokens on logout
        localStorage.removeItem('skintip_token'); // Remove token from localStorage
        localStorage.removeItem('skintip_user'); // Corrected from sk-intip_user
        updateAuthUI(); // Call the standalone function
        utils.updateTokenDisplay(); // Refresh token display
        auth.showModal(); // Show login modal
        
        // Reset form for next login/register
        document.getElementById('authForm').reset();
    }
    // frontend/js/auth.js

// ... (existing code up to init) ...

const auth = {
    isLogin: true,
    
    init: () => {
        console.log('Auth init function started.'); 
        const savedToken = localStorage.getItem('skintip_token');
        const savedUser = localStorage.getItem('skintip_user'); 
        
        console.log('Auth init: Raw saved token:', savedToken); // ADD THIS
        console.log('Auth init: Raw saved user:', savedUser);   // ADD THIS
        
        if (savedToken && savedUser) {
            STATE.token = savedToken;
            STATE.user = JSON.parse(savedUser);
            // Before updating display, log what STATE.userTokens holds
            console.log('Auth init: STATE.user.tokens_remaining from localStorage:', STATE.user.tokens_remaining); // ADD THIS
            STATE.userTokens = STATE.user.tokens_remaining; // Ensure STATE.userTokens is set from parsed user
            utils.updateTokenDisplay(); 
            hideAuthModal(); 
            console.log('Auth init: User logged in from localStorage. Current STATE.userTokens:', STATE.userTokens); // ADD THIS
        } else {
            auth.showModal(); 
            console.log('Auth init: No saved login, showing login modal. Current STATE.userTokens:', STATE.userTokens); // ADD THIS
        }
        
        // ... (rest of auth.init) ...
    },
    
    // ... (rest of auth object) ...

    handleSubmit: async (e) => {
        e.preventDefault();
        // ... (existing code for email, password, username, endpoint, body) ...
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
            STATE.user = data.user; 
            STATE.userTokens = data.user.tokens_remaining; // Update global state tokens

            // LOGGING AFTER RECEIVING FROM BACKEND
            console.log('Auth handleSubmit: Backend response user object:', data.user); // ADD THIS
            console.log('Auth handleSubmit: Backend response tokens_remaining:', data.user.tokens_remaining); // ADD THIS
            console.log('Auth handleSubmit: STATE.userTokens set to:', STATE.userTokens); // ADD THIS

            localStorage.setItem('skintip_token', data.token);
            localStorage.setItem('skintip_user', JSON.stringify(data.user)); // Should save full user object including tokens_remaining
            
            // Update UI (user info in navbar, tokens display)
            updateAuthUI(); 
            utils.updateTokenDisplay(); 
            hideAuthModal(); 
            
        } catch (error) {
            document.getElementById('authError').textContent = error.message;
        }
    },
    
    logout: () => {
        STATE.user = null;
        STATE.token = null;
        STATE.userTokens = 0; // Clear tokens on logout
        localStorage.removeItem('skintip_token'); 
        localStorage.removeItem('skintip_user'); 
        updateAuthUI(); 
        utils.updateTokenDisplay(); 
        auth.showModal(); 
        document.getElementById('authForm').reset();
        console.log('Auth logout: STATE.userTokens after logout:', STATE.userTokens); // ADD THIS
    }
};
};
