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
let realtimeChannel = null;
let callSessionsChannel = null;
let classificationsChannel = null;
let ivrEventsChannel = null;
let currentSelectedSessionId = null;
let currentSelectedSessionCallId = null;

// Helper function to get URL parameters
function getUrlParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

// Function to dynamically adjust flyout positioning based on actual top bar height
function adjustFlyoutPosition() {
    const topBar = document.querySelector('.top-bar');
    const detailsPanel = document.getElementById('detailsPanel');
    
    if (topBar && detailsPanel) {
        const topBarHeight = topBar.offsetHeight;
        detailsPanel.style.top = `${topBarHeight}px`;
        detailsPanel.style.height = `calc(100vh - ${topBarHeight}px)`;
    }
}

// Helper function to format phone number
function formatPhoneNumber(phone) {
    if (!phone) return '-';
    // Remove all non-numeric characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        // Handle 1-XXX-XXX-XXXX format
        return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone; // Return original if can't format
}

// Helper function to format structured data for display
function formatStructuredData(data) {
    if (!data || typeof data !== 'object') return '';
    
    let html = '<div class="structured-items">';
    
    // Process each key-value pair
    for (const [key, value] of Object.entries(data)) {
        // Skip task_type since it's already displayed above
        if (key === 'task_type') continue;
        
        // Format the key to be more readable
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        // Format the value
        let formattedValue = value;
        if (value === null || value === undefined) {
            formattedValue = '-';
        } else if (typeof value === 'object') {
            formattedValue = JSON.stringify(value, null, 2);
        } else if (typeof value === 'boolean') {
            formattedValue = value ? 'Yes' : 'No';
        }
        
        html += `
            <div class="structured-item">
                <span class="structured-label">${formattedKey}:</span>
                <span class="structured-value">${formattedValue}</span>
            </div>
        `;
    }
    
    html += '</div>';
    return html;
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    await loadConfig(); // From config.js
    
    // Adjust flyout positioning based on actual top bar height
    adjustFlyoutPosition();
    
    // Also adjust on window resize
    window.addEventListener('resize', adjustFlyoutPosition);
    
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
    
    // Setup realtime subscriptions if we have a pending call
    if (pendingCallId) {
        setupRealtimeSubscriptions(pendingCallId);
    }
});

// Load call details from database
async function loadCallDetails(pendingCallId) {
    try {
        showLoading('Loading call details...');
        
        // Load pending call with its call sessions, classifications, and IVR events
        const { data: pendingCall, error } = await supabase
            .from('pending_calls')
            .select(`
                *,
                call_sessions (
                    *,
                    call_classifications (
                        *
                    )
                )
            `)
            .eq('id', pendingCallId)
            .single();
        
        if (error) throw error;
        
        currentPendingCall = pendingCall;
        
        // Display call info
        document.getElementById('infoEmployee').textContent = pendingCall.employee_name || '-';
        document.getElementById('infoClinic').textContent = pendingCall.clinic_name || '-';
        document.getElementById('infoPhone').textContent = formatPhoneNumber(pendingCall.phone);
        document.getElementById('infoAppointment').textContent = 
            pendingCall.appointment_time ? 
            new Date(pendingCall.appointment_time).toLocaleString() : '-';
        
        // Display task with badge styling
        const taskBadge = document.querySelector('#infoTask .task-type-badge');
        if (taskBadge) {
            taskBadge.textContent = pendingCall.task_type || 'records_request';
        }
        
        // Display workflow state with badge
        const workflowElement = document.getElementById('infoWorkflow');
        workflowElement.innerHTML = `<span class="workflow-badge workflow-${pendingCall.workflow_state || 'pending'}">${pendingCall.workflow_state || '-'}</span>`;
        
        document.getElementById('infoSuccessEval').textContent = pendingCall.success_evaluation || '-';
        
        // Display combined summary and structured data
        if (pendingCall.summary || pendingCall.structured_data) {
            document.getElementById('callDetailsSection').style.display = 'block';
            
            // Display summary
            if (pendingCall.summary) {
                document.getElementById('infoSummary').innerHTML = `<p>${pendingCall.summary}</p>`;
            } else {
                document.getElementById('infoSummary').innerHTML = '';
            }
            
            // Display structured data in formatted way
            if (pendingCall.structured_data) {
                document.getElementById('structuredDataDisplay').innerHTML = formatStructuredData(pendingCall.structured_data);
            } else {
                document.getElementById('structuredDataDisplay').innerHTML = '';
            }
        }
        
        document.getElementById('callInfoPanel').style.display = 'block';
        document.getElementById('callInfoPanel').classList.add('has-data');
        
        // Sort call sessions by newest to oldest
        if (pendingCall.call_sessions) {
            pendingCall.call_sessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        
        // Display call sessions and classifications
        await displayCallClassifications(pendingCall);
        
        // Set up call ID input with active or most recent session (if the input exists)
        const callIdInput = document.getElementById('callIdInput');
        if (callIdInput) {
            const activeSessions = pendingCall.call_sessions?.filter(s => s.call_status === 'active') || [];
            if (activeSessions.length > 0) {
                const callId = activeSessions[0].call_id;
                callIdInput.value = callId;
                showInfo(`Found active call session: ${callId}`);
            } else if (pendingCall.call_sessions?.length > 0) {
                const recentSession = pendingCall.call_sessions[0]; // Most recent
                callIdInput.value = recentSession.call_id;
                showInfo(`Found recent call session: ${recentSession.call_id} (${recentSession.call_status})`);
            }
        }
        
        hideLoading();
        
    } catch (error) {
        console.error('Error loading call details:', error);
        showError('Failed to load call details: ' + error.message);
        hideLoading();
    }
}

// Helper function to refresh the details panel if a session is selected
function refreshSelectedSessionDetails() {
    if (currentSelectedSessionId && window.currentSessions) {
        const updatedSession = window.currentSessions.find(s => s.id === currentSelectedSessionId);
        if (updatedSession) {
            console.log('🔄 Refreshing details panel for session:', currentSelectedSessionId);
            // Update the call_id tracking in case it changed
            currentSelectedSessionCallId = updatedSession.call_id;
            showSessionDetails(updatedSession);
            
            // Re-highlight the selected row
            const selectedRow = document.querySelector(`tr[data-session-id="${currentSelectedSessionId}"]`);
            if (selectedRow) {
                selectedRow.classList.add('selected');
            }
        }
    }
}

// Update connection status indicator
function updateConnectionStatus(status) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (!statusDot || !statusText) return;
    
    if (status === 'connected') {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Live Updates';
    } else if (status === 'disconnected') {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
    } else {
        statusDot.classList.remove('connected', 'disconnected');
        statusText.textContent = 'Connecting...';
    }
}

