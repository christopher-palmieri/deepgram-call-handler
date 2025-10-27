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

##### 📝 Call Management
- **New Call Form**: Create individual pending calls with comprehensive form
- **Edit Modal**: Two-tab interface for editing call data and classifications
- **Delete Calls**: Permanently remove calls with confirmation modal
- **Archive/Unarchive**: Soft delete with reversible archive functionality
- **Import Wizard**: Bulk upload calls from Excel/CSV files with 6-step workflow

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

**Action Buttons (Per Row)**
- **Make Call** (Green): Start call monitoring session
- **Edit Call** (Green): Open edit modal with tabbed interface
- **Archive** (Orange): Soft-delete call (reversible)
- **Delete** (Red): Permanently remove call with confirmation
- **Compact Design**: 26px × 26px uniform sizing prevents wrapping
- **Hover Effects**: Visual feedback on all buttons
- **Icon Clarity**: 12px icons for optimal visibility

**Responsive Design**
- **Compact Layout**: Optimized for information density
- **Horizontal Scroll**: Wide tables remain accessible on smaller screens
- **Mobile Friendly**: Touch-optimized interactions
- **Action Button Sizing**: Prevents button overflow on smaller screens

### 4. Call Monitor (`/monitor.html`)
- **Purpose**: Live monitoring of active calls
- **Scripts**: `/scripts/call-monitor.js`
- **Connection**: Uses WebSocket for live updates

#### Call Monitor Features

##### 📊 Sessions Table
- **Real-Time Updates**: Live tracking of call sessions with status changes
- **Status Animation**: Subtle flash animation for "Calling" status rows
  - Blue background pulse with box shadow effects
  - Animated status indicator dot for active calls
  - Continuous pulsing effect during active calls
- **Session Data**: Date/time, IVR state, confidence scores, call status
- **Interactive Rows**: Click to view detailed session information

##### 🎛️ Flyout Panel (Session Details)
- **Modern Design**: Fixed-position panel slides from right edge
- **Full-Height Layout**: Extends from top bar to bottom of viewport
- **Improved Header**: 
  - Close button (×) positioned top-left
  - Session date/time displayed in header area
  - Clean, organized information hierarchy

**Session Summary Section**
- **Line 1**: Call ID (prominent) + Status badge
- **Line 2**: Session ID (compact, gray background) + IVR detection state

##### 📁 Foldable Sections
- **Collapsible Content**: Both Workflow Metadata and IVR Events can be folded/unfolded
- **Interactive Headers**: Click to toggle section visibility
- **Fold Icons**: ▼ (expanded) / ▶ (collapsed) with smooth transitions
- **Visual Feedback**: Hover effects and smooth animations

**Workflow Metadata Section**
- **Structured Display**: Key-value pairs in organized grid layout
- **Nested Objects**: Handles complex metadata with proper formatting
- **Foldable**: Can be collapsed to save space

**IVR Events Section**
- **Compact Layout**: Condensed event display for better space utilization
- **Event Items**: Timestamp, status icon (✓/⏳), action type, and values
- **Transcript Display**: Quoted transcript text with distinct styling
- **AI Replies**: Arrow-prefixed responses with green background
- **Real-Time Updates**: Live indicator (🔴 LIVE) with animation
- **Foldable**: Can be collapsed when not needed

##### 🎨 Enhanced Styling
- **Compact Design**: Optimized for information density
- **Status Indicators**: Color-coded status badges and confidence scores
- **Smooth Animations**: All interactions include subtle transitions
- **Professional Look**: Clean typography and consistent spacing

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

## Edge Functions

### Supabase Edge Functions (Deno Runtime)

The application uses several edge functions for server-side operations that require elevated permissions or external API calls:

#### `save-classification`
**Purpose**: Create or update call classification data
- **Input**: Phone number, clinic name, classification type, IVR actions, confidence score
- **Authentication**: Requires user session token
- **Output**: Created/updated classification ID
- **Location**: `supabase-functions/save-classification.ts`

