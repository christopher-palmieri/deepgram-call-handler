// api/config.js - Complete configuration endpoint for the frontend

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Configuration object with all required frontend settings
    const config = {
      // Supabase configuration for authentication and database access
      // Use existing env vars (without NEXT_PUBLIC_ prefix since this is server-side)
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      
      // WebSocket URL for monitor connections
      // This should point to your separate monitor server
      wsUrl: process.env.MONITOR_WS_URL || getDefaultMonitorUrl(),
      
      // Optional: Add other configuration as needed
      environment: process.env.NODE_ENV || 'development',
      version: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
    };

    // Validate required configuration
    const requiredFields = ['supabaseUrl', 'supabaseAnonKey'];
    const missingFields = requiredFields.filter(field => !config[field]);
    
    if (missingFields.length > 0) {
      console.error('Missing required config fields:', missingFields);
      return res.status(500).json({ 
        error: 'Server configuration incomplete',
        missingFields 
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // Cache for 5 minutes
    
    // Return configuration
    res.status(200).json(config);
    
  } catch (error) {
    console.error('Config endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to load configuration',
      message: error.message 
    });
  }
}

// Helper function to determine default monitor URL based on environment
function getDefaultMonitorUrl() {
  // In production, use your Railway monitor server URL
  if (process.env.NODE_ENV === 'production') {
    // Replace with your actual Railway monitor server URL
    return process.env.RAILWAY_MONITOR_URL || 'wss://your-monitor-server.railway.app/monitor';
  }
  
  // In development, use localhost
  return 'ws://localhost:3001/monitor';
}

// Alternative: Environment-specific configuration
function getEnvironmentConfig() {
  const baseConfig = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  };

  switch (process.env.NODE_ENV) {
    case 'production':
      return {
        ...baseConfig,
        wsUrl: process.env.MONITOR_WS_URL_PROD || 'wss://your-monitor-server.railway.app/monitor',
        environment: 'production'
      };
      
    case 'staging':
      return {
        ...baseConfig,
        wsUrl: process.env.MONITOR_WS_URL_STAGING || 'wss://your-monitor-server-staging.railway.app/monitor',
        environment: 'staging'
      };
      
    default: // development
      return {
        ...baseConfig,
        wsUrl: process.env.MONITOR_WS_URL_DEV || 'ws://localhost:3001/monitor',
        environment: 'development'
      };
  }
}
