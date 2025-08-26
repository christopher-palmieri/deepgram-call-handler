// api/monitor.js
// Uses your existing environment variables

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use your EXISTING environment variables (no NEXT_PUBLIC_ prefix needed!)
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  
  // You'll need to add this one for your Railway WebSocket URL
  const WS_URL = process.env.WS_URL || 'wss://your-railway-app.railway.app/monitor';

  // Serve the monitor HTML with injected variables
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IVR Call Monitor</title>
    
    <!-- Supabase Client -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    
    <style>
        /* ... CSS from the monitor artifact ... */
    </style>
</head>
<body>
    <!-- ... HTML body from the monitor artifact ... -->
    
    <script>
        // Inject your existing environment variables
        const SUPABASE_URL = '${SUPABASE_URL}';
        const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
        const WS_URL = '${WS_URL}';
        
        // Check if environment variables are set
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            document.body.innerHTML = '<div style="padding: 50px; text-align: center; color: white;"><h1>Configuration Error</h1><p>Environment variables not configured.</p></div>';
            throw new Error('Missing environment variables');
        }
        
        // Initialize Supabase client
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // ... rest of JavaScript from the monitor artifact ...
    </script>
</body>
</html>`;

  res.status(200).setHeader('Content-Type', 'text/html').send(html);
}

export const config = {
  api: {
    bodyParser: false,
  },
};
