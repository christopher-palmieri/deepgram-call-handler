// api/monitor.js
// Add this to your deepgram-call-handler repo

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Inject environment variables and serve the monitor HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IVR Call Monitor</title>
    
    <!-- Supabase Client -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    
    <style>
        /* Paste all the CSS from the monitor HTML artifact here */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        /* ... rest of the CSS from the artifact ... */
    </style>
</head>
<body>
    <!-- Login and Monitor containers from the artifact -->
    
    <script>
        // Inject environment variables
        const SUPABASE_URL = '${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}';
        const SUPABASE_ANON_KEY = '${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}';
        const WS_URL = '${process.env.NEXT_PUBLIC_WS_URL || 'wss://your-railway-app.railway.app/monitor'}';
        
        // Check if environment variables are set
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            document.body.innerHTML = '<div style="padding: 50px; text-align: center; color: white;"><h1>Configuration Error</h1><p>Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables in Vercel.</p></div>';
            throw new Error('Missing environment variables');
        }
        
        // Initialize Supabase client
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // ... rest of the JavaScript from the artifact ...
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