#### `delete-call`
**Purpose**: Permanently delete a pending call record
- **Input**: Call ID
- **Authentication**: Requires user session token
- **Validation**: Verifies call exists before deletion
- **Output**: Success confirmation with deleted call details
- **Location**: `supabase-functions/delete-call.ts`
- **Note**: This is a permanent deletion, not archival

#### `archive-call`
**Purpose**: Soft-delete a call by setting is_active to false
- **Input**: Call ID
- **Authentication**: Requires user session token
- **Output**: Success confirmation
- **Location**: `supabase-functions/archive-call.ts`
- **Reversible**: Can be undone with unarchive-call

#### `unarchive-call`
**Purpose**: Restore an archived call by setting is_active to true
- **Input**: Call ID
- **Authentication**: Requires user session token
- **Output**: Success confirmation
- **Location**: `supabase-functions/unarchive-call.ts`

#### `detect-timezone`
**Purpose**: Auto-detect timezone from clinic address using Google Maps APIs
- **Input**: Single address or array of addresses
- **External APIs**:
  - Google Maps Geocoding API (address → coordinates)
  - Google Maps Time Zone API (coordinates → timezone)
- **Authentication**: Requires user session token
- **Output**: Array of results with timezone, lat/lng, or error messages
- **Location**: `supabase-functions/detect-timezone.ts`
- **Configuration**: Requires `GOOGLE_MAPS_API_KEY` environment variable
- **Setup Guide**: See `GOOGLE-MAPS-SETUP.md` for detailed setup instructions
- **Cost**: $10 per 1,000 addresses (with $200/month free tier)

#### `import-calls`
**Purpose**: Bulk import multiple calls from parsed file data
- **Input**: Array of call records with all required fields
- **Validation**: Phone number format, required fields, date formats
- **Authentication**: Requires user session token
- **Output**: Success count and any error details
- **Location**: `supabase-functions/import-calls.ts`
- **Features**: Batch processing, duplicate detection, error reporting

### Edge Function Authentication

All edge functions require user authentication:
```javascript
const authHeader = req.headers.get('Authorization')
const token = authHeader.replace('Bearer ', '')
const { data: { user }, error } = await supabase.auth.getUser(token)

if (error || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
}
```

### CORS Headers

