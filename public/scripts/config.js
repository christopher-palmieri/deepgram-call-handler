// public/scripts/config.js
// Shared configuration loader - uses config injected by Edge Middleware

let config = null;
let supabase = null;

async function loadConfig() {
    // Return existing config if already loaded
    if (config && supabase) {
        return config;
    }

    // Load config from window.APP_CONFIG (injected by edge middleware)
    if (window.APP_CONFIG) {
        config = window.APP_CONFIG;
        console.log('✅ Using config from edge middleware:', config);
    } else {
        // Fallback for local development or if middleware isn't running
        console.warn('⚠️ window.APP_CONFIG not found, using fallback config');
        config = {
            supabaseUrl: '',
            supabaseAnonKey: '',
            wsUrl: 'ws://localhost:3001/monitor',
            environment: 'development'
        };
    }
    
    // Initialize Supabase client only once
    if (!supabase && window.supabase && config.supabaseUrl && config.supabaseAnonKey) {
        supabase = window.supabase.createClient(
            config.supabaseUrl, 
            config.supabaseAnonKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: false
                },
                realtime: {
                    params: {
                        eventsPerSecond: 10
                    }
                }
            }
        );
        console.log('Supabase client created with realtime support');
        
        // Make it globally available
        window.supabaseClient = supabase;
    } else if (window.supabaseClient) {
        // Use existing client if available
        supabase = window.supabaseClient;
        console.log('Using existing Supabase client');
    } else {
        console.error('Failed to create Supabase client. Missing config or Supabase library.');
        console.log('window.supabase:', window.supabase);
        console.log('supabaseUrl:', config.supabaseUrl);
        console.log('supabaseAnonKey:', config.supabaseAnonKey);
    }
    
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