// public/scripts/dashboard.js
// Dashboard functionality

let currentUser = null;
let allCalls = [];
let currentFilter = 'all';
let realtimeChannel = null;

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
    
    // Load calls initially
    loadPendingCalls();
    
    // Set up real-time subscriptions
    setupRealtimeSubscription();
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
        tbody.innerHTML = '<tr><td colspan="9" class="empty-table">No calls found</td></tr>';
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

// Set up real-time subscriptions
function setupRealtimeSubscription() {
    // Clean up any existing subscription
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }
    
    // Subscribe to pending_calls table changes
    realtimeChannel = supabase
        .channel('dashboard_updates')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'pending_calls'
        }, handleRealtimeUpdate)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'call_sessions'
        }, handleCallSessionUpdate)
        .subscribe((status) => {
            console.log('Real-time subscription status:', status);
            console.log('Subscribed to channels:', ['pending_calls', 'call_sessions']);
            updateConnectionStatus(status === 'SUBSCRIBED');
        });
}

// Handle real-time updates for pending_calls
async function handleRealtimeUpdate(payload) {
    console.log('Real-time update:', payload);
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }
});

// Logout
async function logout() {
    // Clean up real-time subscription before logout
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }
    
    await supabase.auth.signOut();
    window.location.href = '/login.html';
}
