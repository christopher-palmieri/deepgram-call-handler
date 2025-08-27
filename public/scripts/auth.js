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
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session?.user) {
        // Check MFA level - aal1 means logged in but no MFA, aal2 means MFA completed
        if (!session.aal || session.aal === 'aal1') {
            console.log('User logged in but MFA not completed');
            
            // Check if they have MFA set up
            const { data: factors } = await supabaseClient.auth.mfa.listFactors();
            
            if (factors?.totp?.length > 0) {
                // Has MFA enrolled, needs to verify
                console.log('MFA enrolled, showing verification form');
                const totpFactor = factors.totp[0];
                currentFactorId = totpFactor.id;
                
                // Create challenge
                const { data: challenge } = await supabaseClient.auth.mfa.challenge({
                    factorId: totpFactor.id
                });
                currentChallenge = challenge;
                
                // Show MFA verification form
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('totpSetupForm').style.display = 'none';
                document.getElementById('mfaForm').style.display = 'block';
                document.getElementById('authMessage').innerHTML = 
                    '<div class="success-message">Enter code from your authenticator app</div>';
            } else {
                // No MFA set up yet, show setup
                console.log('No MFA enrolled, showing setup form');
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('totpSetupForm').style.display = 'block';
                document.getElementById('authMessage').innerHTML = 
                    '<div class="success-message">Please set up two-factor authentication</div>';
            }
        } else if (session.aal === 'aal2') {
            // MFA completed, can go to dashboard
            console.log('MFA already completed, redirecting to dashboard');
            window.location.href = '/dashboard.html';
        }
    } else {
        // Not logged in at all, show login form
        console.log('Not logged in, showing login form');
        document.getElementById('loginForm').style.display = 'block';
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
        
        // After enrollment, create a challenge for verification
        const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({
            factorId: factor.id
        });
        
        if (challenge) {
            currentChallenge = challenge;
            console.log('Challenge created for enrollment verification:', challenge);
        } else {
            currentChallenge = null;
            console.log('No challenge created (will try verification without it)');
        }
        
        currentFactorId = factor.id;
        console.log('New factor enrolled:', factor);
        
        // Show QR code for authenticator app
        const qrContainer = document.getElementById('qrCodeContainer');
        // QR code might be at factor.qr_code or factor.totp.qr_code
        const qrCode = factor.qr_code || factor.totp?.qr_code;
        const secret = factor.secret || factor.totp?.secret;
        
        if (qrContainer && qrCode) {
            qrContainer.innerHTML = `
                <img src="${qrCode}" alt="MFA QR Code" style="margin: 20px auto; display: block; max-width: 256px;">
                <p style="margin: 15px 0; font-size: 12px; color: #666;">
                    Can't scan? Enter this code manually: <br>
                    <code style="font-size: 10px; word-break: break-all;">${secret || 'Secret not available'}</code>
                </p>
            `;
            qrContainer.style.display = 'block';
        } else {
            console.error('QR code not found in factor:', factor);
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
        console.log('Verifying with:', {
            factorId: currentFactorId,
            challengeId: currentChallenge?.id,
            codeLength: otp.length
        });
        
        let verifyResult;
        
        // For enrollment verification, just pass the code
        console.log('Attempting verification with factorId:', currentFactorId);
        
        try {
            // Try the simplest verification first
            const response = await fetch(`${supabaseClient.auth.url}/factors/${currentFactorId}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token}`,
                    'apikey': supabaseClient.supabaseKey
                },
                body: JSON.stringify({ code: otp })
            });
            
            const result = await response.json();
            console.log('Direct API response:', result);
            
            if (!response.ok) {
                throw new Error(result.msg || result.message || 'Verification failed');
            }
            
            verifyResult = { data: result, error: null };
        } catch (apiError) {
            console.log('Direct API failed, trying SDK method');
            
            // Fall back to SDK method
            verifyResult = await supabaseClient.auth.mfa.verify({
                factorId: currentFactorId,
                code: otp
            });
        }
        
        console.log('Verify result:', verifyResult);
        
        if (verifyResult.error) {
            throw verifyResult.error;
        }
        
        authMessage.innerHTML = '<div class="success-message">Verification successful!</div>';
        
        // Hide QR code if visible
        const qrContainer = document.getElementById('qrCodeContainer');
        if (qrContainer) {
            qrContainer.style.display = 'none';
        }
        
        // Check session to confirm aal2
        const { data: { session } } = await supabaseClient.auth.getSession();
        console.log('Session after verification:', session?.aal);
        
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 500);
        
    } catch (error) {
        console.error('Verification error details:', error);
        authMessage.innerHTML = `<div class="error-message">Invalid code: ${error.message || 'Please try again'}</div>`;
        document.getElementById('otpInput').value = '';
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
    }
});
