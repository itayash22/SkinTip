// frontend/js/app.js

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎨 SkinTip initializing...');
    
    // Show auth modal on load
    const authModal = document.getElementById('authModal');
    authModal.style.display = 'block';
    
    // Auth form handling
    const authForm = document.getElementById('authForm');
    const authSwitchLink = document.getElementById('authSwitchLink');
    const authTitle = document.getElementById('authTitle');
    const authSwitchText = document.getElementById('authSwitchText');
    const usernameGroup = document.getElementById('usernameGroup');
    const authError = document.getElementById('authError');
    
    let isLogin = true;
    
    // Toggle between login and register
    authSwitchLink.addEventListener('click', (e) => {
        e.preventDefault();
        isLogin = !isLogin;
        
        if (isLogin) {
            authTitle.textContent = 'Login to SkinTip';
            authSwitchLink.textContent = 'Register';
            authSwitchText.textContent = "Don't have an account?";
            usernameGroup.style.display = 'none';
            authForm.querySelector('button[type="submit"]').textContent = 'Login';
        } else {
            authTitle.textContent = 'Create Your Account';
            authSwitchLink.textContent = 'Login';
            authSwitchText.textContent = 'Already have an account?';
            usernameGroup.style.display = 'block';
            authForm.querySelector('button[type="submit"]').textContent = 'Register';
        }
        
        authError.textContent = '';
    });
    
    // Handle form submission
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const username = document.getElementById('username').value;
        
        // For now, just close the modal and show the upload area
        authModal.style.display = 'none';
        document.getElementById('userInfo').textContent = `Welcome, ${email}`;
        document.getElementById('logoutBtn').style.display = 'inline-block';
        
        // Show success message
        alert(`${isLogin ? 'Login' : 'Registration'} successful! (Demo mode - no backend yet)`);
    });
    
    // Logout handling
    document.getElementById('logoutBtn').addEventListener('click', () => {
        document.getElementById('userInfo').textContent = '';
        document.getElementById('logoutBtn').style.display = 'none';
        authModal.style.display = 'block';
        authForm.reset();
    });
    
    // File upload handling
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#6366f1';
        uploadArea.style.backgroundColor = 'rgba(99, 102, 241, 0.05)';
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '#e5e7eb';
        uploadArea.style.backgroundColor = '#f9fafb';
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#e5e7eb';
        uploadArea.style.backgroundColor = '#f9fafb';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
    
    function handleFile(file) {
        // Check file type
        if (!CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
            alert('Please upload a JPEG, PNG, or WebP image.');
            return;
        }
        
        // Check file size
        if (file.size > CONFIG.MAX_FILE_SIZE) {
            alert('File size must be less than 5MB.');
            return;
        }
        
        // For now, just show success
        alert(`File "${file.name}" uploaded successfully! (Demo mode - full features coming soon)`);
    }
    
    console.log('✅ SkinTip ready!');
});
