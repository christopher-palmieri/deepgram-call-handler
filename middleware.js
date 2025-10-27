// Vercel Edge Middleware
// Injects configuration from environment variables directly into HTML pages

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only inject config for HTML pages (not API routes, static assets, etc.)
  if (!pathname.endsWith('.html') && pathname !== '/' &&
      !pathname.match(/^\/(login|mfa|dashboard|monitor)$/)) {
    return;
  }

  // Get environment variables
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    wsUrl: process.env.MONITOR_WS_URL || getDefaultMonitorUrl(),
    environment: process.env.VERCEL_ENV || 'development',
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
  };

  // Create inline script to inject
  const configScript = `
    <script>
      // Configuration injected by Edge Middleware
      window.APP_CONFIG = ${JSON.stringify(config, null, 2)};
      console.log('Config injected by edge middleware:', window.APP_CONFIG);
    </script>
  `;

  // Fetch the HTML content
  return fetch(request).then(response => {
    return response.text().then(html => {
      // Inject config script before closing </head> tag
      const modifiedHtml = html.replace('</head>', `${configScript}</head>`);

      return new Response(modifiedHtml, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers),
          'Content-Type': 'text/html',
        },
      });
    });
  });
}

function getDefaultMonitorUrl() {
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV;
  if (env === 'production') {
    return process.env.RAILWAY_MONITOR_URL || 'wss://your-monitor-server.railway.app/monitor';
  }
  return 'ws://localhost:3001/monitor';
}

// Configure which paths this middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)).*)',
  ],
};
