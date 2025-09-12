export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Require authentication to access config
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Only return config to authenticated users
  const config = {
    wsUrl: process.env.MONITOR_WS_URL || getDefaultMonitorUrl(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
  };
  
  res.status(200).json(config);
}

function getDefaultMonitorUrl() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.RAILWAY_MONITOR_URL || 'wss://your-monitor-server.railway.app/monitor';
  }
  return 'ws://localhost:3001/monitor';
}