// Setup realtime subscriptions for pending call and call sessions
function setupRealtimeSubscriptions(pendingCallId) {
    console.log('🚀 Setting up realtime subscriptions for pending call:', pendingCallId);
    
    // CRITICAL: Remove ALL existing channels to avoid conflicts
    const allChannels = supabase.getChannels();
    console.log(`Found ${allChannels.length} existing channels`);
    allChannels.forEach(channel => {
        console.log(`Removing channel: ${channel.topic}`);
        supabase.removeChannel(channel);
    });
    
    // Reset our channel references
    realtimeChannel = null;
    callSessionsChannel = null;
    classificationsChannel = null;
    ivrEventsChannel = null;
    
    // Force reconnect the realtime connection
    if (supabase.realtime) {
        console.log('Disconnecting existing realtime connection...');
        supabase.realtime.disconnect();
        
        // Small delay to ensure disconnection
        setTimeout(() => {
            console.log('Reconnecting realtime...');
            supabase.realtime.connect();
            
            // Create subscriptions after reconnection
            setTimeout(() => {
                createMonitorSubscriptions(pendingCallId);
            }, 500);
        }, 500);
    } else {
        createMonitorSubscriptions(pendingCallId);
    }
}

// Create the actual subscriptions
function createMonitorSubscriptions(pendingCallId) {
    console.log('Creating monitor subscriptions for pending call:', pendingCallId);
    
    // Subscribe to pending_calls updates
    realtimeChannel = supabase
        .channel(`pending-call-${pendingCallId}`)
        .on('postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'pending_calls',
                filter: `id=eq.${pendingCallId}`
            },
            (payload) => {
                console.log('🔔 Realtime pending call update received!');
                console.log('Event type:', payload.eventType);
                console.log('Old:', payload.old);
                console.log('New:', payload.new);
                handlePendingCallUpdate(payload.new);
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.error('Realtime subscription error:', error.message);
                updateConnectionStatus('disconnected');
            } else {
                console.log(`Pending calls subscription status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    console.log('✅ Realtime subscription active for pending calls');
                    updateConnectionStatus('connected');
                    
                    // Log final state
                    const channels = supabase.getChannels();
                    console.log(`Active channels after setup: ${channels.length}`);
                    channels.forEach(ch => {
                        console.log(`- ${ch.topic}: ${ch.state}`);
                    });
                }
            }
        });
    
    // Subscribe to call_sessions updates for this pending call
    callSessionsChannel = supabase
        .channel(`call-sessions-${pendingCallId}`)
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'call_sessions',
                filter: `pending_call_id=eq.${pendingCallId}`
            },
            (payload) => {
                console.log('🔔 Realtime call session update received!');
                console.log('Event type:', payload.eventType);
                console.log('Payload:', payload);
                handleCallSessionUpdate(payload);
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.error('Call sessions subscription error:', error);
            } else {
                console.log('Call sessions subscription status:', status);
            }
        });
    
    // Subscribe to call_classifications updates
    // This will catch any classification updates for sessions related to this pending call
    classificationsChannel = supabase
        .channel(`classifications-${pendingCallId}`)
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'call_classifications'
            },
            async (payload) => {
                console.log('🔔 Realtime call classification update received!');
                console.log('Event type:', payload.eventType);
                console.log('Payload:', payload);
                // Check if this classification belongs to a session of our pending call
                if (payload.new && payload.new.session_id) {
                    // Store the currently selected session ID before reloading
                    const wasSelectedSessionId = currentSelectedSessionId;
                    
                    // Reload the call details to get fresh data
                    if (currentPendingCall) {
                        await loadCallDetails(currentPendingCall.id);
                        
                        // If there was a selected session, reopen it after reload
                        if (wasSelectedSessionId) {
                            currentSelectedSessionId = wasSelectedSessionId;
                            // Wait for the data to be loaded, then refresh the details panel
                            setTimeout(refreshSelectedSessionDetails, 100);
                        }
                    }
                }
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.error('Classifications subscription error:', error);
            } else {
                console.log('Classifications subscription status:', status);
            }
        });
    
    // Subscribe to ivr_events updates
    // This will catch any IVR event updates for sessions related to this pending call
    ivrEventsChannel = supabase
        .channel(`ivr-events-${pendingCallId}`)
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'ivr_events'
            },
            async (payload) => {
                console.log('🔔 Realtime IVR event update received!');
                console.log('Event type:', payload.eventType);
                console.log('Payload:', payload);
                
                // Get the relevant call_id based on event type
                let eventCallId = null;
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    eventCallId = payload.new?.call_id;
                } else if (payload.eventType === 'DELETE') {
                    eventCallId = payload.old?.call_id;
                }
                
                // Check if this event belongs to the currently selected session
                if (currentSelectedSessionCallId && eventCallId && 
                    eventCallId === currentSelectedSessionCallId) {
                    console.log('📌 IVR event is for currently selected session');
                    console.log(`Event type: ${payload.eventType}, Call ID: ${eventCallId}`);
                    
                    // Refresh just the IVR events section
                    const selectedSession = window.currentSessions?.find(s => s.id === currentSelectedSessionId);
                    if (selectedSession) {
                        if (selectedSession.call_classifications) {
                            await loadIvrEventsForDetail(selectedSession.call_classifications, selectedSession);
                        } else {
                            await loadIvrEventsForSessionDetail(selectedSession);
                        }
                    }
                }
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.error('IVR events subscription error:', error);
            } else {
                console.log('IVR events subscription status:', status);
            }
        });
}

// Handle pending call updates
async function handlePendingCallUpdate(updatedPendingCall) {
    console.log('Handling pending call update:', updatedPendingCall);
    
    // Update the displayed info - using correct field names matching the database columns
    document.getElementById('infoEmployee').textContent = updatedPendingCall.employee_name || '-';
    document.getElementById('infoClinic').textContent = updatedPendingCall.clinic_name || '-';
    document.getElementById('infoPhone').textContent = formatPhoneNumber(updatedPendingCall.phone);
    document.getElementById('infoAppointment').textContent = updatedPendingCall.appointment_time ?
        new Date(updatedPendingCall.appointment_time).toLocaleString() : '-';
    
    // Update task with badge styling
    const taskBadge = document.querySelector('#infoTask .task-type-badge');
    if (taskBadge) {
        taskBadge.textContent = updatedPendingCall.task_type || 'records_request';
    }
    
    // Update workflow state with badge
    const workflowElement = document.getElementById('infoWorkflow');
    workflowElement.innerHTML = `<span class="workflow-badge workflow-${updatedPendingCall.workflow_state || 'pending'}">${updatedPendingCall.workflow_state || '-'}</span>`;
    
    // Update success evaluation
    document.getElementById('infoSuccessEval').textContent = updatedPendingCall.success_evaluation || '-';
    
    // Update combined summary and structured data
    if (updatedPendingCall.summary || updatedPendingCall.structured_data) {
        document.getElementById('callDetailsSection').style.display = 'block';
        
        // Update summary
        if (updatedPendingCall.summary) {
            document.getElementById('infoSummary').innerHTML = `<p>${updatedPendingCall.summary}</p>`;
        }
        
        // Update structured data in formatted way
        if (updatedPendingCall.structured_data) {
            document.getElementById('structuredDataDisplay').innerHTML = formatStructuredData(updatedPendingCall.structured_data);
        }
    }
    
    // Update the current pending call object
    if (currentPendingCall) {
        currentPendingCall = { ...currentPendingCall, ...updatedPendingCall };
    }
    
    // Add visual feedback for the update
    const callInfoPanel = document.getElementById('callInfoPanel');
    if (callInfoPanel) {
        callInfoPanel.classList.add('info-updated');
        setTimeout(() => {
            callInfoPanel.classList.remove('info-updated');
        }, 1500);
    }
}

// Handle call session updates
async function handleCallSessionUpdate(payload) {
    console.log('Handling call session update:', payload);
    
    // Store the currently selected session ID before reloading
    const wasSelectedSessionId = currentSelectedSessionId;
    
    // Reload the entire call details to get fresh data with relationships
    if (currentPendingCall) {
        await loadCallDetails(currentPendingCall.id);
        
        // If there was a selected session, reopen it after reload
        if (wasSelectedSessionId) {
            currentSelectedSessionId = wasSelectedSessionId;
            // Find and update the call_id
            const reloadedSession = window.currentSessions?.find(s => s.id === wasSelectedSessionId);
            if (reloadedSession) {
                currentSelectedSessionCallId = reloadedSession.call_id;
            }
            // Wait for the data to be loaded, then refresh the details panel
            setTimeout(refreshSelectedSessionDetails, 100);
        }
    }
}

// Display call sessions in a table format
// Store previous session states for status change detection
let previousSessionStates = {};

async function displayCallClassifications(pendingCall) {
    const tableBody = document.getElementById('sessionsTableBody');
    
    if (!pendingCall.call_sessions || pendingCall.call_sessions.length === 0) {
        tableBody.innerHTML = '<tr class="empty-state"><td colspan="4">No call sessions found for this pending call.</td></tr>';
        return;
    }
    
    // Store sessions globally for detail view
    window.currentSessions = pendingCall.call_sessions;
    
    let html = '';
    
    for (const session of pendingCall.call_sessions) {
        const createdDate = new Date(session.created_at);
        const dateStr = createdDate.toLocaleDateString();
        const timeStr = createdDate.toLocaleTimeString();
        
        // Get confidence score from classification if exists
        let confidenceHtml = '-';
        if (session.call_classifications?.classification_confidence) {
            const confidence = session.call_classifications.classification_confidence * 100;
            const confidenceClass = confidence >= 80 ? 'high' : confidence >= 50 ? 'medium' : 'low';
            confidenceHtml = `<span class="confidence-badge confidence-${confidenceClass}">${confidence.toFixed(1)}%</span>`;
        } else if (session.ivr_confidence_score) {
            const confidence = session.ivr_confidence_score * 100;
            const confidenceClass = confidence >= 80 ? 'high' : confidence >= 50 ? 'medium' : 'low';
            confidenceHtml = `<span class="confidence-badge confidence-${confidenceClass}">${confidence.toFixed(1)}%</span>`;
        }
        
        // Check if status changed to 'Calling' to trigger animation
        const previousState = previousSessionStates[session.id];
        const hasStatusChanged = previousState && 
            previousState.call_status !== session.call_status && 
            session.call_status === 'Calling';
        
        // Add calling-active class for animation if status is 'Calling'
        const callingClass = session.call_status === 'Calling' ? ' calling-active' : '';
        
        html += `
            <tr data-session-id="${session.id}" class="${hasStatusChanged ? 'status-changed' : ''}${callingClass}" onclick="selectSession('${session.id}')">
                <td>${dateStr} ${timeStr}</td>
                <td>${session.ivr_detection_state || '-'}</td>
                <td>${confidenceHtml}</td>
                <td><span class="session-status status-${session.call_status}">${session.call_status}</span></td>
            </tr>
        `;
        
        // Update previous state
        previousSessionStates[session.id] = {
            call_status: session.call_status,
            last_updated: new Date()
        };
    }
    
    tableBody.innerHTML = html;
    
    // Trigger flash animation for newly changed to 'Calling' status
    const changedRows = document.querySelectorAll('.sessions-table tbody tr.status-changed');
    changedRows.forEach(row => {
        // Remove the status-changed class after a brief delay
        setTimeout(() => {
            row.classList.remove('status-changed');
        }, 100);
    });
}

// Handle session selection and show details
function selectSession(sessionId) {
    // Remove previous selection
    document.querySelectorAll('.sessions-table tbody tr').forEach(row => {
        row.classList.remove('selected');
    });
    
    // Add selection to clicked row
    const selectedRow = document.querySelector(`tr[data-session-id="${sessionId}"]`);
    if (selectedRow) {
        selectedRow.classList.add('selected');
    }
    
    // Find the session data
    const session = window.currentSessions?.find(s => s.id === sessionId);
    if (!session) return;
    
    // Track the currently selected session and its call_id
    currentSelectedSessionId = sessionId;
    currentSelectedSessionCallId = session.call_id;
    
    // Open the details panel
    const detailsPanel = document.getElementById('detailsPanel');
    detailsPanel.classList.add('open');
    
    // Populate the details
    showSessionDetails(session);
}

// Format workflow metadata into a structured UI with foldable section
function formatWorkflowMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return `
            <div class="session-detail-section foldable-section">
                <h4 class="foldable-header" onclick="toggleSection('workflow-metadata')">
                    <span class="fold-icon">▼</span>
                    Workflow Metadata
                </h4>
                <div class="foldable-content" id="workflow-metadata">
                    <div class="metadata-item-simple">
                        <span class="metadata-value">${metadata || 'No metadata available'}</span>
                    </div>
                </div>
            </div>
        `;
    }

    let html = `
        <div class="session-detail-section foldable-section">
            <h4 class="foldable-header" onclick="toggleSection('workflow-metadata')">
                <span class="fold-icon">▼</span>
                Workflow Metadata
            </h4>
            <div class="foldable-content" id="workflow-metadata">
                <div class="metadata-grid">
    `;

    // Iterate through the metadata object and create structured display
    for (const [key, value] of Object.entries(metadata)) {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        if (typeof value === 'object' && value !== null) {
            // Handle nested objects
            html += `
                <div class="metadata-item nested">
                    <div class="metadata-label">${formattedKey}:</div>
                    <div class="metadata-nested-content">
            `;
            
            for (const [nestedKey, nestedValue] of Object.entries(value)) {
                const formattedNestedKey = nestedKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                html += `
                    <div class="metadata-nested-item">
                        <span class="metadata-nested-label">${formattedNestedKey}:</span>
                        <span class="metadata-nested-value">${nestedValue || '-'}</span>
                    </div>
                `;
            }
            
            html += `
                    </div>
                </div>
            `;
        } else {
            // Handle simple key-value pairs
            html += `
                <div class="metadata-item">
                    <span class="metadata-label">${formattedKey}:</span>
                    <span class="metadata-value">${value || '-'}</span>
                </div>
            `;
        }
    }

    html += `
                </div>
            </div>
        </div>
    `;

    return html;
}

// Show session details in the side panel
async function showSessionDetails(session) {
    const container = document.getElementById('detailsPanelContent');
    
    let html = `
        <div class="close-panel-btn-container">
            <button class="close-panel-btn" onclick="closeDetailsPanel()">×</button>
        </div>
        <div class="session-datetime">
            <span class="session-time">${new Date(session.created_at).toLocaleString()}</span>
        </div>
        <div class="session-summary">
            <div class="session-summary-line-1">
                <span class="session-id">${session.call_id}</span>
                <span class="session-status status-${session.call_status}">${session.call_status}</span>
            </div>
            <div class="session-summary-line-2">
                <span class="session-state">${session.ivr_detection_state || '-'}</span>
            </div>
        </div>
    `;
    
    // Display workflow metadata if it exists
    if (session.workflow_metadata) {
        html += formatWorkflowMetadata(session.workflow_metadata);
    }
    
    // Display classification if it exists
    if (session.call_classifications) {
        const classification = session.call_classifications;
        html += `
            <div class="session-detail-section">
                <h4>Classification</h4>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Type:</span>
                        <span class="detail-value classification-type">${classification.classification_type || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Confidence:</span>
                        <span class="detail-value">${classification.classification_confidence ? (classification.classification_confidence * 100).toFixed(1) + '%' : '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Duration:</span>
                        <span class="detail-value">${classification.classification_duration_ms ? classification.classification_duration_ms + 'ms' : '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Expires:</span>
                        <span class="detail-value">${classification.classification_expires_at ? new Date(classification.classification_expires_at).toLocaleDateString() : '-'}</span>
                    </div>
                </div>
                
                ${classification.ivr_actions ? `
                    <div class="ivr-actions">
                        <h5>IVR Actions</h5>
                        <pre class="actions-json">${JSON.stringify(classification.ivr_actions, null, 2)}</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // Add placeholder for IVR events
    html += `
        <div class="session-detail-section">
            <div id="detailIvrEvents" class="ivr-events-section">
                <h4>Loading IVR Events...</h4>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
    
    // Load IVR events
    if (session.call_classifications) {
        await loadIvrEventsForDetail(session.call_classifications, session);
    } else {
        await loadIvrEventsForSessionDetail(session);
    }
}

// Load IVR events for the detail panel
async function loadIvrEventsForDetail(classification, session) {
    try {
        const { data: events, error } = await supabase
            .from('ivr_events')
            .select('*')
            .eq('call_id', session.call_id)
            .order('created_at', { ascending: true });
        
        const container = document.getElementById('detailIvrEvents');
        
        if (error) {
            container.innerHTML = `
                <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                    <span class="fold-icon">▼</span>
                    IVR Events
                </h4>
                <div class="foldable-content" id="ivr-events">
                    <p class="error">Error loading events: ${error.message}</p>
                </div>
            `;
            return;
        }
        
        if (!events || events.length === 0) {
            container.innerHTML = `
                <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                    <span class="fold-icon">▼</span>
                    IVR Events
                </h4>
                <div class="foldable-content" id="ivr-events">
                    <p class="empty-state">No IVR events found</p>
                </div>
            `;
            return;
        }
        
        let html = `
            <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                <span class="fold-icon">▼</span>
                IVR Events (${events.length}) <span class="realtime-indicator">🔴 LIVE</span>
            </h4>
            <div class="foldable-content" id="ivr-events">
                <div class="events-list-compact">
        `;
        
        events.forEach((event, index) => {
            const isNew = index === events.length - 1; // Mark the last event as new for visual emphasis
            // Use the same timezone and format as the session time
            const eventDate = new Date(event.created_at);
            const timestamp = eventDate.toLocaleString();
            const statusIcon = event.executed ? '✓' : '⏳';
            
            html += `
                <div class="event-item-compact ${isNew ? 'event-new' : ''}">
                    <div class="event-compact-header">
                        <span class="event-compact-time">${timestamp}</span>
                        <span class="event-compact-status ${event.executed ? 'executed' : 'pending'}">${statusIcon}</span>
                    </div>
                    <div class="event-compact-action">
                        <span class="event-action-type">${event.action_type}</span>
                        ${event.action_value ? `<span class="event-action-value">: ${event.action_value}</span>` : ''}
                    </div>
                    ${event.transcript ? `<div class="event-compact-transcript">"${event.transcript}"</div>` : ''}
                    ${event.ai_reply ? `<div class="event-compact-ai-reply">→ ${event.ai_reply}</div>` : ''}
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
        container.innerHTML = html;
        
        // Animate the LIVE indicator
        const indicator = container.querySelector('.realtime-indicator');
        if (indicator) {
            indicator.style.animation = 'pulse 1s ease-in-out';
            setTimeout(() => {
                if (indicator) indicator.style.animation = '';
            }, 1000);
        }
        
    } catch (error) {
        console.error('Error loading IVR events:', error);
        const container = document.getElementById('detailIvrEvents');
        container.innerHTML = `
            <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                <span class="fold-icon">▼</span>
                IVR Events
            </h4>
            <div class="foldable-content" id="ivr-events">
                <p class="error">Error loading events.</p>
            </div>
        `;
    }
}

// Load IVR events for session without classification
async function loadIvrEventsForSessionDetail(session) {
    try {
        const { data: events, error } = await supabase
            .from('ivr_events')
            .select('*')
            .eq('call_id', session.call_id)
            .order('created_at', { ascending: true });
        
        const container = document.getElementById('detailIvrEvents');
        
        if (error) {
            container.innerHTML = `
                <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                    <span class="fold-icon">▼</span>
                    IVR Events
                </h4>
                <div class="foldable-content" id="ivr-events">
                    <p class="error">Error loading events: ${error.message}</p>
                </div>
            `;
            return;
        }
        
        if (!events || events.length === 0) {
            container.innerHTML = `
                <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                    <span class="fold-icon">▼</span>
                    IVR Events
                </h4>
                <div class="foldable-content" id="ivr-events">
                    <p class="empty-state">No IVR events found</p>
                </div>
            `;
            return;
        }
        
        let html = `
            <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                <span class="fold-icon">▼</span>
                IVR Events (${events.length}) <span class="realtime-indicator">🔴 LIVE</span>
            </h4>
            <div class="foldable-content" id="ivr-events">
                <div class="events-list-compact">
        `;
        
        events.forEach((event, index) => {
            const isNew = index === events.length - 1; // Mark the last event as new for visual emphasis
            // Use the same timezone and format as the session time
            const eventDate = new Date(event.created_at);
            const timestamp = eventDate.toLocaleString();
            const statusIcon = event.executed ? '✓' : '⏳';
            
            html += `
                <div class="event-item-compact ${isNew ? 'event-new' : ''}">
                    <div class="event-compact-header">
                        <span class="event-compact-time">${timestamp}</span>
                        <span class="event-compact-status ${event.executed ? 'executed' : 'pending'}">${statusIcon}</span>
                    </div>
                    <div class="event-compact-action">
                        <span class="event-action-type">${event.action_type}</span>
                        ${event.action_value ? `<span class="event-action-value">: ${event.action_value}</span>` : ''}
                    </div>
                    ${event.transcript ? `<div class="event-compact-transcript">"${event.transcript}"</div>` : ''}
                    ${event.ai_reply ? `<div class="event-compact-ai-reply">→ ${event.ai_reply}</div>` : ''}
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
        container.innerHTML = html;
        
        // Animate the LIVE indicator
        const indicator = container.querySelector('.realtime-indicator');
        if (indicator) {
            indicator.style.animation = 'pulse 1s ease-in-out';
            setTimeout(() => {
                if (indicator) indicator.style.animation = '';
            }, 1000);
        }
        
    } catch (error) {
        console.error('Error loading IVR events:', error);
        const container = document.getElementById('detailIvrEvents');
        container.innerHTML = `
            <h4 class="foldable-header" onclick="toggleSection('ivr-events')">
                <span class="fold-icon">▼</span>
                IVR Events
            </h4>
            <div class="foldable-content" id="ivr-events">
                <p class="error">Error loading events.</p>
            </div>
        `;
    }
}

// Toggle foldable sections
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    const header = section.previousElementSibling;
    const foldIcon = header.querySelector('.fold-icon');
    
    if (section.style.display === 'none') {
        section.style.display = 'block';
        foldIcon.textContent = '▼';
    } else {
        section.style.display = 'none';
        foldIcon.textContent = '▶';
    }
}

// Close the details panel
function closeDetailsPanel() {
    const detailsPanel = document.getElementById('detailsPanel');
    detailsPanel.classList.remove('open');
    
    // Clear the selected session tracking
    currentSelectedSessionId = null;
    currentSelectedSessionCallId = null;
    
    // Remove selection from table
    document.querySelectorAll('.sessions-table tbody tr').forEach(row => {
        row.classList.remove('selected');
    });
}

// Load IVR events for a specific classification
async function loadIvrEventsForClassification(classification, session) {
    try {
        console.log('Loading IVR events for classification:', classification.id);
        console.log('Using session call_id:', session.call_id);
        
        // Use direct relationship: call_sessions.call_id = ivr_events.call_id
        const { data: events, error } = await supabase
            .from('ivr_events')
            .select('*')
            .eq('call_id', session.call_id)
            .order('created_at', { ascending: true }); // Use created_at since timing_ms might not exist
        
        console.log('IVR events query result:', { events, error });
        
        const container = document.getElementById(`ivrEvents_${classification.id}`);
        
        if (error) {
            console.error('IVR events error:', error);
            container.innerHTML = '<h6>IVR Events</h6><p class="error">Error loading events: ' + error.message + '</p>';
            return;
        }
        
        if (!events || events.length === 0) {
            container.innerHTML = '<h6>IVR Events</h6><p class="empty-state">No IVR events found for call_id: ' + session.call_id + '</p>';
            return;
        }
        
        let html = '<h6>IVR Events (' + events.length + ')</h6><div class="events-list">';
        
        events.forEach(event => {
            const eventDate = new Date(event.created_at);
            const timestamp = eventDate.toLocaleString();
            html += `
                <div class="event-item">
                    <div class="event-header">
                        <span class="event-timing">${timestamp}</span>
                        <span class="event-action">${event.action_type}: ${event.action_value || '-'}</span>
                        ${event.executed ? '<span class="event-status executed">✓</span>' : '<span class="event-status pending">⏳</span>'}
                    </div>
                    ${event.transcript ? `<div class="event-transcript">"${event.transcript}"</div>` : ''}
                    ${event.ai_reply ? `<div class="event-ai-reply">AI: ${event.ai_reply}</div>` : ''}
                    ${event.client_state ? `<div class="event-state">State: ${event.client_state}</div>` : ''}
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading IVR events:', error);
        const container = document.getElementById(`ivrEvents_${classification.id}`);
        container.innerHTML = '<h6>IVR Events</h6><p class="error">Error loading events.</p>';
    }
}

// Load IVR events directly for a call session (when no classification exists)
async function loadIvrEventsForSession(session) {
    try {
        console.log('Loading IVR events for session:', session.id);
        console.log('Session call_id:', session.call_id);
        
        const { data: events, error } = await supabase
            .from('ivr_events')
            .select('*')
            .eq('call_id', session.call_id)
            .order('created_at', { ascending: true });
        
        console.log('IVR events query for session:', { events, error });
        
        const container = document.getElementById(`ivrEvents_session_${session.id}`);
        
        if (error) {
            console.error('IVR events error for session:', error);
            container.innerHTML = '<h6>IVR Events</h6><p class="error">Error loading events: ' + error.message + '</p>';
            return;
        }
        
        if (!events || events.length === 0) {
            container.innerHTML = '<h6>IVR Events</h6><p class="empty-state">No IVR events found for this session.</p>';
            return;
        }
        
        let html = '<h6>IVR Events (' + events.length + ')</h6><div class="events-list">';
        
        events.forEach(event => {
            // Only show transcript prominently if it exists
            if (event.transcript) {
                html += `
                    <div class="event-item">
                        <div class="event-transcript">${event.transcript}</div>
                        <div class="event-header">
                            <span class="event-timing">${new Date(event.created_at).toLocaleString()}</span>
                            <span class="event-action">${event.action_type}: ${event.action_value || '-'}</span>
                            ${event.executed ? '<span class="event-status executed">✓</span>' : '<span class="event-status pending">⏳</span>'}
                        </div>
                        ${event.ai_reply ? `<div class="event-ai-reply">AI Response: ${event.ai_reply}</div>` : ''}
                    </div>
                `;
            } else {
                html += `
                    <div class="event-item">
                        <div class="event-header">
                            <span class="event-timing">${new Date(event.created_at).toLocaleString()}</span>
                            <span class="event-action">${event.action_type}: ${event.action_value || '-'}</span>
                            ${event.executed ? '<span class="event-status executed">✓</span>' : '<span class="event-status pending">⏳</span>'}
                        </div>
                        ${event.ai_reply ? `<div class="event-ai-reply">AI Response: ${event.ai_reply}</div>` : ''}
                    </div>
                `;
            }
        });
        
        html += `
                </div>
            </div>
        `;
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading IVR events for session:', error);
        const container = document.getElementById(`ivrEvents_session_${session.id}`);
        container.innerHTML = '<h6>IVR Events</h6><p class="error">Error loading events.</p>';
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
    if (!container) {
        console.log('Events container not found, skipping event:', text);
        return;
    }
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
    console.error('Error:', message);
    addEvent(message, '❌', 'event-error');
}

function showInfo(message) {
    console.info('Info:', message);
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
    
    // Clean up realtime channels
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    if (callSessionsChannel) {
        supabase.removeChannel(callSessionsChannel);
        callSessionsChannel = null;
    }
    if (classificationsChannel) {
        supabase.removeChannel(classificationsChannel);
        classificationsChannel = null;
    }
    if (ivrEventsChannel) {
        supabase.removeChannel(ivrEventsChannel);
        ivrEventsChannel = null;
    }
});

// Test realtime connection manually
window.testRealtimeConnection = async function() {
    console.log('🧪 Testing real-time connection...');
    
    // Check authentication first
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        console.error('❌ Not authenticated');
        return;
    }
    console.log('✅ Authenticated as:', session.user.email);
    
    // Check current channels
    const channels = supabase.getChannels();
    console.log('Current channels:', channels.map(ch => ({
        topic: ch.topic,
        state: ch.state
    })));
    
    // Check if we have a pending call ID
    if (!currentPendingCall) {
        console.error('❌ No current pending call loaded');
        return;
    }
    
    console.log('Current pending call ID:', currentPendingCall.id);
    
    // Test update
    console.log('📝 To test, update the pending call in the database');
    console.log(`UPDATE pending_calls SET updated_at = NOW() WHERE id = '${currentPendingCall.id}';`);
};

// Export functions for global access
window.toggleConnection = toggleConnection;
window.toggleAudio = toggleAudio;
window.setVolume = setVolume;
window.goToDashboard = goToDashboard;
window.logout = logout;
window.selectSession = selectSession;
window.closeDetailsPanel = closeDetailsPanel;
window.testRealtimeConnection = testRealtimeConnection;
