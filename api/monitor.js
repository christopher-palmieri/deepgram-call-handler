// api/monitor.js
// Complete working version with dashboard and call details

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use your EXISTING environment variables
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  
  // Use your existing DEEPGRAM_WS_URL and append /monitor path
  const WS_URL = process.env.DEEPGRAM_WS_URL ? 
    process.env.DEEPGRAM_WS_URL.replace(/\/$/, '') + '/monitor' : 
    'ws://localhost:3000/monitor';

  // Serve the monitor HTML with injected variables
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IVR Monitor Dashboard</title>
    
    <!-- Supabase Client -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #008d6f 0%, #00614d 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        /* Login Screen */
        .login-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        
        .login-container h1 {
            color: #008d6f;
            margin-bottom: 30px;
        }
        
        .login-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        
        .login-form input {
            padding: 12px 20px;
            border: 1px solid #ddd;
            border-radius: 10px;
            font-size: 16px;
        }
        
        .login-form button {
            padding: 12px 20px;
            background: linear-gradient(135deg, #008d6f 0%, #00614d 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .login-form button:hover {
            transform: scale(1.05);
        }
        
        .login-form button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .error-message {
            color: #dc2626;
            margin-top: 10px;
            font-size: 14px;
        }
        
        .success-message {
            color: #059669;
            margin-top: 10px;
            font-size: 14px;
        }
        
        /* Dashboard Container */
        .dashboard-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 1400px;
            overflow: hidden;
            display: none;
        }
        
        .dashboard-container.authenticated {
            display: block;
        }
        
        /* Call Details Container */
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 1200px;
            overflow: hidden;
            display: none;
        }
        
        .container.active {
            display: block;
        }
        
        .login-container.authenticated {
            display: none;
        }
        
        .header {
            background: linear-gradient(135deg, #008d6f 0%, #00614d 100%);
            color: white;
            padding: 30px;
            text-align: center;
            position: relative;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .header-nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .back-btn {
            padding: 8px 20px;
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            border-radius: 20px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
        }
        
        .back-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        
        .user-info {
            position: absolute;
            top: 20px;
            right: 20px;
            display: flex;
            align-items: center;
            gap: 15px;
            background: rgba(255,255,255,0.2);
            padding: 10px 20px;
            border-radius: 20px;
        }
        
        .user-email {
            font-size: 14px;
        }
        
        .logout-btn {
            padding: 6px 15px;
            background: white;
            color: #008d6f;
            border: none;
            border-radius: 15px;
            cursor: pointer;
            font-weight: bold;
            font-size: 12px;
        }
        
        .logout-btn:hover {
            transform: scale(1.05);
        }
        
        /* Dashboard Table */
        .dashboard-content {
            padding: 30px;
        }
        
        .dashboard-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .refresh-btn {
            padding: 10px 20px;
            background: #008d6f;
            color: white;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
        }
        
        .refresh-btn:hover {
            background: #00614d;
        }
        
        .status-filter {
            display: flex;
            gap: 10px;
        }
        
        .filter-btn {
            padding: 8px 16px;
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .filter-btn.active {
            background: #008d6f;
            color: white;
            border-color: #008d6f;
        }
        
        .calls-table {
            width: 100%;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .calls-table table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .calls-table th {
            background: #f9fafb;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #374151;
            border-bottom: 1px solid #e5e7eb;
            font-size: 14px;
        }
        
        .calls-table td {
            padding: 12px;
            border-bottom: 1px solid #f3f4f6;
            font-size: 14px;
        }
        
        .calls-table tr:hover {
            background: #f9fafb;
        }
        
        .calls-table tr.clickable {
            cursor: pointer;
        }
        
        .workflow-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .workflow-new { background: #dbeafe; color: #1e40af; }
        .workflow-calling { background: #fef3c7; color: #92400e; }
        .workflow-completed { background: #d1fae5; color: #065f46; }
        .workflow-failed { background: #fee2e2; color: #991b1b; }
        .workflow-retry_pending { background: #fed7aa; color: #9a3412; }
        .workflow-classifying { background: #e9d5ff; color: #6b21a8; }
        .workflow-ready_to_call { background: #bfdbfe; color: #1e3a8a; }
        
        .monitor-btn {
            padding: 6px 16px;
            background: #008d6f;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: all 0.2s;
        }
        
        .monitor-btn:hover {
            background: #00614d;
            transform: scale(1.05);
        }
        
        .empty-table {
            padding: 40px;
            text-align: center;
            color: #6b7280;
        }
        
        /* Call Details Styles */
        .connection-form {
            display: flex;
            gap: 10px;
            margin-top: 20px;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .connection-form input {
            padding: 12px 20px;
            border-radius: 25px;
            border: none;
            font-size: 16px;
            width: 300px;
        }
        
        .connection-form button {
            padding: 12px 30px;
            border-radius: 25px;
            border: none;
            background: white;
            color: #008d6f;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .connection-form button:hover:not(:disabled) {
            transform: scale(1.05);
        }
        
        .connection-form button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .call-info-panel {
            background: #f9fafb;
            padding: 20px;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .call-info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .info-item {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .info-label {
            font-size: 12px;
            color: #6b7280;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .info-value {
            font-size: 14px;
            color: #111827;
        }
        
        .status {
            padding: 20px 30px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }
        
        .status-badge {
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }
        
        .status-connected {
            background: #d4edda;
            color: #155724;
        }
        
        .status-disconnected {
            background: #f8d7da;
            color: #721c24;
        }
        
        .status-connecting {
            background: #fff3cd;
            color: #856404;
        }
        
        .audio-controls {
            background: #343a40;
            padding: 20px;
            display: flex;
            align-items: center;
            gap: 20px;
            flex-wrap: wrap;
        }
        
        .audio-controls button {
            padding: 10px 20px;
            border-radius: 20px;
            border: none;
            background: #008d6f;
            color: white;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .audio-controls button:hover:not(:disabled) {
            background: #00614d;
            transform: scale(1.05);
        }
        
        .audio-controls button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .volume-control {
            display: flex;
            align-items: center;
            gap: 10px;
            color: white;
        }
        
        .volume-slider {
            width: 150px;
        }
        
        .audio-status {
            color: white;
            font-size: 14px;
            padding: 8px 16px;
            background: rgba(0,0,0,0.3);
            border-radius: 20px;
        }
        
        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            padding: 20px;
            height: 400px;
        }
        
        .panel {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            overflow-y: auto;
        }
        
        .panel h3 {
            margin-bottom: 15px;
            color: #495057;
            font-size: 18px;
        }
        
        .transcript-item, .event-item {
            background: white;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .transcript-item .source {
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 5px;
        }
        
        .transcript-item .text {
            color: #212529;
            line-height: 1.5;
        }
        
        .event-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .event-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
        }
        
        .event-classification {
            background: #e3f2fd;
        }
        
        .event-action {
            background: #fff3e0;
        }
        
        .event-audio {
            background: #e8f5e9;
        }
        
        .event-end {
            background: #fce4ec;
        }
        
        .event-details {
            flex: 1;
        }
        
        .event-time {
            font-size: 12px;
            color: #6c757d;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #6c757d;
        }
        
        .audio-visualizer {
            height: 60px;
            background: linear-gradient(to right, #008d6f, #00614d);
            border-radius: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 0 20px;
        }
        
        .audio-bar {
            width: 3px;
            background: white;
            border-radius: 2px;
            transition: height 0.1s ease;
        }
    </style>
</head>
<body>
    <!-- Login Container -->
    <div class="login-container" id="loginContainer">
        <h1>IVR Monitor Login</h1>
        <form class="login-form" id="loginForm">
            <input 
                type="email" 
                id="emailInput" 
                placeholder="Email address"
                required
            />
            <input 
                type="password" 
                id="passwordInput" 
                placeholder="Password"
                required
            />
            <button type="submit" id="loginBtn">
                Sign In
            </button>
        </form>
        <div id="authMessage"></div>
    </div>

    <!-- Dashboard Container -->
    <div class="dashboard-container" id="dashboardContainer">
        <div class="header">
            <div class="user-info">
                <span class="user-email" id="userEmailDash">-</span>
                <button class="logout-btn" onclick="logout()">Sign Out</button>
            </div>
            
            <h1>IVR Monitor Dashboard</h1>
            <p>Active and pending calls overview</p>
        </div>
        
        <div class="dashboard-content">
            <div class="dashboard-controls">
                <div class="status-filter">
                    <button class="filter-btn active" onclick="filterCalls('all')">All</button>
                    <button class="filter-btn" onclick="filterCalls('active')">Active</button>
                    <button class="filter-btn" onclick="filterCalls('pending')">Pending</button>
                    <button class="filter-btn" onclick="filterCalls('completed')">Completed</button>
                </div>
                <button class="refresh-btn" onclick="loadPendingCalls()">Refresh</button>
            </div>
            
            <div class="calls-table">
                <table>
                    <thead>
                        <tr>
                            <th>Employee Name</th>
                            <th>Clinic</th>
                            <th>Phone</th>
                            <th>Workflow State</th>
                            <th>Retry Count</th>
                            <th>Last Attempt</th>
                            <th>Success</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="callsTableBody">
                        <tr>
                            <td colspan="8" class="empty-table">Loading calls...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Call Details Container -->
    <div class="container" id="monitorContainer">
        <div class="header">
            <div class="user-info">
                <span class="user-email" id="userEmail">-</span>
                <button class="logout-btn" onclick="logout()">Sign Out</button>
            </div>
            
            <div class="header-nav">
                <button class="back-btn" onclick="showDashboard()">← Back to Dashboard</button>
                <div></div>
            </div>
            
            <h1>Call Monitor</h1>
            <p>Real-time monitoring of IVR classification and navigation</p>
            
            <div class="connection-form">
                <input 
                    type="text" 
                    id="callIdInput" 
                    placeholder="Enter Call SID (e.g., CA...)"
                    value=""
                />
                <button id="connectBtn" onclick="toggleConnection()">
                    Connect
                </button>
            </div>
        </div>
        
        <div class="call-info-panel" id="callInfoPanel" style="display: none;">
            <div class="call-info-grid">
                <div class="info-item">
                    <span class="info-label">Employee</span>
                    <span class="info-value" id="infoEmployee">-</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Clinic</span>
                    <span class="info-value" id="infoClinic">-</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Phone</span>
                    <span class="info-value" id="infoPhone">-</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Appointment</span>
                    <span class="info-value" id="infoAppointment">-</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Workflow State</span>
                    <span class="info-value" id="infoWorkflow">-</span>
                </div>
            </div>
        </div>
        
        <div class="status">
            <div>
                <strong>Status:</strong>
                <span id="statusBadge" class="status-badge status-disconnected">
                    Disconnected
                </span>
            </div>
            <div id="callInfo" style="display: none;">
                Call ID: <code id="callIdDisplay">-</code>
            </div>
        </div>
        
        <div class="audio-controls">
            <button id="audioToggle" onclick="toggleAudio()">
                Enable Audio
            </button>
            <div class="volume-control">
                <span>Volume</span>
                <input type="range" id="volumeSlider" class="volume-slider" 
                       min="0" max="100" value="50" onchange="setVolume(this.value)">
                <span id="volumeValue">50%</span>
            </div>
            <div class="audio-status" id="audioStatus">
                Audio: Disabled
            </div>
            <div class="audio-visualizer" id="audioVisualizer" style="display: none;">
            </div>
        </div>
        
        <div class="main-content">
            <div class="panel">
                <h3>Transcripts</h3>
                <div id="transcripts">
                    <div class="empty-state">
                        <p>Waiting for transcripts...</p>
                    </div>
                </div>
            </div>
            
            <div class="panel">
                <h3>Events & Actions</h3>
                <div id="events">
                    <div class="empty-state">
                        <p>Waiting for events...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Inject environment variables from server
        window.SUPABASE_URL = '${SUPABASE_URL}';
        window.SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
        window.WS_URL = '${WS_URL}';
        
        // Initialize Supabase client
        const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        
        // State
        let currentUser = null;
        let currentView = 'dashboard';
        let allCalls = [];
        let currentFilter = 'all';
        let currentPendingCall = null;
        
        // Monitor state
        let ws = null;
        let isConnected = false;
        let audioContext = null;
        let audioEnabled = false;
        let audioQueue = [];
        let isPlaying = false;
        let currentVolume = 0.5;
        let audioVisualizerInterval = null;
        
        // Check authentication on load
        async function checkAuth() {
            const { data: { user } } = await supabase.auth.getUser();
            
            if (user) {
                currentUser = user;
                showDashboard();
            } else {
                showLogin();
            }
        }
        
        // Show login screen
        function showLogin() {
            document.getElementById('loginContainer').classList.remove('authenticated');
            document.getElementById('dashboardContainer').classList.remove('authenticated');
            document.getElementById('monitorContainer').classList.remove('active');
        }
        
        // Show dashboard
        function showDashboard() {
            if (!currentUser) return;
            
            currentView = 'dashboard';
            document.getElementById('loginContainer').classList.add('authenticated');
            document.getElementById('dashboardContainer').classList.add('authenticated');
            document.getElementById('monitorContainer').classList.remove('active');
            document.getElementById('userEmailDash').textContent = currentUser.email;
            
            loadPendingCalls();
        }
        
        // Show call details
        function showCallDetails(pendingCallId) {
            currentView = 'details';
            document.getElementById('dashboardContainer').classList.remove('authenticated');
            document.getElementById('monitorContainer').classList.add('active');
            document.getElementById('userEmail').textContent = currentUser.email;
            
            // Load the pending call details
            loadCallDetails(pendingCallId);
        }
        
        // Load pending calls for dashboard
        async function loadPendingCalls() {
            try {
                const { data: calls, error } = await supabase
                    .from('pending_calls')
                    .select('*, call_sessions(*)')
                    .order('created_at', { ascending: false })
                    .limit(50);
                
                if (error) throw error;
                
                allCalls = calls || [];
                renderCallsTable();
                
            } catch (error) {
                console.error('Error loading calls:', error);
                document.getElementById('callsTableBody').innerHTML = 
                    '<tr><td colspan="8" class="empty-table">Error loading calls</td></tr>';
            }
        }
        
        // Filter calls
        function filterCalls(filter) {
            currentFilter = filter;
            
            // Update active button
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            event.target.classList.add('active');
            
            renderCallsTable();
        }
        
        // Render calls table
        function renderCallsTable() {
            const tbody = document.getElementById('callsTableBody');
            
            let filteredCalls = allCalls;
            if (currentFilter !== 'all') {
                if (currentFilter === 'active') {
                    filteredCalls = allCalls.filter(c => ['calling', 'classifying'].includes(c.workflow_state));
                } else if (currentFilter === 'pending') {
                    filteredCalls = allCalls.filter(c => ['new', 'ready_to_call', 'retry_pending'].includes(c.workflow_state));
                } else if (currentFilter === 'completed') {
                    filteredCalls = allCalls.filter(c => ['completed', 'failed'].includes(c.workflow_state));
                }
            }
            
            if (filteredCalls.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-table">No calls found</td></tr>';
                return;
            }
            
            tbody.innerHTML = filteredCalls.map(call => {
                const lastAttempt = call.last_attempt_at ? 
                    new Date(call.last_attempt_at).toLocaleString() : '-';
                
                const activeSession = call.call_sessions && call.call_sessions.find(s => s.call_status === 'active');
                
                return '<tr class="clickable" onclick="showCallDetails(\'' + call.id + '\')">' +
                    '<td>' + (call.employee_name || '-') + '</td>' +
                    '<td>' + (call.clinic_name || '-') + '</td>' +
                    '<td>' + (call.phone || '-') + '</td>' +
                    '<td><span class="workflow-badge workflow-' + call.workflow_state + '">' + call.workflow_state + '</span></td>' +
                    '<td>' + (call.retry_count || 0) + '/' + (call.max_retries || 3) + '</td>' +
                    '<td>' + lastAttempt + '</td>' +
                    '<td>' + (call.success_evaluation || '-') + '</td>' +
                    '<td>' +
                        (activeSession ? 
                            '<button class="monitor-btn" onclick="event.stopPropagation(); monitorCall(\'' + 
                            call.id + '\', \'' + activeSession.call_id + '\')">Monitor Live</button>' :
                            '<button class="monitor-btn" onclick="event.stopPropagation(); showCallDetails(\'' + 
                            call.id + '\')">View Details</button>') +
                    '</td>' +
                '</tr>';
            }).join('');
        }
        
        // Load call details
        async function loadCallDetails(pendingCallId) {
            try {
                const { data: pendingCall, error } = await supabase
                    .from('pending_calls')
                    .select('*')
                    .eq('id', pendingCallId)
                    .single();
                
                if (error) throw error;
                
                currentPendingCall = pendingCall;
                
                // Display call info
                document.getElementById('infoEmployee').textContent = pendingCall.employee_name || '-';
                document.getElementById('infoClinic').textContent = pendingCall.clinic_name || '-';
                document.getElementById('infoPhone').textContent = pendingCall.phone || '-';
                document.getElementById('infoAppointment').textContent = 
                    pendingCall.appointment_time ? 
                    new Date(pendingCall.appointment_time).toLocaleString() : '-';
                document.getElementById('infoWorkflow').textContent = pendingCall.workflow_state || '-';
                
                document.getElementById('callInfoPanel').style.display = 'block';
                
                // Check for active session
                const { data: sessions } = await supabase
                    .from('call_sessions')
                    .select('*')
                    .eq('pending_call_id', pendingCallId)
                    .eq('call_status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1);
                
                if (sessions && sessions.length > 0) {
                    document.getElementById('callIdInput').value = sessions[0].call_id;
                }
                
            } catch (error) {
                console.error('Error loading call details:', error);
            }
        }
        
        // Monitor specific call
        function monitorCall(pendingCallId, callId) {
            showCallDetails(pendingCallId);
            setTimeout(() => {
                document.getElementById('callIdInput').value = callId;
                connect();
            }, 500);
        }
        
        // Handle login
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('emailInput').value;
            const password = document.getElementById('passwordInput').value;
            const authMessage = document.getElementById('authMessage');
            const loginBtn = document.getElementById('loginBtn');
            
            loginBtn.disabled = true;
            loginBtn.textContent = 'Signing in...';
            authMessage.innerHTML = '';
            
            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });
                
                if (error) throw error;
                
                authMessage.innerHTML = '<div class="success-message">Login successful!</div>';
                currentUser = data.user;
                
                setTimeout(() => {
                    showDashboard();
                }, 500);
                
            } catch (error) {
                authMessage.innerHTML = '<div class="error-message">' + error.message + '</div>';
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Sign In';
            }
        });
        
        // Handle logout
        async function logout() {
            await supabase.auth.signOut();
            currentUser = null;
            disconnect();
            showLogin();
        }
        
        // WebSocket connection functions
        function toggleConnection() {
            if (isConnected) {
                disconnect();
            } else {
                connect();
            }
        }
        
        function connect() {
            if (!currentUser) {
                alert('Please log in first');
                return;
            }
            
            const callId = document.getElementById('callIdInput').value.trim();
            
            if (!callId) {
                alert('Please enter a Call SID');
                return;
            }
            
            updateStatus('connecting');
            
            const wsUrlWithAuth = window.WS_URL + '?callId=' + callId + '&token=' + currentUser.access_token;
            
            ws = new WebSocket(wsUrlWithAuth);
            
            ws.onopen = () => {
                console.log('Connected to monitor');
                isConnected = true;
                updateStatus('connected');
                document.getElementById('connectBtn').textContent = 'Disconnect';
                document.getElementById('callIdDisplay').textContent = callId;
                document.getElementById('callInfo').style.display = 'block';
                clearContent();
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleMessage(data);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                updateStatus('disconnected');
            };
            
            ws.onclose = () => {
                console.log('Disconnected from monitor');
                isConnected = false;
                updateStatus('disconnected');
                document.getElementById('connectBtn').textContent = 'Connect';
                document.getElementById('callInfo').style.display = 'none';
                stopAudioVisualizer();
            };
        }
        
        function disconnect() {
            if (ws) {
                ws.close();
                ws = null;
            }
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }
        }
        
        function updateStatus(status) {
            const badge = document.getElementById('statusBadge');
            badge.className = 'status-badge';
            
            switch(status) {
                case 'connected':
                    badge.classList.add('status-connected');
                    badge.textContent = 'Connected';
                    break;
                case 'connecting':
                    badge.classList.add('status-connecting');
                    badge.textContent = 'Connecting...';
                    break;
                default:
                    badge.classList.add('status-disconnected');
                    badge.textContent = 'Disconnected';
            }
        }
        
        // Audio handling functions
        async function toggleAudio() {
            const button = document.getElementById('audioToggle');
            const status = document.getElementById('audioStatus');
            
            if (!audioEnabled) {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)({
                        sampleRate: 8000
                    });
                }
                
                audioEnabled = true;
                button.textContent = 'Disable Audio';
                status.textContent = 'Audio: Enabled';
                processAudioQueue();
            } else {
                audioEnabled = false;
                button.textContent = 'Enable Audio';
                status.textContent = 'Audio: Disabled';
                audioQueue = [];
            }
        }
        
        function setVolume(value) {
            currentVolume = value / 100;
            document.getElementById('volumeValue').textContent = value + '%';
        }
        
        // Message handling
        function handleMessage(data) {
            switch(data.type) {
                case 'connected':
                    addEvent('Connected to call', '🔗', 'event-audio');
                    break;
                case 'transcript':
                    addTranscript(data.text, data.source);
                    break;
                case 'classification':
                    addClassification(data.classification, data.confidence);
                    break;
                case 'ivr_action':
                    addIVRAction(data.action_type, data.action_value);
                    break;
                case 'audio':
                    if (data.data) {
                        handleAudioData(data.data);
                    }
                    break;
                case 'call_ended':
                    addEvent('Call ended', '📞', 'event-end');
                    stopAudioVisualizer();
                    break;
                case 'error':
                    if (data.message || data.error) {
                        addEvent('Error: ' + (data.message || data.error), '⚠️', 'event-end');
                    }
                    break;
            }
        }
        
        // UI update functions
        function addTranscript(text, source) {
            source = source || 'unknown';
            const container = document.getElementById('transcripts');
            const emptyState = container.querySelector('.empty-state');
            if (emptyState) emptyState.remove();
            
            const item = document.createElement('div');
            item.className = 'transcript-item';
            item.innerHTML = '<div class="source">' + source.toUpperCase() + ' • ' + new Date().toLocaleTimeString() + '</div>' +
                           '<div class="text">' + text + '</div>';
            
            container.insertBefore(item, container.firstChild);
            
            while (container.children.length > 10) {
                container.removeChild(container.lastChild);
            }
        }
        
        function addEvent(text, icon, className) {
            const container = document.getElementById('events');
            const emptyState = container.querySelector('.empty-state');
            if (emptyState) emptyState.remove();
            
            const item = document.createElement('div');
            item.className = 'event-item';
            item.innerHTML = '<div class="event-icon ' + className + '">' + icon + '</div>' +
                           '<div class="event-details">' +
                           '<div>' + text + '</div>' +
                           '<div class="event-time">' + new Date().toLocaleTimeString() + '</div>' +
                           '</div>';
            
            container.insertBefore(item, container.firstChild);
            
            while (container.children.length > 10) {
                container.removeChild(container.lastChild);
            }
        }
        
        function addClassification(classification, confidence) {
            const confidencePercent = Math.round(confidence * 100);
            addEvent(
                'Classification: ' + classification + ' (' + confidencePercent + '% confidence)',
                '🎯',
                'event-classification'
            );
        }
        
        function addIVRAction(actionType, actionValue) {
            let text = '';
            if (actionType === 'dtmf') {
                text = 'Pressed: ' + actionValue;
            } else if (actionType === 'speech') {
                text = 'Said: "' + actionValue + '"';
            } else if (actionType === 'transfer') {
                text = 'Transfer detected - connecting VAPI';
            } else {
                text = 'Action: ' + actionType + ' - ' + actionValue;
            }
            
            addEvent(text, '⚡', 'event-action');
        }
        
        function clearContent() {
            document.getElementById('transcripts').innerHTML = '<div class="empty-state"><p>Waiting for transcripts...</p></div>';
            document.getElementById('events').innerHTML = '<div class="empty-state"><p>Waiting for events...</p></div>';
        }
        
        // Audio processing functions
        function handleAudioData(base64Audio) {
            if (!audioEnabled) return;
            
            const visualizer = document.getElementById('audioVisualizer');
            if (visualizer.style.display === 'none') {
                visualizer.style.display = 'flex';
                startAudioVisualizer();
            }
            
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const pcmData = mulawToPCM(bytes);
            audioQueue.push(pcmData);
            
            if (!isPlaying) {
                processAudioQueue();
            }
        }
        
        function mulawToPCM(mulawData) {
            const MULAW_BIAS = 33;
            const pcmData = new Float32Array(mulawData.length);
            
            for (let i = 0; i < mulawData.length; i++) {
                let mulaw = mulawData[i];
                mulaw = ~mulaw & 0xFF;
                
                const sign = (mulaw & 0x80);
                const exponent = (mulaw >> 4) & 0x07;
                const mantissa = mulaw & 0x0F;
                
                let pcm = ((mantissa << 3) + MULAW_BIAS) << exponent;
                pcm -= MULAW_BIAS;
                
                if (sign !== 0) {
                    pcm = -pcm;
                }
                
                pcmData[i] = pcm / 32768.0;
            }
            
            return pcmData;
        }
        
        async function processAudioQueue() {
            if (!audioEnabled || audioQueue.length === 0 || isPlaying) return;
            
            isPlaying = true;
            
            while (audioQueue.length > 0 && audioEnabled) {
                const pcmData = audioQueue.shift();
                
                const audioBuffer = audioContext.createBuffer(1, pcmData.length, 8000);
                audioBuffer.copyToChannel(pcmData, 0);
                
                const source = audioContext.createBufferSource();
                const gainNode = audioContext.createGain();
                
                source.buffer = audioBuffer;
                gainNode.gain.value = currentVolume;
                
                source.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                await new Promise(resolve => {
                    source.onended = resolve;
                    source.start();
                });
            }
            
            isPlaying = false;
        }
        
        function startAudioVisualizer() {
            const visualizer = document.getElementById('audioVisualizer');
            visualizer.innerHTML = '';
            for (let i = 0; i < 30; i++) {
                const bar = document.createElement('div');
                bar.className = 'audio-bar';
                bar.style.height = '5px';
                visualizer.appendChild(bar);
            }
            
            audioVisualizerInterval = setInterval(() => {
                const bars = visualizer.querySelectorAll('.audio-bar');
                bars.forEach(bar => {
                    const height = 5 + Math.random() * 40;
                    bar.style.height = height + 'px';
                });
            }, 100);
        }
        
        function stopAudioVisualizer() {
            if (audioVisualizerInterval) {
                clearInterval(audioVisualizerInterval);
                audioVisualizerInterval = null;
            }
            document.getElementById('audioVisualizer').style.display = 'none';
        }
        
        // Initialize on load
        window.addEventListener('load', () => {
            checkAuth();
            
            // Set up auto-refresh
            setInterval(() => {
                if (currentView === 'dashboard' && currentUser) {
                    loadPendingCalls();
                }
            }, 30000); // Refresh every 30 seconds
        });
        
        // Listen for auth state changes
        supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                showLogin();
                disconnect();
            } else if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                showDashboard();
            }
        });
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
