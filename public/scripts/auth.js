// public/scripts/auth.js
// Handles login and TOTP MFA authentication

let currentFactorId = null;
let currentChallenge = null;
let supabaseClient = null; // Will be set after config loads

// Wait for config to load
window.addEventListener('DOMContentLoaded', async () => {
    await loadConfig(); // From config.js
    
    // Get the supabase client from global scope
    supabaseClient = window.supabaseClient || window.supabase || supabase;
    
    if (!supabaseClient) {
        document.getElementById('authMessage').innerHTML = 
            '<div class="error-message">Failed to initialize. Please refresh.</div>';
        return;
    }
    
    // Check if already logged in
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        window.location.href = '/dashboard.html';
    }
});

// Handle email/password login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!supabaseClient) {
        alert('Please refresh the page - authentication not initialized');
        return;
    }
    
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    const authMessage = document.getElementById('authMessage');
    const loginBtn = document.getElementById('loginBtn');
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    authMessage.innerHTML = '';
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password,
            options: {
                shouldCreateUser: false
            }
        });
        
        console.log('Login response:', data);
        if (error) {
            console.error('Login error:', error);
            throw error;
        }
        
        // Check MFA assurance level
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        // Check if MFA is required but not completed
        if (session?.user && (!session.aal || session.aal === 'aal1')) {
            // User needs to complete MFA
            try {
                // Check if user has MFA factors set up
                const { data: factors, error: factorsError } = await supabaseClient.auth.mfa.listFactors();
                
                if (factorsError) {
                    console.error('Error listing factors:', factorsError);
                    // No MFA set up, proceed to setup
                    authMessage.innerHTML = '<div class="success-message">Please set up two-factor authentication</div>';
                    document.getElementById('loginForm').style.display = 'none';
                    document.getElementById('totpSetupForm').style.display = 'block';
                    return;
                }
                
                // Check for existing TOTP factor
                if (factors?.totp && factors.totp.length > 0) {
                    const totpFactor = factors.totp[0];
                    currentFactorId = totpFactor.id;
                    
                    console.log('Found existing TOTP factor:', totpFactor);
                    
                    // Create MFA challenge for existing factor
                    const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({
                        factorId: totpFactor.id
                    });
                    
                    if (challengeError) {
                        console.error('Challenge error:', challengeError);
                        throw challengeError;
                    }
                    
                    currentChallenge = challenge;
                    authMessage.innerHTML = '<div class="success-message">Enter code from your authenticator app</div>';
                    document.getElementById('loginForm').style.display = 'none';
                    // Hide setup form and QR container if they exist
                    const setupForm = document.getElementById('totpSetupForm');
                    if (setupForm) setupForm.style.display = 'none';
                    const qrContainer = document.getElementById('qrCodeContainer');
                    if (qrContainer) qrContainer.style.display = 'none';
                    document.getElementById('mfaForm').style.display = 'block';
                } else {
                    // No MFA factors, show setup
                    authMessage.innerHTML = '<div class="success-message">Please set up two-factor authentication</div>';
                    document.getElementById('loginForm').style.display = 'none';
                    document.getElementById('totpSetupForm').style.display = 'block';
                }
            } catch (mfaError) {
                console.error('MFA check error:', mfaError);
                // If MFA check fails, try to proceed without it
                authMessage.innerHTML = '<div class="success-message">Login successful!</div>';
                setTimeout(() => {
                    window.location.href = '/dashboard.html';
                }, 500);
            }
        } else if (session?.aal === 'aal2') {
            // MFA already completed, proceed to dashboard
            authMessage.innerHTML = '<div class="success-message">Login successful!</div>';
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 500);
        } else {
            // No MFA required, proceed to dashboard
            authMessage.innerHTML = '<div class="success-message">Login successful!</div>';
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 500);
        }
        
    } catch (error) {
        console.error('Login error:', error);
        authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
    }
});

