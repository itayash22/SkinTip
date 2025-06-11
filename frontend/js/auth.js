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
        const savedUser = localStorage.getItem('skintip_user'); 
        
        console.log('Auth init: Raw saved token:', savedToken); 
        console.log('Auth init: Raw saved user:', savedUser);   
        
        if (savedToken && savedUser) {
            STATE.token = savedToken;
            STATE.user = JSON.parse(savedUser);
            // Before updating display, log what STATE.userTokens holds
            console.log('Auth init: STATE.user.tokens_remaining from localStorage:', STATE.user.tokens_remaining); 
            STATE.userTokens = STATE.user.tokens_remaining; // Ensure STATE.userTokens is set from parsed user
            utils.updateTokenDisplay(); 
            hideAuthModal(); 
            console.log('Auth init: User logged in from localStorage. Current STATE.userTokens:', STATE.userTokens); 
        } else {
            auth.showModal(); 
            console.log('Auth init: No saved login, showing login modal. Current STATE.userTokens:', STATE.userTokens); 
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
            STATE.user = data.user; 
            STATE.userTokens = data.user.tokens_remaining; 

            // LOGGING AFTER RECEIVING FROM BACKEND
            console.log('Auth handleSubmit: Backend response user object:', data.user); 
            console.log('Auth handleSubmit: Backend response tokens_remaining:', data.user.tokens_remaining); 
            console.log('Auth handleSubmit: STATE.userTokens set to:', STATE.userTokens); 

            localStorage.setItem('skintip_token', data.token);
            localStorage.setItem('skintip_user', JSON.stringify(data.user)); 
            
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
        STATE.userTokens = 0; 
        localStorage.removeItem('skintip_token'); 
        localStorage.removeItem('skintip_user'); 
        updateAuthUI(); 
        utils.updateTokenDisplay(); 
        auth.showModal(); 
        
        document.getElementById('authForm').reset();
        console.log('Auth logout: STATE.userTokens after logout:', STATE.userTokens); 
    }
};
