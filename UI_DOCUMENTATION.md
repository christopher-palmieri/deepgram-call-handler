# UI Documentation - Deepgram Call Handler

## Overview
The Deepgram Call Handler system provides a comprehensive web-based interface for managing and monitoring AI-powered phone calls. This document describes the complete UI architecture, features, and implementation details.

## System Architecture

### Core Components
- **Authentication System**: Multi-factor authentication (MFA) with session management
- **Real-Time Dashboard**: Live monitoring of pending calls with advanced filtering
- **Call Monitor**: Real-time call transcription and event tracking
- **WebSocket Integration**: Dual WebSocket connections for database updates and call audio

### Technology Stack
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend Services**: Supabase (Auth, Database, Realtime)
- **Real-Time**: WebSocket connections for live updates
- **Security**: Row Level Security (RLS), JWT authentication

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
- **Security**: Requires AAL2 authentication
- **Scripts**: `/scripts/dashboard.js`
- **Styles**: `/styles/monitor.css`

#### Dashboard Features

##### 🔄 Real-Time Updates
- **WebSocket Integration**: Automatic updates when call data changes
- **Live Status Monitoring**: Real-time workflow state changes
- **Background Synchronization**: Maintains data consistency without manual refresh
- **Test Real-Time Connection**: Diagnostic button for connection testing

##### 🎛️ Advanced Filtering System

**Multi-Select Dropdown Filters**
- **Status Filter**: Filter by workflow states
  - Pending
  - New
  - Ready to Call
  - Calling
  - Classifying
  - Completed
  - Failed
  - Retry Pending
- **Date Range Filter**: Filter by appointment dates
  - Today
  - Tomorrow
  - Yesterday
  - Last 7 Days
  - Last 30 Days
  - Older than 30 Days
- **Task Type Filter**: Filter by task categories
  - Records Request
  - Schedule
  - Kit Confirmation

**Filter Features**
- **Multi-selection**: Choose multiple options within each filter category
- **Smart Display**: Shows "All" when no specific filters selected, or count when multiple selected
- **Custom Checkboxes**: Soft gray unchecked state, washed-out blue checked state
- **Persistent Storage**: Automatically saves and restores filter selections

**Named Filter Presets**
- **Save Current Filters**: Create named shortcuts for commonly used filter combinations
- **Quick Access Buttons**: One-click application of saved presets
- **Preset Management**: Delete unwanted presets with confirmation
- **Visual Feedback**: Active state highlighting and toast notifications
- **Examples**: "Today's Failed Calls", "Weekly Review", "Quick Status Check"

##### 🔍 Search Functionality
- **Real-Time Search**: Instant filtering as you type
- **Comprehensive Coverage**: Searches across all visible columns
  - Employee
  - Client
  - Clinic
  - Phone
  - Task
  - Status
  - Dates
- **Clear Button**: Quick search reset with visual feedback
- **Keyboard Support**: Enter key and focus management
- **Case-Insensitive**: Smart matching regardless of case

##### 📊 Table Features

**Sortable Columns**
- **Click Headers**: Sort by any column
- **Visual Indicators**: Arrow icons show current sort direction
- **Multi-Level Sorting**: Maintains secondary sorting for tied values

**Resizable Columns**
- **Drag Handles**: Adjust column widths to preference
- **Frozen First Column**: Employee name remains visible during horizontal scroll
- **Persistent Sizing**: Maintains column widths across sessions

**Responsive Design**
- **Compact Layout**: Optimized for information density
- **Horizontal Scroll**: Wide tables remain accessible on smaller screens
- **Mobile Friendly**: Touch-optimized interactions

### 4. Call Monitor (`/monitor.html`)
- **Purpose**: Live monitoring of active calls
- **Features**:
  - WebSocket connection to call server
  - Real-time transcription display
  - Call events timeline
  - Agent activity monitoring
  - Audio visualization
  - IVR event tracking
  - Session details panel with real-time updates
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

## Visual Design

