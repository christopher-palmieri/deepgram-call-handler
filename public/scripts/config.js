// public/scripts/config.js
// Shared configuration loader - loaded by all pages

let config = null;
let supabase = null;

async function loadConfig() {
    // Return existing instances to avoid duplicates
    if (config && supabase) {
        return config;
    }
    
    if (config) return config;
    
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error('Failed to load configuration');
        }
        
        config = await response.json();
        
        // Only create Supabase client if it doesn't exist
        if (!supabase && window.supabase && config.supabaseUrl && config.supabaseAnonKey) {
            supabase = window.supabase.createClient(
                config.supabaseUrl, 
                config.supabaseAnonKey,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true
                    }
                }
            );
            // Make it globally available to prevent duplicates
            window.supabaseClient = supabase;
        } else if (window.supabaseClient) {
            // Use existing client if available
            supabase = window.supabaseClient;
        }
        } else {
            console.error('Failed to initialize Supabase - missing configuration');
        }
        
        return config;
    } catch (error) {
        console.error('Failed to load configuration:', error);
        // Return default config to prevent complete failure
        config = {
            supabaseUrl: '',
            supabaseAnonKey: '',
            wsUrl: 'ws://localhost:3000/monitor'
        };
        return config;
    }
}

// Helper function to check authentication
async function checkAuth() {
    if (!supabase) {
        await loadConfig();
    }
    
    if (!supabase) {
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
    window.addEventListener('DOMContentLoaded', () => {
        loadConfig();
    });
}
