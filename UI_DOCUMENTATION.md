# UI Documentation - Deepgram Call Handler

## Overview
This document describes the web UI for the Deepgram Call Handler system, including page structure, configuration, authentication flow, and real-time update architecture.

## Public Pages

### 1. Login Page (`/login.html`)
- **Purpose**: Initial authentication entry point
- **Features**:
  - Email/password authentication
  - Redirects to MFA page after successful login
  - Links to password reset
- **Security**: First factor authentication (AAL1)

### 2. MFA Page (`/mfa.html`)
- **Purpose**: Second factor authentication
- **Features**:
  - TOTP verification
  - MFA setup for new users
  - QR code generation for authenticator apps
- **Security**: Elevates session to AAL2 (required for dashboard access)
- **Flow**: Login → MFA → Dashboard

### 3. Dashboard (`/dashboard.html`)
- **Purpose**: Main control center for viewing and managing pending calls
- **Features**:
  - Real-time updates for call status changes
  - Filter calls by status (All, Active, Pending, Completed)
  - View call details
  - Monitor active calls
  - Test real-time connection button
- **Scripts**: `/scripts/dashboard.js`
- **Styles**: `/styles/monitor.css`
- **Security**: Requires AAL2 authentication

### 4. Call Monitor (`/monitor.html`)
- **Purpose**: Live monitoring of active calls
- **Features**:
  - WebSocket connection to call server
  - Real-time transcription display
  - Call events timeline
  - Agent activity monitoring
  - Audio visualization
- **Scripts**: `/scripts/call-monitor.js`
- **Connection**: Uses WebSocket for live updates

## Internal Test Pages (Not Publicly Accessible)

These pages are stored in `/test-pages/` directory and are not served publicly:

### test-realtime.html
- **Location**: `/test-pages/test-realtime.html`
- **Purpose**: Diagnostic tool for testing Supabase real-time subscriptions
- **Features**:
  - Test basic database connection
  - Test simple channel subscription
  - Test table change subscriptions
  - Direct WebSocket inspection
- **Usage**: Developer debugging only

### monitor-test.html
- **Location**: `/test-pages/monitor-test.html`
- **Purpose**: Testing monitor functionality
- **Usage**: Developer testing only

## Configuration

### Config.js (`/scripts/config.js`)
```javascript
// Loads configuration from config.json
async function loadConfig() {
    const response = await fetch('/config.json');
    const config = await response.json();
    
    // Initialize Supabase client with realtime
    if (!window.supabaseClient) {
        supabase = window.supabase.createClient(
            config.supabaseUrl,
            config.supabaseAnonKey,
            {
                realtime: {
                    params: {
                        eventsPerSecond: 10
                    }
                }
            }
        );
        window.supabaseClient = supabase;
    }
    return config;
}
```

### Configuration Files
- **Development**: `/config.dev.json`
- **Production**: `/config.json` (git-ignored, deployed separately)

### Environment Variables Required
```json
{
    "supabaseUrl": "https://your-project.supabase.co",
    "supabaseAnonKey": "your-anon-key",
    "wsUrl": "wss://your-monitor-server.com/monitor",
    "environment": "production",
    "version": "git-commit-hash"
}
```

## Authentication Flow

### Multi-Factor Authentication (MFA) Flow
```
1. User enters email/password on login.html
   ↓
2. Supabase validates credentials (AAL1)
   ↓
3. Redirect to mfa.html
   ↓
4. User enters TOTP code
   ↓
5. Session elevated to AAL2
   ↓
6. Access granted to dashboard.html
```

### Session Management
- **AAL1**: Basic authentication (email/password)
- **AAL2**: Multi-factor authentication (required for dashboard)
- **Session Check**: Each protected page verifies AAL level
- **Auto-logout**: On session expiration or AAL downgrade

## Real-Time Architecture

### How Real-Time Updates Work

#### 1. Subscription Setup (Dashboard)
```javascript
function setupRealtimeSubscription() {
    // Clean up existing channels
    const allChannels = supabase.getChannels();
    allChannels.forEach(channel => {
        supabase.removeChannel(channel);
    });
    
    // Force reconnect for fresh state
    if (supabase.realtime) {
        supabase.realtime.disconnect();
        setTimeout(() => {
            supabase.realtime.connect();
            createDashboardSubscription();
        }, 500);
    }
}
```

#### 2. Channel Creation
```javascript
function createDashboardSubscription() {
    realtimeChannel = supabase
        .channel('pending-calls-dashboard')
        .on('postgres_changes', {
            event: '*',           // Listen to INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'pending_calls'
        }, handleRealtimeUpdate)
        .subscribe();
}
```

