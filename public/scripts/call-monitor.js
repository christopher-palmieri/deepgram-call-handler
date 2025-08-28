// public/scripts/call-monitor.js
// Complete WebSocket-based call monitoring with historical data support

let currentUser = null;
let currentPendingCall = null;
let ws = null;
let isConnected = false;
let audioContext = null;
let audioEnabled = false;
let audioQueue = [];
let isPlaying = false;
let currentVolume = 0.5;
let audioVisualizerInterval = null;
let connectionAttempts = 0;
let maxConnectionAttempts = 3;

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    await loadConfig(); // From config.js
    
    if (!supabase) {
        showError('Failed to initialize. Please refresh.');
        return;
    }
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user) {
        // Not logged in at all
        window.location.href = '/login.html';
        return;
    }
    
    // Check MFA level - must be aal2 to access monitor
    console.log('Monitor session check:', {
        aal: session.aal,
        userId: session.user?.id,
        hasUser: !!session.user
    });
    
    // Use getAuthenticatorAssuranceLevel instead of session.aal
    const { data: aalCheck } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    console.log('Monitor AAL check:', aalCheck);
    
    if (!aalCheck || aalCheck.currentLevel !== 'aal2') {
        console.log('MFA not completed, redirecting to login. Current AAL:', aalCheck?.currentLevel);
        window.location.href = '/login.html';
        return;
    }
    
    currentUser = session.user;
    document.getElementById('userEmail').textContent = currentUser.email;
    
    // Check for URL parameters
    const pendingCallId = getUrlParam('pendingCallId');
    const callId = getUrlParam('callId');
    const autoConnect = getUrlParam('autoConnect') === 'true';
    
    if (pendingCallId) {
        await loadCallDetails(pendingCallId);
    }
    
    if (callId) {
        document.getElementById('callIdInput').value = callId;
        if (autoConnect) {
            setTimeout(connect, 500);
        }
    }
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
});

// Load call details from database
async function loadCallDetails(pendingCallId) {
    try {
        showLoading('Loading call details...');
        
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
        document.getElementById('callInfoPanel').classList.add('has-data');
        
        // Check for active session
        const { data: sessions } = await supabase
            .from('call_sessions')
            .select('*')
            .eq('pending_call_id', pendingCallId)
            .eq('call_status', 'active')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (sessions && sessions.length > 0) {
            const callId = sessions[0].call_id;
            document.getElementById('callIdInput').value = callId;
            showInfo(`Found active call session: ${callId}`);
        } else {
            // Check for most recent completed session
            const { data: recentSessions } = await supabase
                .from('call_sessions')
                .select('*')
                .eq('pending_call_id', pendingCallId)
                .order('created_at', { ascending: false })
                .limit(1);
            
            if (recentSessions && recentSessions.length > 0) {
                const callId = recentSessions[0].call_id;
                document.getElementById('callIdInput').value = callId;
                showInfo(`Found recent call session: ${callId} (${recentSessions[0].call_status})`);
            }
        }
        
        hideLoading();
        
    } catch (error) {
        console.error('Error loading call details:', error);
        showError('Failed to load call details: ' + error.message);
        hideLoading();
    }
}

// WebSocket connection management
function toggleConnection() {
    if (isConnected) {
        disconnect();
    } else {
        connect();
    }
}