### 🎨 Color Scheme
- **Primary Green**: #008d6f (buttons, accents)
- **Dark Header**: #2d3748 (top navigation)
- **Clean Background**: White with subtle gradients
- **Status Colors**: Color-coded workflow states
  - `.workflow-pending`: #fbbf24 (yellow)
  - `.workflow-active`: #34d399 (green)
  - `.workflow-completed`: #60a5fa (blue)
  - `.workflow-failed`: #f87171 (red)

### Typography
- **System Fonts**: -apple-system, BlinkMacSystemFont, 'Segoe UI'
- **Hierarchy**: Clear font weights and sizes for information hierarchy
- **Readability**: Optimized contrast ratios

### Interactive Elements
- **Hover Effects**: Subtle feedback on all interactive elements
- **Smooth Transitions**: 0.2s ease animations
- **Loading States**: Clear feedback during data operations
- **Real-Time Update Animation**: 
  - Blue highlight (#f0f9ff) on row update
  - 1-second fade animation
  - Maintains user scroll position

### Connection Status Indicator
- Green: Real-time active
- Yellow: Polling fallback
- Red: Disconnected

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

## User Workflows

### Daily Monitoring Workflow
1. **Login**: Secure authentication with MFA
2. **Apply Filters**: Use presets or custom filters for relevant data
3. **Real-Time Monitoring**: Watch for status changes and new calls
4. **Search & Investigate**: Use search to find specific calls
5. **Take Action**: Click through to monitor or manage specific calls

### Filter Management Workflow
1. **Set Filters**: Configure desired filter combination
2. **Save Preset**: Click "Save Filter" and name the combination
3. **Quick Access**: Use preset buttons for instant filter application
4. **Manage Presets**: Delete outdated presets as needed

### Search Workflow
1. **Type Query**: Enter search terms in real-time search box
2. **Review Results**: See filtered results instantly
3. **Clear Search**: Use clear button or empty field to reset
4. **Combine Filters**: Use search with existing filters for precise results

## Performance Considerations

### Optimization Features
- **Virtual Scrolling**: Efficient handling of large datasets
- **Debounced Search**: Optimized search performance
- **Lazy Loading**: Progressive data loading
- **Memory Management**: Efficient DOM manipulation

### Real-Time Performance
- **WebSocket Efficiency**: Minimal bandwidth usage
- **Selective Updates**: Only refreshes changed data
- **Background Processing**: Non-blocking UI operations
- **WebSocket Reconnection**: Automatic reconnection with backoff

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

### Vercel Deployment
- Deploy entire repository to Vercel
- Edge Middleware automatically handles configuration injection
- Set environment variables in Vercel dashboard
- No need for separate config file management

### Static File Hosting
- Serve the `/public` directory
- Do not expose `/test-pages` directory
- Edge middleware injects configuration at request time

### Configuration Management
1. Set environment variables in Vercel dashboard
2. Edge middleware automatically injects them into HTML
3. No config files to manage or deploy separately
4. Configuration updates take effect immediately

### Browser Support
- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support
- **Mobile Browsers**: Basic functionality
- **Requirements**:
  - Modern browsers with WebSocket support
  - JavaScript enabled
  - LocalStorage for session persistence

## Accessibility Features
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: ARIA labels and semantic HTML
- **High Contrast**: Support for high contrast modes
- **Focus Management**: Clear focus indicators

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

## Future Enhancements

### Planned Features
- [ ] Export Functionality: Download filtered data
- [ ] Advanced Analytics: Call statistics and trends  
- [ ] Notification System: Alerts for critical events
- [ ] Bulk Actions: Multi-select operations
- [ ] Column Customization: User-defined column visibility
- [ ] Call Recording Playback: Audio playback interface
- [ ] User Preference Persistence: Save user settings

### Performance Optimizations
- [ ] Virtual scrolling for large datasets
- [ ] Debounced real-time updates
- [ ] Progressive data loading
- [ ] WebSocket reconnection backoff

---

*Last Updated: January 2025*  
*Dashboard Version: v7*  
*Based on commit: 4737346*