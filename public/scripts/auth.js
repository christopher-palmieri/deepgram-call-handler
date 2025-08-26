// public/scripts/auth.js
// Handles login and TOTP MFA authentication

let currentFactorId = null;

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
        
        if (!factors || !factors.totp || factors.totp.length === 0) {
            // No MFA set up yet - show setup form
            authMessage.innerHTML = '<div class="success-message">Please set up two-factor authentication</div>';
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('totpSetupForm').style.display = 'block';
            return;
        }
        
        // Check for TOTP factor (authenticator app)
        const totpFactor = factors.totp.find(f => f.factor_type === 'totp');
        if (totpFactor) {
            currentFactorId = totpFactor.id;
            
            const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
                factorId: totpFactor.id
            });
            
            if (challengeError) throw challengeError;
            
            authMessage.innerHTML = '<div class="success-message">Enter code from your authenticator app</div>';
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('mfaForm').style.display = 'block';
        } else {
            // No MFA configured, proceed to dashboard
            authMessage.innerHTML = '<div class="success-message">Login successful!</div>';
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 500);
        }
        
    } catch (error) {
        authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
    }
});

// Handle TOTP setup (first-time MFA)
document.getElementById('totpSetupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const authMessage = document.getElementById('authMessage');
    const setupBtn = document.getElementById('setupTotpBtn');
    
    setupBtn.disabled = true;
    setupBtn.textContent = 'Setting up...';
    
    try {
        // Enroll TOTP factor (authenticator app)
        const { data: factor, error } = await supabase.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: 'IVR Monitor'
        });
        
        if (error) throw error;
        
        currentFactorId = factor.id;
        
        // Show QR code for authenticator app
        const qrContainer = document.getElementById('qrCodeContainer');
        qrContainer.innerHTML = `
            <img src="${factor.qr_code}" alt="MFA QR Code" style="margin: 20px auto; display: block; max-width: 256px;">
            <p style="margin: 15px 0; font-size: 12px; color: #666;">
                Can't scan? Enter this code manually: <br>
                <code style="font-size: 10px; word-break: break-all;">${factor.secret}</code>
            </p>
        `;
        qrContainer.style.display = 'block';
        
        authMessage.innerHTML = '<div class="success-message">Scan QR code, then enter the verification code</div>';
        document.getElementById('totpSetupForm').style.display = 'none';
        document.getElementById('mfaForm').style.display = 'block';
        
    } catch (error) {
        authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
    } finally {
        setupBtn.disabled = false;
        setupBtn.textContent = 'Setup Authenticator';
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
        
        // Hide QR code if it's visible
        const qrContainer = document.getElementById('qrCodeContainer');
        if (qrContainer) {
            qrContainer.style.display = 'none';
        }
        
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

// No resend needed for TOTP since codes regenerate every 30 seconds
document.getElementById('resendBtn').style.display = 'none';
