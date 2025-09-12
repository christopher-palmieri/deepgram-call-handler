// public/scripts/config.js
// Shared configuration loader - fetches from API endpoint

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
    
    // Start fetching configuration
    configPromise = (async () => {
        try {
            // Try to fetch from API endpoint
            const response = await fetch('/api/config');
            if (response.ok) {
                config = await response.json();
                console.log('Loaded config from API:', config);
            } else {
                throw new Error('Failed to fetch config');
            }
        } catch (error) {
            console.error('Error loading config:', error);
            // Fallback configuration
            config = {
                supabaseUrl: '',
                supabaseAnonKey: '',
                wsUrl: 'ws://localhost:3000/monitor'
            };
        }
        
        return config;
    })();
    
    config = await configPromise;
    console.log('Using config:', config);
    
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