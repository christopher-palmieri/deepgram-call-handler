// public/scripts/dashboard.js
// Dashboard functionality

let currentUser = null;
let allCalls = [];
let currentFilter = 'all';
let realtimeChannel = null;
let callSessionsChannel = null;
let pollingInterval = null;
let isRealtimeWorking = false;

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    await loadConfig(); // From config.js
    
    if (!supabase) {
        alert('Failed to initialize. Please refresh.');
        return;
    }
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user) {
        // Not logged in at all
        window.location.href = '/login.html';
        return;
    }
    
    // Check MFA level - must be aal2 to access dashboard
    console.log('Dashboard session check:', {
        aal: session.aal,
        userId: session.user?.id,
        hasUser: !!session.user
    });
    
    // Use getAuthenticatorAssuranceLevel instead of session.aal
    const { data: aalCheck } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    console.log('Dashboard AAL check:', aalCheck);
    
    if (!aalCheck || aalCheck.currentLevel !== 'aal2') {
        console.log('MFA not completed, redirecting to login. Current AAL:', aalCheck?.currentLevel);
        window.location.href = '/login.html';
        return;
    }
    
    currentUser = session.user;
    document.getElementById('userEmailDash').textContent = currentUser.email;
    
    // CRITICAL: Set up subscription BEFORE any data operations
    // This ensures WebSocket is established before any queries
    setupRealtimeSubscription();
    
    // Wait for subscription to establish before loading data
    setTimeout(async () => {
        await loadPendingCalls();
        // Only set up polling after everything else
        setupFallbackPolling();
    }, 1000);
});

// Load pending calls
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
        tbody.innerHTML = '<tr><td colspan="10" class="empty-table">No calls found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredCalls.map(call => createCallRowHtml(call)).join('');
}

// View call details
function viewCallDetails(pendingCallId) {
    window.location.href = `/monitor.html?pendingCallId=${pendingCallId}`;
}

// Monitor specific call
function monitorCall(pendingCallId, callId) {
    window.location.href = `/monitor.html?pendingCallId=${pendingCallId}&callId=${callId}&autoConnect=true`;
}

// Set up real-time subscriptions - DEBUG VERSION
function setupRealtimeSubscription() {
    console.log('🚀 Setting up realtime subscription...');
    console.log('Current auth state:', currentUser?.email);
    
    // Clean up any existing subscriptions
    if (realtimeChannel) {
        console.log('Cleaning up existing channel:', realtimeChannel.topic);
        supabase.removeChannel(realtimeChannel);
    }
    
    // Log all existing channels
    const existingChannels = supabase.getChannels();
    console.log('Existing channels before subscription:', existingChannels.map(ch => ({
        topic: ch.topic,
        state: ch.state,
        joined: ch.isJoined()
    })));
    
    // Create subscription with extensive debugging
    console.log('Creating new subscription...');
    
    // Try with a unique timestamp in channel name to avoid conflicts
    const channelName = `pending-calls-${Date.now()}`;
    console.log('Using channel name:', channelName);
    
    realtimeChannel = supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'pending_calls'
            },
            (payload) => {
                console.log('🔔 DASHBOARD UPDATE RECEIVED!');
                console.log('Full payload:', JSON.stringify(payload, null, 2));
                handleRealtimeUpdate(payload);
            }
        );
    
    // Add system event listener to debug
    realtimeChannel.on('system', {}, (payload) => {
        console.log('📡 System event:', payload);
    });
    
    // Add presence sync to verify connection
    realtimeChannel.on('presence', { event: 'sync' }, () => {
        console.log('👥 Presence sync received');
    });
    
    // Subscribe and monitor
    realtimeChannel.subscribe((status, error) => {
        console.log('📊 Subscription callback - Status:', status, 'Error:', error);
        
        if (error) {
            console.error('❌ Subscription error details:', {
                message: error.message,
                code: error.code,
                details: error
            });
            isRealtimeWorking = false;
        } else {
            console.log(`Dashboard subscription status changed to: ${status}`);
            
            if (status === 'SUBSCRIBED') {
                isRealtimeWorking = true;
                console.log('✅ Dashboard realtime ACTIVE!');
                
                // Log channel details
                console.log('Channel details:', {
                    topic: realtimeChannel.topic,
                    state: realtimeChannel.state,
                    joined: realtimeChannel.isJoined(),
                    socket: !!realtimeChannel.socket
                });
                
                // Check bindings
                if (realtimeChannel.bindings) {
                    console.log('Channel bindings:', Object.keys(realtimeChannel.bindings));
                }
                
                // Monitor WebSocket directly
                if (realtimeChannel.socket) {
                    console.log('WebSocket state:', realtimeChannel.socket.readyState);
                    
                    // Intercept messages to see what's coming through
                    const originalOnMessage = realtimeChannel.socket.onmessage;
                    let messageCount = 0;
                    realtimeChannel.socket.onmessage = function(event) {
                        messageCount++;
                        try {
                            const data = JSON.parse(event.data);
                            if (data.event === 'postgres_changes' || data.payload?.type === 'postgres_changes') {
                                console.log(`🎯 WebSocket postgres_changes message #${messageCount}:`, data);
                            }
                            // Log first 5 messages of any type for debugging
                            if (messageCount <= 5) {
                                console.log(`📨 WebSocket message #${messageCount} type:`, data.event || data.type, 'topic:', data.topic);
                            }
                        } catch (e) {
                            // Not JSON, ignore
                        }
                        if (originalOnMessage) {
                            originalOnMessage.call(this, event);
                        }
                    };
                }
                
                // Stop polling
                if (pollingInterval) {
                    clearInterval(pollingInterval);
                    pollingInterval = null;
                    console.log('🛑 Stopped fallback polling');
                }
            }
            
            updateConnectionStatus(status === 'SUBSCRIBED');
        }
    });
    
    console.log('Subscription setup complete, waiting for status...');
}

