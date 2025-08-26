// api/config.js
// Serves configuration to the frontend

export default function handler(req, res) {
  // Enable CORS if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Return configuration
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    wsUrl: process.env.DEEPGRAM_WS_URL ? 
      process.env.DEEPGRAM_WS_URL.replace(/\/$/, '') + '/monitor' : 
      'ws://localhost:3000/monitor'
  });
}