All edge functions include CORS headers for browser access:
```javascript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

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

### Creating a New Call Workflow
1. **Click "New Call"**: Open the new call form from dashboard
2. **Fill Employee Information**: Enter exam ID, name, DOB, client name
3. **Set Appointment Details**: Date/time, visit type, procedures
4. **Enter Clinic Information**: Name, phone, address, timezone
5. **Configure Task**: Select task type (Records Request, etc.)
6. **Submit**: Call appears in dashboard immediately

### Bulk Import Workflow
1. **Open Import Wizard**: Click "Import Calls" button
2. **Upload File**: Drag & drop or select Excel/CSV file
3. **Map Columns**: Verify automatic column mapping or adjust manually
4. **Select Rows**: Choose which rows to import (or select all)
5. **Review Data**: Check transformations and data quality
6. **Auto-Detect Timezones**: (Optional) Let system detect timezones from addresses
7. **Import**: Complete import and verify success

### Edit Call Workflow
1. **Click Edit Button**: Green edit icon in call row
2. **Choose Tab**:
   - **Edit Call Tab**: Modify call details, appointment info, clinic data
   - **Edit Classification Tab**: Configure call handling and IVR actions
3. **Make Changes**: Update fields as needed
4. **Save**: Changes applied immediately with real-time update

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

### Archive/Delete Workflow
1. **Archive**: Click orange archive icon to soft-delete call
2. **Unarchive**: Change filter to "Inactive", click green unarchive icon
3. **Delete**: Click red delete icon, confirm in modal (permanent)
4. **Verify**: Call removed or archived status updated immediately

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
/public/                        # Publicly accessible files
├── login.html                 # Login page
├── mfa.html                  # MFA verification
├── dashboard.html            # Main dashboard
├── monitor.html              # Call monitor
├── /scripts/                 # JavaScript files
│   ├── config.js             # Configuration loader
│   ├── dashboard.js          # Dashboard logic (3300+ lines)
│   └── call-monitor.js       # Monitor logic (2600+ lines)
├── /styles/                  # CSS files
│   └── monitor.css           # Main stylesheet (2600+ lines)
└── config.json              # Production config (git-ignored)

/test-pages/                  # Internal test pages (not served)
├── test-realtime.html        # Realtime testing
└── monitor-test.html         # Monitor testing

/supabase-functions/          # Edge functions (Deno runtime)
├── save-classification.ts    # Create/update call classifications
├── delete-call.ts           # Permanently delete calls
├── archive-call.ts          # Soft-delete calls
├── unarchive-call.ts        # Restore archived calls
├── detect-timezone.ts       # Auto-detect timezones via Google Maps
└── import-calls.ts          # Bulk import calls from files

/docs/                        # Documentation
├── UI_DOCUMENTATION.md       # This file - comprehensive UI guide
├── GOOGLE-MAPS-SETUP.md     # Setup guide for timezone detection
└── RLS_POLICY_REVIEW.md     # Security policy documentation
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
- [ ] Export Functionality: Download filtered data as CSV/Excel
- [ ] Advanced Analytics: Call statistics, success rates, and trends dashboard
- [ ] Notification System: Browser notifications for critical events
- [ ] Bulk Actions: Multi-select operations for batch processing
- [ ] Column Customization: User-defined column visibility and order
- [ ] Call Recording Playback: Audio playback interface in monitor
- [ ] Advanced Timezone Detection: Batch timezone fix for existing calls
- [ ] Duplicate Detection: Warn about potential duplicate calls during import
- [ ] Call Templates: Save and reuse common call configurations
- [ ] Advanced IVR Testing: Test IVR flows before making calls

### Performance Optimizations
- [ ] Virtual scrolling for large datasets (1000+ calls)
- [ ] Debounced real-time updates for high-frequency changes
- [ ] Progressive data loading with pagination
- [ ] WebSocket reconnection with exponential backoff
- [ ] Optimized import for very large files (10,000+ rows)
- [ ] Client-side caching for classification data

### Recently Completed ✅
- [x] Bulk Import: Excel/CSV file upload with 6-step wizard
- [x] New Call Form: Create individual calls from dashboard
- [x] Edit Call Modal: Comprehensive editing with tabs
- [x] Delete Functionality: Permanent call deletion with confirmation
- [x] Archive/Unarchive: Soft delete with reversible archive
- [x] Timezone Auto-Detection: Google Maps API integration
- [x] Enhanced Search: Real-time filtering across all fields
- [x] Action Buttons: Standardized, responsive button design
- [x] Mobile Responsive: Optimized layouts for all screen sizes
- [x] Modal Scrolling: Proper overflow handling for long forms

## Recent Major Updates

### October 2025 - Dashboard v10 & Call Monitor v3

#### 📁 Import Wizard (Bulk Call Uploads)
**Complete 6-step import workflow for uploading multiple calls from Excel/CSV files**

**Step 1: File Upload**
- **Drag & Drop Support**: Drop files directly onto upload area
- **File Type Support**: Excel (.xlsx, .xls) and CSV (.csv) files
- **Visual Feedback**: Drag hover effects and upload status
- **File Preview**: Shows file name and record count after upload

**Step 2: Column Mapping**
- **Automatic Mapping**: Smart detection of column headers to database fields
- **Manual Adjustment**: Dropdown selectors for each required field
- **Required Fields**:
  - Exam ID
  - Employee Name
  - Employee DOB
  - Client Name
  - Appointment Time
  - Type of Visit
  - Clinic Name
  - Phone Number
  - Clinic Timezone
- **Optional Fields**:
  - Procedures
  - Clinic Provider Address
  - Task Type
- **Visual Validation**: Shows mapped vs unmapped columns

**Step 3: Row Selection**
- **Bulk Actions**: Select All, Select None, Toggle Selection
- **Individual Selection**: Click rows to include/exclude from import
- **Live Preview**: Shows data from mapped columns
- **Import Count**: Real-time count of selected rows

**Step 4: Review & Transformations**
- **Automatic Transformations**:
  - Walk-in visit type normalization
  - Phone number formatting
  - Date formatting for Excel serial dates
  - Timezone standardization
- **Visual Review**: Table showing all data to be imported
- **Edit Before Import**: Final chance to review data

**Step 5: Auto-Detect Timezones** (Optional)
- **Google Maps Integration**: Automatic timezone detection from clinic addresses
- **Batch Processing**: Processes all addresses with missing timezones
- **Progress Indicator**: Shows processing status
- **Fallback**: Manual timezone entry if auto-detection fails
- **Configuration Required**: Google Maps API key (see GOOGLE-MAPS-SETUP.md)

**Step 6: Final Import**
- **Batch Upload**: Efficiently uploads all selected records
- **Progress Bar**: Visual feedback during upload
- **Error Handling**: Reports any failed imports with reasons
- **Success Summary**: Shows count of successfully imported calls
- **Automatic Refresh**: Dashboard updates with new calls

**Import Features**:
- **Reset Between Imports**: Clean state for consecutive imports
- **Validation**: Phone number format validation (accepts formatted numbers)
- **Error Messages**: Clear feedback for validation issues
- **Duplicate Prevention**: Checks for existing records
- **Debug Logging**: Detailed logs for troubleshooting

#### ➕ New Pending Call Form
**Create individual calls directly from the dashboard**

**Form Features**:
- **Comprehensive Fields**: All required pending_call attributes
- **Employee Information**:
  - Exam ID
  - Employee Name
  - Employee Date of Birth
  - Client Name
- **Appointment Details**:
  - Appointment Date/Time (datetime-local picker)
  - Type of Visit (Appointment/Walk-in)
  - Procedures (optional textarea)
- **Clinic Information**:
  - Clinic Name
  - Phone Number (with format validation)
  - Clinic Provider Address (optional)
  - Clinic Timezone (dropdown selector)
- **Task Configuration**:
  - Task Type (Records Request, etc.)
- **Validation**: Required field validation before submission
- **Default State**: Sets workflow_state to 'pending' for new calls
- **Real-time Update**: New call appears in table immediately after creation

#### ✏️ Enhanced Edit Modal with Tabs
**Comprehensive editing interface for both call data and classifications**

**Two-Tab Interface**:

**Tab 1: Edit Call**
- **Full Call Editing**: Edit all pending_call fields
- **Same Fields as New Call Form**: Consistent interface
- **Employee Information**: Exam ID, name, DOB, client name
- **Appointment Information**: Time, visit type, procedures
- **Clinic Information**: Name, phone, address, timezone
- **Task Information**: Task type configuration
- **Validation**: Required fields enforced
- **Smart Save**: Updates only call data when on this tab

**Tab 2: Edit Classification**
- **Classification Management**: Configure call handling behavior
- **Phone & Clinic**: Phone number and clinic name association
- **Classification Types**:
  - Human Only
  - IVR Only
  - IVR then Human
  - Transfer
- **IVR Actions Configuration**:
  - Action Type: DTMF, Speech, Transfer, Wait
  - Action Value: Button press, speech text, or transfer number
  - Timing (ms): When to execute action
  - Add/Remove Actions: Dynamic action list
- **Confidence Score**: Slider for classification confidence (0-1)
- **Smart Save**: Updates classification data when on this tab

**Modal Features**:
- **Tab Switching**: Click tabs to switch between Call and Classification editing
- **Visual Active State**: Green underline and background for active tab
- **Persistent Data**: Loads existing data when editing
- **Cancel Option**: Discard changes and close modal
- **Success Feedback**: Toast notifications on successful save
- **Error Handling**: Clear error messages on validation or save failures

#### 🗑️ Delete Call Functionality
**Permanently remove pending calls with confirmation**

**Features**:
- **Delete Button**: Red trash icon button in action column
- **Confirmation Modal**:
  - Warning message with call details
  - Shows employee name and clinic name
  - "This action cannot be undone" warning
  - Cancel and Delete options
- **Edge Function**: `delete-call` Supabase function
- **Authentication Required**: User must be logged in
- **Success Feedback**: Toast notification with deleted call info
- **Real-time Update**: Call removed from table immediately
- **Audit Trail**: Console logging of deletion events

#### 📦 Archive/Unarchive Functionality
**Manage call visibility with archive toggle**

**Dashboard Implementation**:
- **Active Status Filter**: Toggle between Active/Inactive/All calls
- **Archive Button**: Orange archive icon in action column
- **Batch Archive**: Archive multiple calls
- **Visual Indicator**: Archived calls shown with muted styling
- **Persistent Filter**: Remembers active/inactive preference

**Monitor Page Implementation**:
- **Archive Call Button**: Full-width button with icon and text
- **Unarchive Mode**: Button changes to green "Unarchive Call" when viewing archived call
- **Real-time Update**: Immediate feedback on archive status change
- **Edge Function**: `archive-call` and `unarchive-call` Supabase functions
- **Success Feedback**: Toast notifications

**Archive Features**:
- **Soft Delete**: Calls remain in database but hidden from active view
- **Reversible**: Can unarchive calls at any time
- **Filter Integration**: Works with existing filter system
- **Search Compatibility**: Archived calls excluded from search unless filter includes inactive

#### 🎨 Action Button Improvements
**Standardized, responsive action buttons across the application**

**Dashboard Buttons**:
- **Compact Design**: 26px × 26px uniform sizing
- **Icon-Only**: Space-efficient for table rows
- **Color Coding**:
  - Green: Play (make call) and Edit buttons
  - Orange: Archive button
  - Red: Delete button
- **Icon Size**: 12px icons for clarity
- **Spacing**: 3px margin between buttons
- **Hover Effects**: Subtle lift and shadow on hover
- **No Wrapping**: Optimized sizing prevents button wrap to second line

**Monitor Page Buttons**:
- **Full-Size Design**: Larger buttons with text labels
- **Button Styles**:
  - **Reset & Retry Call**: Blue button with circular arrow icon
  - **Edit Classification**: Green button with pencil icon
  - **Archive Call**: Orange button with archive icon
- **Padding**: 10px 16px for comfortable clicking
- **Icon Size**: 18px icons with text labels
- **Font Weight**: 600 weight for button text
- **Border Radius**: 8px rounded corners
- **Responsive**: Adapts to container width

**Consistent Behavior**:
- **Hover Effects**: Transform translateY(-1px) with enhanced shadow
- **Active State**: Press down effect
- **Disabled State**: Grayed out with no-cursor
- **Visual Feedback**: All button clicks show immediate feedback

#### 🔍 Enhanced Search Functionality
**Improved search with better performance and coverage**

**Search Improvements**:
- **Real-Time Filtering**: Instant results as you type
- **Comprehensive Coverage**: Searches all visible fields
- **Case-Insensitive**: Smart matching regardless of case
- **Clear Button**: Quick reset with visual X button
- **Keyboard Support**: Enter key support
- **Performance**: Optimized search algorithm
- **Filter Compatibility**: Works alongside dropdown filters
- **Persistent State**: Maintains search during real-time updates

#### 📱 Mobile & Responsive Design
**Optimized layouts for all screen sizes**

**Responsive Features**:
- **Mobile Layout**: Stacked form fields on small screens
- **Tablet Optimization**: 2-column layouts where appropriate
- **Touch Targets**: Larger buttons and clickable areas
- **Horizontal Scroll**: Table scrolls horizontally on narrow screens
- **Modal Responsiveness**: Modals adapt to screen size
- **Font Scaling**: Readable text on all devices
- **Navigation**: Touch-friendly menu and controls

#### 🔐 Security & RLS Improvements
**Enhanced security policies and documentation**

**RLS Policy Review**:
- **Comprehensive Documentation**: Detailed RLS policy review
- **Service Role Policies**: Documented edge function authentication
- **Policy Testing**: Verified all policies work correctly
- **Access Control**: Proper row-level security for all tables
- **Edge Function Auth**: Session token required for sensitive operations

---

*Last Updated: October 2025*
*Dashboard Version: v10*
*Call Monitor Version: v3*
*Based on commit: 9f29da3*