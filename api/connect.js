import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Create a server-side Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Get any existing session from the request
    const { accessToken, refreshToken } = req.body || {};
    
    if (accessToken) {
      // Set the session if tokens provided
      const { data: { session }, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      
      if (error) throw error;
      
      return res.status(200).json({ 
        success: true,
        session,
        config: {
          wsUrl: process.env.MONITOR_WS_URL || getDefaultMonitorUrl(),
          environment: process.env.NODE_ENV || 'development'
        }
      });
    } else {
      // Return config for anonymous connection
      return res.status(200).json({ 
        success: true,
        session: null,
        config: {
          wsUrl: process.env.MONITOR_WS_URL || getDefaultMonitorUrl(),
          environment: process.env.NODE_ENV || 'development'
        }
      });
    }
  } catch (error) {
    console.error('Connection error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function getDefaultMonitorUrl() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.RAILWAY_MONITOR_URL || 'wss://your-monitor-server.railway.app/monitor';
  }
  return 'ws://localhost:3001/monitor';
}