function connect() {
    if (!currentUser) {
        showError('Please log in first');
        return;
    }
    
    const callId = document.getElementById('callIdInput').value.trim();
    
    if (!callId) {
        showError('Please enter a Call SID');
        return;
    }
    
    if (!config || !config.wsUrl) {
        showError('WebSocket URL not configured');
        return;
    }
    
    updateStatus('connecting');
    connectionAttempts++;
    
    // Clear existing content
    clearContent();
    addEvent('Connecting to monitor...', '🔄', 'event-info');
    
    // Build WebSocket URL with authentication
    const wsUrl = `${config.wsUrl}?callId=${callId}&token=${encodeURIComponent(currentUser.access_token)}`;
    console.log('Connecting to:', wsUrl.replace(currentUser.access_token, '[TOKEN]'));
    
    try {
        ws = new WebSocket(wsUrl);
        
        // Set connection timeout
        const connectionTimeout = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.CONNECTING) {
                ws.close();
                handleConnectionError('Connection timeout');
            }
        }, 10000); // 10 second timeout
        
        ws.onopen = () => {
            clearTimeout(connectionTimeout);
            console.log('Connected to monitor');
            isConnected = true;
            connectionAttempts = 0;
            updateStatus('connected');
            document.getElementById('connectBtn').textContent = 'Disconnect';
            document.getElementById('callIdDisplay').textContent = callId;
            document.getElementById('callInfo').style.display = 'block';
            addEvent('Connected! Loading data...', '✅', 'event-audio');
            
            // Send heartbeat every 30 seconds
            startHeartbeat();
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
                addEvent(`Parse error: ${error.message}`, '⚠️', 'event-error');
            }
        };
        
        ws.onerror = (error) => {
            clearTimeout(connectionTimeout);
            console.error('WebSocket error:', error);
            handleConnectionError('Connection error - check console');
        };
        
        ws.onclose = (event) => {
            clearTimeout(connectionTimeout);
            stopHeartbeat();
            console.log('Disconnected from monitor', event);
            isConnected = false;
            updateStatus('disconnected');
            document.getElementById('connectBtn').textContent = 'Connect';
            document.getElementById('callInfo').style.display = 'none';
            stopAudioVisualizer();
            
            if (event.code !== 1000 && event.code !== 1005) {
                addEvent(`Disconnected (code: ${event.code})`, '📡', 'event-error');
                
                // Auto-reconnect for unexpected disconnections
                if (connectionAttempts < maxConnectionAttempts) {
                    addEvent(`Attempting to reconnect... (${connectionAttempts}/${maxConnectionAttempts})`, '🔄', 'event-info');
                    setTimeout(connect, 2000 * connectionAttempts); // Exponential backoff
                } else {
                    addEvent('Max reconnection attempts reached', '❌', 'event-error');
                }
            } else {
                addEvent('Disconnected', '📡', 'event-info');
            }
        };
    } catch (error) {
        console.error('Failed to connect:', error);
        handleConnectionError(`Connection failed: ${error.message}`);
    }
}

