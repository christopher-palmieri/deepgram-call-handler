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
    <title>IVR Call Monitor</title>
    
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            color: #667eea;
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
        
        /* Monitor Container */
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 1200px;
            overflow: hidden;
            display: none;
        }
        
        .container.authenticated {
            display: block;
        }
        
        .login-container.authenticated {
            display: none;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            position: relative;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 10px;
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
            color: #667eea;
            border: none;
            border-radius: 15px;
            cursor: pointer;
            font-weight: bold;
            font-size: 12px;
        }
        
        .logout-btn:hover {
            transform: scale(1.05);
        }
        
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
            color: #667eea;
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
            background: #667eea;
            color: white;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .audio-controls button:hover:not(:disabled) {
            background: #764ba2;
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
            height: 500px;
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
            background: linear-gradient(to right, #667eea, #764ba2);
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
        <h1>🔐 IVR Monitor Login</h1>
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

    <!-- Monitor Container -->
    <div class="container" id="monitorContainer">
        <div class="header">
            <div class="user-info">
                <span class="user-email" id="userEmail">-</span>
                <button class="logout-btn" onclick="logout()">Sign Out</button>
            </div>
            
            <h1>🎧 IVR Call Monitor</h1>
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
                <button onclick="fetchActiveCalls()">
                    Show Active Calls
                </button>
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
                🔇 Enable Audio
            </button>
            <div class="volume-control">
                <span>🔊</span>
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
                <h3>📝 Transcripts</h3>
                <div id="transcripts">
                    <div class="empty-state">
                        <p>Waiting for transcripts...</p>
                    </div>
                </div>
            </div>
            
            <div class="panel">
                <h3>📊 Events & Actions</h3>
                <div id="events">
                    <div class="empty-state">
                        <p>Waiting for events...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Supabase configuration - these will be replaced by environment variables in Vercel
        const SUPABASE_URL = window.SUPABASE_URL || 'YOUR_SUPABASE_URL';
        const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
        const WS_URL = window.WS_URL || 'wss://your-railway-app.railway.app/monitor';
        
        // Initialize Supabase client
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // Monitor state
        let ws = null;
        let isConnected = false;
        let audioContext = null;
        let audioEnabled = false;
        let audioQueue = [];
        let isPlaying = false;
        let currentVolume = 0.5;
        let audioVisualizerInterval = null;
        let currentUser = null;
        
        // Check authentication on load
        async function checkAuth() {
            const { data: { user } } = await supabase.auth.getUser();
            
            if (user) {
                currentUser = user;
                showMonitor(user);
            } else {
                showLogin();
            }
        }
        
        // Show login screen
        function showLogin() {
            document.getElementById('loginContainer').classList.remove('authenticated');
            document.getElementById('monitorContainer').classList.remove('authenticated');
        }
        
        // Show monitor screen
        function showMonitor(user) {
            document.getElementById('loginContainer').classList.add('authenticated');
            document.getElementById('monitorContainer').classList.add('authenticated');
            document.getElementById('userEmail').textContent = user.email;
            
            // Check URL params for auto-connect
            const urlParams = new URLSearchParams(window.location.search);
            const callIdParam = urlParams.get('callId');
            if (callIdParam) {
                document.getElementById('callIdInput').value = callIdParam;
                setTimeout(() => connect(), 500);
            }
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
                    showMonitor(data.user);
                }, 500);
                
            } catch (error) {
                authMessage.innerHTML = `<div class="error-message">${error.message}</div>`;
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
        
        // Fetch active calls from Supabase
        async function fetchActiveCalls() {
            if (!currentUser) {
                alert('Please log in first');
                return;
            }
            
            try {
                const { data: calls, error } = await supabase
                    .from('call_sessions')
                    .select('call_id, clinic_name, created_at')
                    .eq('call_status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(10);
                
                if (error) throw error;
                
                if (calls && calls.length > 0) {
                    const callList = calls.map(call => {
                        const time = new Date(call.created_at).toLocaleTimeString();
                        return `${call.call_id} - ${call.clinic_name || 'Unknown'} (${time})`;
                    }).join('\n');
                    
                    const selectedCall = prompt('Active calls:\n\n' + callList + '\n\nEnter Call ID to monitor:');
                    if (selectedCall) {
                        document.getElementById('callIdInput').value = selectedCall;
                        connect();
                    }
                } else {
                    alert('No active calls found');
                }
            } catch (error) {
                alert('Error fetching calls: ' + error.message);
            }
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
            
            // Add user token to WebSocket connection for additional security
            const wsUrlWithAuth = `${WS_URL}?callId=${callId}&token=${currentUser.access_token}`;
            
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
                button.textContent = '🔊 Disable Audio';
                status.textContent = 'Audio: Enabled';
                processAudioQueue();
            } else {
                audioEnabled = false;
                button.textContent = '🔇 Enable Audio';
                status.textContent = 'Audio: Disabled';
                audioQueue = [];
            }
        }
        
        function setVolume(value) {
            currentVolume = value / 100;
            document.getElementById('volumeValue').textContent = `${value}%`;
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
                        addEvent(`Error: ${data.message || data.error}`, '⚠️', 'event-end');
                    }
                    break;
            }
        }
        
        // UI update functions
        function addTranscript(text, source = 'unknown') {
            const container = document.getElementById('transcripts');
            const emptyState = container.querySelector('.empty-state');
            if (emptyState) emptyState.remove();
            
            const item = document.createElement('div');
            item.className = 'transcript-item';
            item.innerHTML = `
                <div class="source">${source.toUpperCase()} • ${new Date().toLocaleTimeString()}</div>
                <div class="text">${text}</div>
            `;
            
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
            item.innerHTML = `
                <div class="event-icon ${className}">${icon}</div>
                <div class="event-details">
                    <div>${text}</div>
                    <div class="event-time">${new Date().toLocaleTimeString()}</div>
                </div>
            `;
            
            container.insertBefore(item, container.firstChild);
            
            while (container.children.length > 10) {
                container.removeChild(container.lastChild);
            }
        }
        
        function addClassification(classification, confidence) {
            const confidencePercent = Math.round(confidence * 100);
            addEvent(
                `Classification: ${classification} (${confidencePercent}% confidence)`,
                '🎯',
                'event-classification'
            );
        }
        
        function addIVRAction(actionType, actionValue) {
            let text = '';
            if (actionType === 'dtmf') {
                text = `Pressed: ${actionValue}`;
            } else if (actionType === 'speech') {
                text = `Said: "${actionValue}"`;
            } else if (actionType === 'transfer') {
                text = `Transfer detected - connecting VAPI`;
            } else {
                text = `Action: ${actionType} - ${actionValue}`;
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
                    bar.style.height = `${height}px`;
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
        });
        
        // Listen for auth state changes
        supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                showLogin();
                disconnect();
            } else if (event === 'SIGNED_IN' && session) {
                showMonitor(session.user);
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
