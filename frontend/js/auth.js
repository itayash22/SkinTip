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
        
        // Demo mode - just save to localStorage
        const user = { email, username };
        localStorage.setItem('skintip_user', JSON.stringify(user));
        STATE.user = user;
        
        auth.updateUI();
        auth.hideModal();
        
        // Show success message
        utils.showError(`Welcome to SkinTip, ${username}! (Demo mode - no backend yet)`);
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