// Handle TOTP setup (first-time MFA)
document.getElementById('totpSetupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!supabaseClient) {
        alert('Please refresh the page - authentication not initialized');
        return;
    }
    
    const authMessage = document.getElementById('authMessage');
    const setupBtn = document.getElementById('setupTotpBtn');
    
    setupBtn.disabled = true;
    setupBtn.textContent = 'Setting up...';
    
    try {
        // First, unenroll any existing factors (clean slate approach)
        const { data: existingFactors } = await supabaseClient.auth.mfa.listFactors();
        console.log('Existing factors:', existingFactors);
        
        if (existingFactors?.totp?.length > 0) {
            authMessage.innerHTML = '<div class="success-message">Removing old authenticator setup...</div>';
            for (const factor of existingFactors.totp) {
                const { error: unenrollError } = await supabaseClient.auth.mfa.unenroll({ 
                    factorId: factor.id 
                });
                if (unenrollError) {
                    console.error('Error removing factor:', unenrollError);
                } else {
                    console.log('Removed existing factor:', factor.id);
                }
            }
            // Small delay to ensure cleanup completes
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Now enroll new TOTP factor
        authMessage.innerHTML = '<div class="success-message">Creating new authenticator setup...</div>';
        const { data: factor, error } = await supabaseClient.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: 'Auth App ' + new Date().getTime() // Unique name to avoid conflicts
        });
        
        if (error) {
            console.error('Enrollment error:', error);
            throw error;
        }
        
        currentFactorId = factor.id;
        console.log('New factor enrolled:', factor);
        
        // Show QR code for authenticator app
        const qrContainer = document.getElementById('qrCodeContainer');
        if (qrContainer && factor.qr_code) {
            qrContainer.innerHTML = `
                <img src="${factor.qr_code}" alt="MFA QR Code" style="margin: 20px auto; display: block; max-width: 256px;">
                <p style="margin: 15px 0; font-size: 12px; color: #666;">
                    Can't scan? Enter this code manually: <br>
                    <code style="font-size: 10px; word-break: break-all;">${factor.secret || 'Secret not available'}</code>
                </p>
            `;
            qrContainer.style.display = 'block';
        } else {
            authMessage.innerHTML = '<div class="error-message">QR code not generated. Please try again.</div>';
            return;
        }
        
        authMessage.innerHTML = '<div class="success-message">Scan QR code with your authenticator app, then enter the code</div>';
        document.getElementById('totpSetupForm').style.display = 'none';
        document.getElementById('mfaForm').style.display = 'block';
        
        // Show instruction
        const mfaFormText = document.querySelector('#mfaForm p');
        if (mfaFormText) {
            mfaFormText.textContent = 'Enter the 6-digit code from your authenticator app to complete setup';
        }
        
    } catch (error) {
        console.error('Setup error:', error);
        authMessage.innerHTML = `<div class="error-message">Error: ${error.message}. Please try refreshing the page.</div>`;
    } finally {
        setupBtn.disabled = false;
        setupBtn.textContent = 'Setup Authenticator';
    }
});

// Handle MFA verification
document.getElementById('mfaForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!supabaseClient) {
        alert('Please refresh the page - authentication not initialized');
        return;
    }
    
    const otp = document.getElementById('otpInput').value;
    const authMessage = document.getElementById('authMessage');
    const verifyBtn = document.getElementById('verifyBtn');
    
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';
    
    try {
        // If we have a challenge, use it, otherwise this is enrollment verification
        if (currentChallenge) {
            // Verifying existing MFA
            const { data, error } = await supabaseClient.auth.mfa.verify({
                factorId: currentFactorId,
                challengeId: currentChallenge.id,
                code: otp
            });
            
            if (error) throw error;
        } else {
            // Verifying enrollment
            const { data, error } = await supabaseClient.auth.mfa.verify({
                factorId: currentFactorId,
                code: otp
            });
            
            if (error) throw error;
        }
        
        authMessage.innerHTML = '<div class="success-message">Verification successful!</div>';
        
        // Hide QR code if visible
        const qrContainer = document.getElementById('qrCodeContainer');
        if (qrContainer) {
            qrContainer.style.display = 'none';
        }
        
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 500);
        
    } catch (error) {
        console.error('Verification error:', error);
        authMessage.innerHTML = `<div class="error-message">Invalid code. Please try again.</div>`;
        document.getElementById('otpInput').value = '';
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
    }
});
