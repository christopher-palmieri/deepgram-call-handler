// public/scripts/reset-password.js
// Handles password reset functionality

let supabaseClient = null;

// Wait for config to load
window.addEventListener('DOMContentLoaded', async () => {
    loadConfig(); // From config.js
    
    // Get the supabase client from global scope
    supabaseClient = window.supabaseClient || window.supabase || supabase;
    
    if (!supabaseClient) {
        document.getElementById('authMessage').innerHTML = 
            '<div class="error-message">Failed to initialize. Please refresh.</div>';
        return;
    }
    
    // Check if we have a valid recovery token in the URL
    checkRecoveryToken();
});

// Check if the URL contains a valid recovery token
async function checkRecoveryToken() {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');
    
    console.log('URL params:', { type, hasToken: !!accessToken });
    
    // Check if this is a recovery type (password reset)
    if (type !== 'recovery' || !accessToken) {
        // No valid recovery token, show invalid link message
        console.log('No valid recovery token found');
        showInvalidLink();
        return;
    }
    
    try {
        // Set the session with the recovery token
        const { data, error } = await supabaseClient.auth.setSession({
            access_token: accessToken,
            refresh_token: hashParams.get('refresh_token') || ''
        });
        
        if (error) {
            console.error('Error setting session:', error);
            showInvalidLink();
            return;
        }
        
        console.log('Recovery session set successfully');
        // Show the password reset form
        document.getElementById('resetPasswordForm').style.display = 'block';
        
    } catch (error) {
        console.error('Error processing recovery token:', error);
        showInvalidLink();
    }
}

// Show invalid link message
function showInvalidLink() {
    document.getElementById('resetPasswordForm').style.display = 'none';
    document.getElementById('invalidLinkMessage').style.display = 'block';
}

// Show success message
function showSuccess() {
    document.getElementById('resetPasswordForm').style.display = 'none';
    document.getElementById('successMessage').style.display = 'block';
}

// Handle password reset form submission
document.getElementById('resetPasswordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const updateBtn = document.getElementById('updatePasswordBtn');
    const authMessage = document.getElementById('authMessage');
    const newPassword = document.getElementById('newPasswordInput').value;
    const confirmPassword = document.getElementById('confirmPasswordInput').value;
    
    // Clear previous messages
    authMessage.innerHTML = '';
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
        authMessage.innerHTML = '<div class="error-message">Passwords do not match</div>';
        return;
    }
    
    // Validate password length
    if (newPassword.length < 6) {
        authMessage.innerHTML = '<div class="error-message">Password must be at least 6 characters</div>';
        return;
    }
    
    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';
    
    try {
        // Update the user's password
        const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });
        
        if (error) {
            throw error;
        }
        
        console.log('Password updated successfully');
        
        // Sign out after password reset to ensure clean login
        await supabaseClient.auth.signOut();
        
        // Show success message
        showSuccess();
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 3000);
        
    } catch (error) {
        console.error('Password update error:', error);
        authMessage.innerHTML = `<div class="error-message">Error: ${error.message || 'Failed to update password'}</div>`;
        updateBtn.disabled = false;
        updateBtn.textContent = 'Update Password';
    }
});