import { NextResponse } from 'next/server';

export const config = {
  matcher: [
    '/dashboard.html',
    '/login.html', 
    '/monitor.html',
    '/reset-password.html',
    '/((?!api|_next/static|_next/image|favicon.ico|scripts|styles).*).html'
  ]
};

export default async function middleware(request) {
  // Only process HTML requests
  if (!request.url.includes('.html')) {
    return NextResponse.next();
  }

  // Fetch the original HTML
  const response = await fetch(request.url);
  let html = await response.text();

  // Prepare configuration object
  const appConfig = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    wsUrl: process.env.MONITOR_WS_URL || getDefaultMonitorUrl(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
  };

  // Inject configuration script before the closing </head> tag
  const configScript = `
    <script>
      window.APP_CONFIG = ${JSON.stringify(appConfig)};
      console.log('App configuration loaded:', window.APP_CONFIG);
    </script>
  `;

  // Insert the config script before </head>
  html = html.replace('</head>', `${configScript}</head>`);

  // Return modified HTML with proper headers
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...response.headers,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate'
    }
  });
}

function getDefaultMonitorUrl() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.RAILWAY_MONITOR_URL || 'wss://your-monitor-server.railway.app/monitor';
  }
  return 'ws://localhost:3001/monitor';
}