function disconnect() {
    if (ws) {
        ws.close(1000, 'User disconnected'); // Normal closure
        ws = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    stopHeartbeat();
    audioEnabled = false;
    audioQueue = [];
    isPlaying = false;
    connectionAttempts = 0;
}

function handleConnectionError(message) {
    updateStatus('disconnected');
    addEvent(message, '❌', 'event-error');
}

let heartbeatInterval;

function startHeartbeat() {
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
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

// Message handling
function handleMessage(data) {
    console.log('Received message:', data.type, data);
    
    switch(data.type) {
        case 'connected':
            addEvent('Connected to call monitor', '🔗', 'event-audio');
            break;
            
        case 'transcript':
            addTranscript(data.text, data.source, data.historical, data.timestamp);
            break;
            
        case 'classification':
            addClassification(data.classification, data.confidence, data.historical, data.timestamp);
            break;
            
        case 'ivr_action':
            addIVRAction(data.action_type, data.action_value, data.historical, data.timestamp);
            break;
            
        case 'call_context':
            updateCallContext(data);
            break;
            
        case 'call_state':
            updateCallState(data);
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
            
        case 'info':
            addEvent(data.message || 'Information', 'ℹ️', 'event-info');
            break;
            
        case 'error':
            const errorMsg = data.message || data.error || 'Unknown error';
            addEvent(`Error: ${errorMsg}`, '⚠️', 'event-error');
            break;
            
        case 'pong':
            // Heartbeat response - no action needed
            break;
            
        default:
            console.warn('Unknown message type:', data.type);
    }
}

// UI update functions
function addTranscript(text, source, isHistorical = false, timestamp = null) {
    source = source || 'unknown';
    const container = document.getElementById('transcripts');
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const item = document.createElement('div');
    item.className = 'transcript-item';
    if (isHistorical) {
        item.classList.add('historical');
    }
    
    let timeDisplay;
    if (timestamp) {
        timeDisplay = new Date(timestamp).toLocaleTimeString();
    } else {
        timeDisplay = new Date().toLocaleTimeString();
    }
    
    const statusText = isHistorical ? 
        `${source.toUpperCase()} • ${timeDisplay}` : 
        `${source.toUpperCase()} • ${timeDisplay} (LIVE)`;
    
    item.innerHTML = `
        <div class="source">
            ${statusText}
            ${isHistorical ? '<span class="historical-badge">📜</span>' : ''}
        </div>
        <div class="text">${escapeHtml(text)}</div>
    `;
    
    // Add historical items in chronological order (bottom)
    // Add real-time items at the top
    if (isHistorical) {
        container.appendChild(item);
    } else {
        const firstNonHistorical = container.querySelector('.transcript-item:not(.historical)');
        if (firstNonHistorical) {
            container.insertBefore(item, firstNonHistorical);
        } else {
            container.insertBefore(item, container.firstChild);
        }
    }
    
    // Keep reasonable limit
    while (container.children.length > 100) {
        const oldestHistorical = container.querySelector('.transcript-item.historical');
        if (oldestHistorical) {
            oldestHistorical.remove();
        } else {
            container.removeChild(container.lastChild);
        }
    }
    
    // Auto-scroll if user is near the bottom
    if (!isHistorical && isNearBottom(container)) {
        scrollToBottom(container);
    }
}

function addEvent(text, icon, className, isHistorical = false, timestamp = null) {
    const container = document.getElementById('events');
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const item = document.createElement('div');
    item.className = 'event-item';
    if (isHistorical) {
        item.classList.add('historical');
    }
    
    let timeDisplay;
    if (timestamp) {
        timeDisplay = new Date(timestamp).toLocaleTimeString();
    } else if (isHistorical) {
        timeDisplay = 'Historical';
    } else {
        timeDisplay = new Date().toLocaleTimeString();
    }
    
    item.innerHTML = `
        <div class="event-icon ${className}">${icon}</div>
        <div class="event-details">
            <div>${escapeHtml(text)}</div>
            <div class="event-time">
                ${timeDisplay}
                ${isHistorical ? '<span class="historical-badge">📜</span>' : ''}
            </div>
        </div>
    `;
    
    // Add historical items in chronological order (bottom)
    // Add real-time items at the top
    if (isHistorical) {
        container.appendChild(item);
    } else {
        const firstNonHistorical = container.querySelector('.event-item:not(.historical)');
        if (firstNonHistorical) {
            container.insertBefore(item, firstNonHistorical);
        } else {
            container.insertBefore(item, container.firstChild);
        }
    }
    
    // Keep reasonable limit
    while (container.children.length > 50) {
        const oldestHistorical = container.querySelector('.event-item.historical');
        if (oldestHistorical) {
            oldestHistorical.remove();
        } else {
            container.removeChild(container.lastChild);
        }
    }
    
    // Auto-scroll if user is near the bottom
    if (!isHistorical && isNearBottom(container)) {
        scrollToBottom(container);
    }
}

function addClassification(classification, confidence, isHistorical = false, timestamp = null) {
    const confidencePercent = confidence ? Math.round(confidence * 100) : 100;
    addEvent(
        `Classification: ${classification} (${confidencePercent}% confidence)`,
        '🎯',
        'event-classification',
        isHistorical,
        timestamp
    );
}

function addIVRAction(actionType, actionValue, isHistorical = false, timestamp = null) {
    let text = '';
    let icon = '⚡';
    
    if (actionType === 'dtmf') {
        text = `Pressed: ${actionValue}`;
        icon = '🔢';
    } else if (actionType === 'speech') {
        text = `Said: "${actionValue}"`;
        icon = '🗣️';
    } else if (actionType === 'transfer') {
        text = 'Transfer detected - connecting VAPI';
        icon = '📞';
    } else {
        text = `Action: ${actionType} - ${actionValue}`;
    }
    
    addEvent(text, icon, 'event-action', isHistorical, timestamp);
}

function updateCallContext(data) {
    if (data.pending_call) {
        const pc = data.pending_call;
        document.getElementById('infoEmployee').textContent = pc.employee_name || '-';
        document.getElementById('infoClinic').textContent = pc.clinic_name || '-';
        document.getElementById('infoPhone').textContent = pc.phone || '-';
        document.getElementById('infoAppointment').textContent = 
            pc.appointment_time ? new Date(pc.appointment_time).toLocaleString() : '-';
        document.getElementById('infoWorkflow').textContent = pc.workflow_state || '-';
        
        document.getElementById('callInfoPanel').style.display = 'block';
        document.getElementById('callInfoPanel').classList.add('has-data');
        
        addEvent(`Employee: ${pc.employee_name || 'Unknown'}`, '👤', 'event-info', true);
        addEvent(`Clinic: ${pc.clinic_name || 'Unknown'}`, '🏥', 'event-info', true);
        
        if (pc.success_evaluation) {
            addEvent(`Result: ${pc.success_evaluation}`, '📋', 'event-info', true);
        }
    }
    
    if (data.session) {
        addEvent(`Call Status: ${data.session.call_status || 'active'}`, 'ℹ️', 'event-info', true);
        if (data.session.classification) {
            addEvent(
                `System Type: ${data.session.classification}`, 
                '🏥', 
                'event-classification', 
                true
            );
        }
    }
}

function updateCallState(data) {
    const statusText = data.active ? 
        'Call is currently active' : 
        'Call is not currently active';
    
    addEvent(statusText, data.active ? '🟢' : '🔴', 'event-info');
    
    if (data.state && data.active) {
        const duration = Math.round(data.state.duration / 1000);
        const transcripts = data.state.stats?.transcriptsProcessed || 0;
        addEvent(
            `Duration: ${duration}s | Transcripts: ${transcripts}`,
            '📊',
            'event-info'
        );
    }
}

function clearContent() {
    const transcriptsContainer = document.getElementById('transcripts');
    const eventsContainer = document.getElementById('events');
    
    transcriptsContainer.innerHTML = '<div class="empty-state loading"><p>Loading transcripts...</p></div>';
    eventsContainer.innerHTML = '<div class="empty-state loading"><p>Loading events...</p></div>';
}

// Audio handling functions
async function toggleAudio() {
    const button = document.getElementById('audioToggle');
    const status = document.getElementById('audioStatus');
    
    if (!audioEnabled) {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 8000
                });
            }
            
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            
            audioEnabled = true;
            button.textContent = 'Disable Audio';
            status.textContent = 'Audio: Enabled';
            addEvent('Audio enabled', '🔊', 'event-audio');
            processAudioQueue();
        } catch (error) {
            console.error('Failed to enable audio:', error);
            showError('Failed to enable audio. Please check your browser permissions.');
        }
    } else {
        audioEnabled = false;
        button.textContent = 'Enable Audio';
        status.textContent = 'Audio: Disabled';
        audioQueue = [];
        stopAudioVisualizer();
        addEvent('Audio disabled', '🔇', 'event-audio');
    }
}

