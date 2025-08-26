// public/scripts/call-monitor.js
// Handles WebSocket connection and real-time call monitoring

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

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    await loadConfig(); // From config.js
    
    if (!supabase) {
        alert('Failed to initialize. Please refresh.');
        return;
    }
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    
    currentUser = user;
    document.getElementById('userEmail').textContent = user.email;
    
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
});

// Load call details from database
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
        alert('Please log in first');
        return;
    }
    
    const callId = document.getElementById('callIdInput').value.trim();
    
    if (!callId) {
        alert('Please enter a Call SID');
        return;
    }
    
    if (!config || !config.wsUrl) {
        alert('WebSocket URL not configured');
        return;
    }
    
    updateStatus('connecting');
    
    // Build WebSocket URL with authentication
    const wsUrl = `${config.wsUrl}?callId=${callId}&token=${currentUser.access_token}`;
    
    try {
        ws = new WebSocket(wsUrl);
        
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
            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateStatus('disconnected');
            alert('Connection error. Please check your connection and try again.');
        };
        
        ws.onclose = () => {
            console.log('Disconnected from monitor');
            isConnected = false;
            updateStatus('disconnected');
            document.getElementById('connectBtn').textContent = 'Connect';
            document.getElementById('callInfo').style.display = 'none';
            stopAudioVisualizer();
        };
    } catch (error) {
        console.error('Failed to connect:', error);
        updateStatus('disconnected');
        alert('Failed to connect to monitor');
    }
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
    audioEnabled = false;
    audioQueue = [];
    isPlaying = false;
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
function addTranscript(text, source) {
    source = source || 'unknown';
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
    
    // Keep only last 10 items
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
    
    // Keep only last 10 items
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
        text = 'Transfer detected - connecting VAPI';
    } else {
        text = `Action: ${actionType} - ${actionValue}`;
    }
    
    addEvent(text, '⚡', 'event-action');
}

function clearContent() {
    document.getElementById('transcripts').innerHTML = '<div class="empty-state"><p>Waiting for transcripts...</p></div>';
    document.getElementById('events').innerHTML = '<div class="empty-state"><p>Waiting for events...</p></div>';
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
            
            audioEnabled = true;
            button.textContent = 'Disable Audio';
            status.textContent = 'Audio: Enabled';
            processAudioQueue();
        } catch (error) {
            console.error('Failed to enable audio:', error);
            alert('Failed to enable audio. Please check your browser permissions.');
        }
    } else {
        audioEnabled = false;
        button.textContent = 'Enable Audio';
        status.textContent = 'Audio: Disabled';
        audioQueue = [];
        stopAudioVisualizer();
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