// Handle real-time updates for pending_calls
async function handleRealtimeUpdate(payload) {
    console.log('📋 Processing update...');
    console.log('Current filter:', currentFilter);
    console.log('Total calls before update:', allCalls.length);
    
    if (payload.eventType === 'INSERT') {
        // New call added
        const newCall = await fetchCallWithSessions(payload.new.id);
        if (newCall) {
            allCalls.unshift(newCall);
            renderCallsTable();
        }
    } else if (payload.eventType === 'UPDATE') {
        // Call updated
        console.log('UPDATE event - old:', payload.old);
        console.log('UPDATE event - new:', payload.new);
        const updatedCall = await fetchCallWithSessions(payload.new.id);
        if (updatedCall) {
            console.log('Fetched updated call:', updatedCall.workflow_state);
            const index = allCalls.findIndex(c => c.id === updatedCall.id);
            if (index !== -1) {
                allCalls[index] = updatedCall;
                updateSingleCallRow(updatedCall);
                console.log('Updated call at index:', index);
            } else {
                console.log('Call not found in allCalls array');
            }
        } else {
            console.log('Failed to fetch updated call');
        }
    } else if (payload.eventType === 'DELETE') {
        // Call removed
        allCalls = allCalls.filter(c => c.id !== payload.old.id);
        renderCallsTable();
    }
}

// Handle real-time updates for call_sessions
async function handleCallSessionUpdate(payload) {
    console.log('Call session update:', payload);
    
    // Find the related pending call and refresh its data
    if (payload.new?.pending_call_id) {
        const updatedCall = await fetchCallWithSessions(payload.new.pending_call_id);
        if (updatedCall) {
            const index = allCalls.findIndex(c => c.id === updatedCall.id);
            if (index !== -1) {
                allCalls[index] = updatedCall;
                updateSingleCallRow(updatedCall);
            }
        }
    }
}

// Fetch a single call with its sessions
async function fetchCallWithSessions(callId) {
    try {
        const { data, error } = await supabase
            .from('pending_calls')
            .select('*, call_sessions(*)')
            .eq('id', callId)
            .single();
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error fetching call:', error);
        return null;
    }
}

// Update a single call row in the table
function updateSingleCallRow(call) {
    const tbody = document.getElementById('callsTableBody');
    const existingRow = tbody.querySelector(`tr[data-call-id="${call.id}"]`);
    
    if (existingRow) {
        const newRowHtml = createCallRowHtml(call);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newRowHtml;
        const newRow = tempDiv.firstChild;
        
        // Add a brief highlight animation
        newRow.style.backgroundColor = '#f0f9ff';
        existingRow.replaceWith(newRow);
        
        // Remove highlight after animation
        setTimeout(() => {
            newRow.style.backgroundColor = '';
        }, 1000);
    } else {
        // If row doesn't exist, re-render the entire table
        renderCallsTable();
    }
}