function setVolume(value) {
    currentVolume = value / 100;
    document.getElementById('volumeValue').textContent = `${value}%`;
}

function handleAudioData(base64Audio) {
    if (!audioEnabled) return;
    
    try {
        const visualizer = document.getElementById('audioVisualizer');
        if (visualizer.style.display === 'none') {
            visualizer.style.display = 'flex';
            startAudioVisualizer();
        }
        
        // Decode base64 to binary
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Convert mulaw to PCM
        const pcmData = mulawToPCM(bytes);
        audioQueue.push(pcmData);
        
        if (!isPlaying) {
            processAudioQueue();
        }
    } catch (error) {
        console.error('Error handling audio data:', error);
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
        
        try {
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
        } catch (error) {
            console.error('Error playing audio:', error);
        }
    }
    
    isPlaying = false;
}

function startAudioVisualizer() {
    const visualizer = document.getElementById('audioVisualizer');
    visualizer.innerHTML = '';
    
    // Create visualizer bars
    for (let i = 0; i < 30; i++) {
        const bar = document.createElement('div');
        bar.className = 'audio-bar';
        bar.style.height = '5px';
        visualizer.appendChild(bar);
    }
    
    // Animate bars
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
    const visualizer = document.getElementById('audioVisualizer');
    if (visualizer) {
        visualizer.style.display = 'none';
    }
}

// Utility functions
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function isNearBottom(element) {
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 50;
}

function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight;
}

function showError(message) {
    addEvent(message, '❌', 'event-error');
}

function showInfo(message) {
    addEvent(message, 'ℹ️', 'event-info');
}

function showLoading(message) {
    const loadingEl = document.createElement('div');
    loadingEl.id = 'loadingIndicator';
    loadingEl.className = 'loading-indicator';
    loadingEl.textContent = message;
    document.body.appendChild(loadingEl);
}

function hideLoading() {
    const loadingEl = document.getElementById('loadingIndicator');
    if (loadingEl) {
        loadingEl.remove();
    }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Only when not typing in input fields
        if (e.target.tagName === 'INPUT') return;
        
        switch(e.key) {
            case ' ': // Space bar - toggle connection
                e.preventDefault();
                toggleConnection();
                break;
            case 'a': // 'a' - toggle audio
            case 'A':
                toggleAudio();
                break;
            case 'c': // 'c' - clear content
            case 'C':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    clearContent();
                    showInfo('Content cleared');
                }
                break;
            case 'r': // 'r' - refresh/reconnect
            case 'R':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (isConnected) {
                        disconnect();
                        setTimeout(connect, 500);
                    }
                }
                break;
        }
    });
}

// Navigation functions
function goToDashboard() {
    disconnect();
    window.location.href = '/dashboard.html';
}

async function logout() {
    disconnect();
    await supabase.auth.signOut();
    window.location.href = '/login.html';
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    disconnect();
});

// Export functions for global access
window.toggleConnection = toggleConnection;
window.toggleAudio = toggleAudio;
window.setVolume = setVolume;
window.goToDashboard = goToDashboard;
window.logout = logout;
