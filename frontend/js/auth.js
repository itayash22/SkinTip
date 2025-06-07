// frontend/js/auth.js

const auth = {
    isLogin: true,
    
    init: () => {
        // Check for saved token (demo mode - just check localStorage)
        const savedUser = localStorage.getItem('skintip_user');
        
        if (savedUser) {
            STATE.user = JSON.parse(savedUser);
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
            switchText.textContent = 'Already have an account?';
            switchLink.textContent = 'Login';
            usernameGroup.style.display = 'block';
            document.getElementById('username').setAttribute('required', 'required');
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
            
            // Save token and user data
            STATE.token = data.token;
            STATE.user = data.user;
            localStorage.setItem('skintip_token', data.token);
            localStorage.setItem('skintip_user', JSON.stringify(data.user));
            
            // Update UI
            auth.updateUI();
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
        localStorage.removeItem('skintip_user');
        auth.updateUI();
        auth.showModal();
        
        // Reset form
        document.getElementById('authForm').reset();
    }
};
