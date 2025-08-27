// public/scripts/dashboard.js
// Dashboard functionality

let currentUser = null;
let allCalls = [];
let currentFilter = 'all';

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
    if (!session.aal || session.aal !== 'aal2') {
        console.log('MFA not completed, redirecting to login');
        window.location.href = '/login.html';
        return;
    }
    
    currentUser = session.user;
    document.getElementById('userEmailDash').textContent = user.email;
    
    // Load calls
    loadPendingCalls();
    
    // Set up auto-refresh every 30 seconds
    setInterval(loadPendingCalls, 30000);
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
        tbody.innerHTML = '<tr><td colspan="8" class="empty-table">No calls found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredCalls.map(call => {
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
        
        return `<tr class="clickable" onclick="viewCallDetails('${call.id}')">
            <td>${call.employee_name || '-'}</td>
            <td>${call.clinic_name || '-'}</td>
            <td>${call.phone || '-'}</td>
            <td><span class="workflow-badge workflow-${call.workflow_state}">${call.workflow_state}</span></td>
            <td>${call.retry_count || 0}/${call.max_retries || 3}</td>
            <td>${lastAttempt}</td>
            <td>${call.success_evaluation || '-'}</td>
            <td>${buttonHtml}</td>
        </tr>`;
    }).join('');
}

// View call details
function viewCallDetails(pendingCallId) {
    window.location.href = `/monitor.html?pendingCallId=${pendingCallId}`;
}

// Monitor specific call
function monitorCall(pendingCallId, callId) {
    window.location.href = `/monitor.html?pendingCallId=${pendingCallId}&callId=${callId}&autoConnect=true`;
}

// Logout
async function logout() {
    await supabase.auth.signOut();
    window.location.href = '/login.html';
}