#### 3. Event Handling
```javascript
function handleRealtimeUpdate(payload) {
    switch(payload.eventType) {
        case 'INSERT':
            // Add new call to UI
            break;
        case 'UPDATE':
            // Update existing call row with animation
            updateSingleCallRow(payload.new);
            break;
        case 'DELETE':
            // Remove call from UI
            break;
    }
}
```

### Real-Time Data Flow
```
Database Change (INSERT/UPDATE/DELETE)
    ↓
Postgres Replication
    ↓
Supabase Realtime Server
    ↓
WebSocket to Browser
    ↓
Channel Subscription Handler
    ↓
UI Update with Animation
```

### Troubleshooting Real-Time

#### Common Issues and Solutions

1. **No updates received**
   - Check AAL level (must be AAL2)
   - Verify RLS policies allow SELECT
   - Check browser console for WebSocket errors
   - Use Test Realtime button to diagnose

2. **Stale connections**
   - Dashboard forces disconnect/reconnect on setup
   - Removes all existing channels before creating new ones

3. **Multiple subscriptions conflict**
   - Each page uses unique channel names
   - Dashboard: `pending-calls-dashboard`
   - Test: `pending-calls-test`
   - Monitor: Uses separate WebSocket for call audio

4. **Debugging Tools**
   - Test Realtime button in dashboard
   - Console logs show subscription status
   - Active channels logged after setup

### WebSocket Connections

#### Supabase Real-Time (Database Changes)
- **Protocol**: WSS
- **Endpoint**: `wss://[project].supabase.co/realtime/v1`
- **Authentication**: JWT token in connection params
- **Channels**: Topic-based subscriptions

#### Call Monitor WebSocket (Audio/Transcription)
- **Protocol**: WSS
- **Endpoint**: Configured in `wsUrl` (e.g., `wss://standalone-monitor.railway.app/monitor`)
- **Purpose**: Live call audio and transcription
- **Authentication**: Supabase session token
- **Data**: Binary audio + JSON events

## Security Considerations

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can only see their organization's data
- Real-time subscriptions respect RLS policies

### Authentication Requirements
- **Public pages**: login.html, mfa.html
- **AAL1 pages**: None currently
- **AAL2 pages**: dashboard.html, monitor.html
- **API calls**: Include session token in headers

### CORS Configuration
- Supabase handles CORS for database/auth
- Monitor WebSocket server must allow origin

## UI Components

### Status Badges
```css
.workflow-pending { background: #fbbf24; }
.workflow-active { background: #34d399; }
.workflow-completed { background: #60a5fa; }
.workflow-failed { background: #f87171; }
```

### Real-Time Update Animation
- Blue highlight (#f0f9ff) on row update
- 1-second fade animation
- Maintains user scroll position

### Connection Status Indicator
- Green: Real-time active
- Yellow: Polling fallback
- Red: Disconnected

## File Structure
```
/public/                    # Publicly accessible files
├── login.html             # Login page
├── mfa.html              # MFA verification
├── dashboard.html        # Main dashboard
├── monitor.html          # Call monitor
├── /scripts/             # JavaScript files
│   ├── config.js         # Configuration loader
│   ├── dashboard.js      # Dashboard logic
│   └── call-monitor.js   # Monitor logic
├── /styles/              # CSS files
│   └── monitor.css       # Main stylesheet
└── config.json          # Production config (git-ignored)

/test-pages/              # Internal test pages (not served)
├── test-realtime.html    # Realtime testing
└── monitor-test.html     # Monitor testing
```

## Deployment

### Static File Hosting
- Serve only the `/public` directory
- Do not expose `/test-pages` directory
- Can be hosted on any static file server

### Configuration Management
1. Copy `config.dev.json` to `config.json`
2. Update with production values
3. Never commit `config.json` to git
4. Deploy separately from code

### Browser Requirements
- Modern browsers with WebSocket support
- JavaScript enabled
- LocalStorage for session persistence

## Development

### Local Setup
```bash
# Start local server
npm run serve

# Use config.dev.json for local development
```

### Testing Real-Time
1. Open dashboard in browser
2. Open Supabase dashboard in another tab
3. Modify a record in pending_calls
4. Observe update in UI with blue highlight

### Debugging
- Browser DevTools Console for JavaScript errors
- Network tab for WebSocket frames
- Application tab for LocalStorage inspection
- Test pages in `/test-pages/` for isolated testing

## Future Improvements

### Planned Features
- [ ] Bulk call actions
- [ ] Advanced filtering and search
- [ ] Call recording playback
- [ ] Analytics dashboard
- [ ] User preference persistence

### Performance Optimizations
- [ ] Virtual scrolling for large datasets
- [ ] Debounced real-time updates
- [ ] Progressive data loading
- [ ] WebSocket reconnection backoff

---

Last Updated: 2025-01-09
Version: Based on commit 94eb20e