// Create HTML for a single call row
function createCallRowHtml(call) {
    const lastAttempt = call.last_attempt_at ? 
        new Date(call.last_attempt_at).toLocaleString() : '-';
    
    const nextAction = call.next_action_at ? 
        new Date(call.next_action_at).toLocaleString() : '-';
    
    const activeSession = call.call_sessions && 
        call.call_sessions.find(s => s.call_status === 'active');
    
    let buttonHtml = '';
    if (activeSession) {
        buttonHtml = `<button class="monitor-btn" onclick="event.stopPropagation(); monitorCall('${call.id}', '${activeSession.call_id}')">Monitor Live</button>`;
    } else {
        buttonHtml = `<button class="monitor-btn" onclick="event.stopPropagation(); viewCallDetails('${call.id}')">View Details</button>`;
    }
    
    return `<tr class="clickable" data-call-id="${call.id}" onclick="viewCallDetails('${call.id}')">
        <td>${call.employee_name || '-'}</td>
        <td>${call.clinic_name || '-'}</td>
        <td>${call.phone || '-'}</td>
        <td><span class="task-type-badge">${call.task_type || 'records_request'}</span></td>
        <td><span class="workflow-badge workflow-${call.workflow_state}">${call.workflow_state}</span></td>
        <td>${call.retry_count || 0}/${call.max_retries || 3}</td>
        <td>${lastAttempt}</td>
        <td>${nextAction}</td>
        <td>${call.success_evaluation || '-'}</td>
        <td>${buttonHtml}</td>
    </tr>`;
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    const header = document.querySelector('.header');
    let statusIndicator = document.getElementById('realtimeStatus');
    
    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'realtimeStatus';
        statusIndicator.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
        `;
        header.style.position = 'relative';
        header.appendChild(statusIndicator);
    }
    
    if (connected) {
        statusIndicator.textContent = '● Live';
        statusIndicator.style.backgroundColor = '#10b981';
        statusIndicator.style.color = 'white';
    } else {
        statusIndicator.textContent = '● Offline';
        statusIndicator.style.backgroundColor = '#ef4444';
        statusIndicator.style.color = 'white';
    }
}

// Set up fallback polling mechanism
function setupFallbackPolling() {
    // Wait 5 seconds to see if realtime connects
    setTimeout(() => {
        if (!isRealtimeWorking && !pollingInterval) {
            console.log('⚠️ Real-time not working, starting fallback polling (every 10 seconds)');
            pollingInterval = setInterval(() => {
                if (!isRealtimeWorking) {
                    console.log('🔄 Polling for updates...');
                    loadPendingCalls();
                }
            }, 10000); // Poll every 10 seconds
        }
    }, 5000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }
    if (callSessionsChannel) {
        supabase.removeChannel(callSessionsChannel);
    }
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
});

// Create an isolated test subscription that exactly matches working test
window.createTestSubscription = function() {
    console.log('🧪 Creating isolated test subscription (exactly like test-realtime.html)...');
    
    // Remove any test channel if exists
    const channels = supabase.getChannels();
    channels.forEach(ch => {
        if (ch.topic.includes('test')) {
            supabase.removeChannel(ch);
            console.log('Removed channel:', ch.topic);
        }
    });
    
    // Create exactly like test-realtime.html
    const testChannel = supabase
        .channel('pending-calls-test')
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'pending_calls'
            },
            (payload) => {
                console.log('🔔 TEST SUBSCRIPTION UPDATE RECEIVED!');
                console.log(`Event: ${payload.eventType}`);
                console.log(`Table: ${payload.table}`);
                console.log(`New: ${JSON.stringify(payload.new)}`);
                console.log(`Old: ${JSON.stringify(payload.old)}`);
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.log('Test subscribe error:', error.message);
            } else {
                console.log(`Test subscription status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    console.log('✅ Test subscription active - try updating a record');
                }
            }
        });
    
    window.testChannel = testChannel;
    return testChannel;
};

// Test realtime connection
async function testRealtimeConnection() {
    console.log('🧪 Testing real-time connection...');
    
    // Check authentication first
    const { data: { session } } = await supabase.auth.getSession();
    console.log('Current session:', {
        user: session?.user?.email,
        aal: session?.aal,
        expiresAt: session?.expires_at
    });
    
    // Check AAL level
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    console.log('MFA level:', aalData);
    
    // Check if channel is subscribed
    const channels = supabase.getChannels();
    console.log('Active channels:', channels.map(ch => ({
        topic: ch.topic,
        state: ch.state,
        joined: ch.isJoined()
    })));
    
    if (realtimeChannel) {
        console.log('Main channel details:', {
            state: realtimeChannel.state,
            topic: realtimeChannel.topic,
            joined: realtimeChannel.isJoined(),
            bindings: Object.keys(realtimeChannel.bindings || {})
        });
    }
    
    // Test a manual update to see if it triggers
    console.log('📝 To test: Go to Supabase and update any field in pending_calls table');
    console.log('You should see "🔔 DASHBOARD UPDATE RECEIVED!" in the console');
    console.log('💡 Or run: window.createTestSubscription() to create a test subscription');
    
    // Also show current subscription status
    console.log('Is realtime working?', isRealtimeWorking);
    console.log('Is polling active?', pollingInterval !== null);
    
    // Try to manually fetch to ensure data access works
    try {
        const { data, error } = await supabase
            .from('pending_calls')
            .select('id, employee_name')
            .limit(1);
        
        if (error) {
            console.error('❌ Error fetching data:', error);
        } else {
            console.log('✅ Manual fetch successful:', data);
        }
    } catch (e) {
        console.error('❌ Exception during fetch:', e);
    }
    
    // TEMPORARILY DISABLED - Testing if multiple channels conflict
    console.log('🚫 Test channel temporarily disabled to test main subscription');
    console.log('📝 Main subscription should now be the ONLY subscription');
    console.log('📝 Update a record and look for: 🎯 MAIN SUBSCRIPTION UPDATE!');
}

// Logout
async function logout() {
    // Clean up real-time subscriptions before logout
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }
    if (callSessionsChannel) {
        supabase.removeChannel(callSessionsChannel);
    }
    
    // Clean up polling interval
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    
    await supabase.auth.signOut();
    window.location.href = '/login.html';
}
