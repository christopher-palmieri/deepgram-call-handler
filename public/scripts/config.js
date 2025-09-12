// public/scripts/config.js
// Shared configuration loader - establishes secure connection without exposing keys

let config = null;
let supabase = null;
let configPromise = null;

async function loadConfig() {
    // Return existing config if already loaded
    if (config && supabase) {
        return config;
    }
    
    // If already fetching, wait for that promise
    if (configPromise) {
        return configPromise;
    }
    
    // Start fetching configuration and establishing connection
    configPromise = (async () => {
        try {
            // Get existing tokens if available
            const accessToken = localStorage.getItem('sb-access-token');
            const refreshToken = localStorage.getItem('sb-refresh-token');
            
            // First, fetch config with auth token
            const configResponse = await fetch('/api/config', {
                headers: {
                    ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
                }
            });
            
            if (configResponse.ok) {
                config = await configResponse.json();
                console.log('Loaded authenticated config');
            } else if (configResponse.status === 401) {
                console.log('Not authenticated, using fallback config');
                config = {
                    wsUrl: 'ws://localhost:3001/monitor',
                    environment: 'development'
                };
            }
            
            // Also establish connection through secure endpoint
            const connectResponse = await fetch('/api/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    accessToken, 
                    refreshToken 
                })
            });
            
            if (connectResponse.ok) {
                const data = await connectResponse.json();
                // Merge configs, preferring connect response
                config = { ...config, ...data.config };
                
                // Store session if returned
                if (data.session) {
                    localStorage.setItem('sb-access-token', data.session.access_token);
                    localStorage.setItem('sb-refresh-token', data.session.refresh_token);
                }
                
                console.log('Established secure connection');
            }
        } catch (error) {
            console.error('Error loading config:', error);
            // Fallback configuration
            config = {
                wsUrl: 'ws://localhost:3000/monitor',
                environment: 'development'
            };
        }
        
        // Initialize Supabase proxy client only once
        if (!supabase && window.createSupabaseProxy) {
            supabase = await window.createSupabaseProxy();
            console.log('Supabase proxy client created');
            
            // Make it globally available
            window.supabaseClient = supabase;
        } else if (window.supabaseClient) {
            // Use existing client if available
            supabase = window.supabaseClient;
            console.log('Using existing Supabase proxy client');
        } else {
            console.error('Failed to create Supabase proxy client.');
        }
        
        return config;
    })();
    
    config = await configPromise;
    console.log('Using config:', config);
    
    return config;
}

// Helper function to check authentication
async function checkAuth() {
    if (!supabase) {
        await loadConfig();
    }
    
    if (!supabase) {
        console.error('Supabase client not available');
        return null;
    }
    
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

// Helper function to get URL parameters
function getUrlParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Auto-load configuration when script loads
if (typeof window !== 'undefined') {
    // Load configuration from API when DOM is ready
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', async () => {
            await loadConfig();
        });
    } else {
        // DOM already loaded
        loadConfig();
    }
}
