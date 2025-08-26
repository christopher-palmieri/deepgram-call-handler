// public/scripts/auth.js
// Handles login and MFA authentication

let currentFactorId = null;
let currentPhoneNumber = null;

// Wait for config to load
window.addEventListener('DOMContentLoaded', async () => {
    await loadConfig(); // From config.js
    
    if (!supabase) {
        document.getElementById('authMessage').innerHTML = 
            '<div class="error-message">Failed to initialize. Please refresh.</div>';
        return;
    }
    
    // Check if already logged in
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        window.location.href = '/dashboard.html';
    }
});

// Handle email/password login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    const authMessage = document.getElementById('authMessage');
    const loginBtn = document.getElementById('loginBtn');
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    authMessage.innerHTML = '';
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        // Check if user has MFA set up
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        
        if (factorsError || !factors?.totp?.length) {
            // No MFA required or first time
            if (!factorsError) {
                // First time - need to set up MFA
                authMessage.innerHTML = '<div class="success-message">Please set up two-factor authentication</div>';
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('phoneSetupForm').style.display = 'block';
            } else {
                // No MFA required, proceed to dashboard
                authMessage.innerHTML = '<div class="success-message">Login successful!</div>';
                setTimeout(() => {
                    window.location.href = '/dashboard.html';
                }, 500);
            }
            return;
        }
        
        // MFA already set up - send challenge
        const phoneFactor = factors.totp.find(f => f.factor_type === 'phone');
        if (phoneFactor) {
            currentFactorId = phoneFactor.id;
            
            const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
                factorId: phoneFactor.id
            });
            
            if (challengeError) throw challengeError;
            
            authMessage.innerHTML = '<div class="success-message">Verification code sent!</div>';
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('mfaForm').style.display = 'block';
        }
        
    } catch (error) {
        authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
    }
});

// Handle phone setup (first-time MFA)
document.getElementById('phoneSetupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phone = document.getElementById('phoneInput').value;
    const authMessage = document.getElementById('authMessage');
    const setupBtn = document.getElementById('setupPhoneBtn');
    
    currentPhoneNumber = phone;
    setupBtn.disabled = true;
    setupBtn.textContent = 'Sending...';
    
    try {
        const { data: factor, error } = await supabase.auth.mfa.enroll({
            factorType: 'phone',
            phone: phone
        });
        
        if (error) throw error;
        
        currentFactorId = factor.id;
        
        authMessage.innerHTML = `<div class="success-message">Code sent to ${phone}</div>`;
        document.getElementById('phoneSetupForm').style.display = 'none';
        document.getElementById('mfaForm').style.display = 'block';
        
    } catch (error) {
        authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
    } finally {
        setupBtn.disabled = false;
        setupBtn.textContent = 'Send Verification Code';
    }
});

// Handle MFA verification
document.getElementById('mfaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const otp = document.getElementById('otpInput').value;
    const authMessage = document.getElementById('authMessage');
    const verifyBtn = document.getElementById('verifyBtn');
    
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';
    
    try {
        const { data, error } = await supabase.auth.mfa.verify({
            factorId: currentFactorId,
            code: otp
        });
        
        if (error) throw error;
        
        authMessage.innerHTML = '<div class="success-message">Verification successful!</div>';
        
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 500);
        
    } catch (error) {
        authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
    }
});

// Resend code button
document.getElementById('resendBtn').addEventListener('click', async () => {
    const authMessage = document.getElementById('authMessage');
    
    try {
        const { data: challenge, error } = await supabase.auth.mfa.challenge({
            factorId: currentFactorId
        });
        
        if (error) throw error;
        
        authMessage.innerHTML = '<div class="success-message">New code sent!</div>';
    } catch (error) {
        authMessage.innerHTML = `<div class="error-message">Failed to resend: ${error.message}</div>`;
    }
});
