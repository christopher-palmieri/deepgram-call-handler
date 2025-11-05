// public/scripts/dashboard.js
// Dashboard functionality

let currentUser = null;
let allCalls = [];
let currentFilters = {
    status: ['all'],
    dateRange: ['last6months'],  // Default to last 6 months
    taskType: ['all'],
    activeStatus: ['active'],  // Default to active only
    successEval: ['all'],  // Default to all success evaluations
    rowLimit: 50  // Default row limit
};
let realtimeChannel = null;
let callSessionsChannel = null;
let pollingInterval = null;
let isRealtimeWorking = false;
let currentSort = { field: null, direction: 'asc' };
let searchQuery = '';

// Pagination state
let currentOffset = 0;
let hasMoreRows = false;

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
    
    // Initialize column resizing
    initializeColumnResizing();
    
    // Initialize column sorting
    initializeColumnSorting();
    
    // Initialize dropdown filters
    initializeDropdownFilters();

    // Initialize drag and drop for file upload
    initializeFileUploadDragDrop();

    // Load saved filters from localStorage
    loadSavedFilters();
    
    // Load saved filter presets
    loadFilterPresets();
    
    // Initialize search functionality
    initializeSearch();
    
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
async function loadPendingCalls(append = false) {
    try {
        // Reset offset if not appending
        if (!append) {
            currentOffset = 0;
            allCalls = [];
        }

        let query = supabase
            .from('pending_calls')
            .select('*, call_sessions(*)', { count: 'exact' });

        // Apply is_active filter based on current selection
        const activeFilter = currentFilters.activeStatus;
        if (activeFilter.includes('active') && !activeFilter.includes('inactive')) {
            // Only active
            query = query.eq('is_active', true);
        } else if (activeFilter.includes('inactive') && !activeFilter.includes('active')) {
            // Only inactive
            query = query.eq('is_active', false);
        }
        // If both or neither selected, don't filter (show all)

        // Apply server-side date filtering for 'last6months' and 'alltime'
        const dateRange = currentFilters.dateRange;
        if (dateRange.includes('last6months') && !dateRange.includes('alltime')) {
            // Only show calls from last 6 months
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            query = query.gte('appointment_time', sixMonthsAgo.toISOString());
        }
        // If 'alltime' is selected (alone or with others), don't apply date filter at DB level
        // Client-side filters (today, tomorrow, etc.) will be applied after loading

        // Get row limit
        const limit = currentFilters.rowLimit || 50;

        const { data: calls, error, count } = await query
            .order('created_at', { ascending: false })
            .range(currentOffset, currentOffset + limit - 1);

        if (error) throw error;

        // Check if there are more rows to load
        hasMoreRows = count && count > (currentOffset + (calls?.length || 0));

        // Update offset for next load
        currentOffset += calls?.length || 0;

        // Append or replace calls
        if (append) {
            allCalls = [...allCalls, ...(calls || [])];
        } else {
            allCalls = calls || [];
        }

        renderCallsTable();
        updateShowMoreButton();

    } catch (error) {
        console.error('Error loading calls:', error);
        document.getElementById('callsTableBody').innerHTML =
            '<tr><td colspan="18" class="empty-table">Error loading calls</td></tr>';
    }
}

// Load more calls (pagination)
async function loadMoreCalls() {
    await loadPendingCalls(true);
}

// Update Show More button visibility and text
function updateShowMoreButton() {
    const container = document.querySelector('.show-more-container');
    const countText = document.getElementById('showMoreCount');

    if (hasMoreRows) {
        container.style.display = 'block';
        const limit = currentFilters.rowLimit || 50;
        countText.textContent = `(Load ${limit} more)`;
    } else {
        container.style.display = 'none';
    }
}

// Legacy filter function - keeping for compatibility
function filterCalls(filter) {
    console.log('Legacy filter function called:', filter);
}

// Render calls table
function renderCallsTable() {
    const tbody = document.getElementById('callsTableBody');
    
    let filteredCalls = applyFilters(allCalls);
    filteredCalls = applySearch(filteredCalls);
    
    if (filteredCalls.length === 0) {
        tbody.innerHTML = '<tr><td colspan="18" class="empty-table">No calls found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredCalls.map(call => createCallRowHtml(call)).join('');

    // Re-initialize column resizing after table update
    reinitializeColumnResizing();

    // Reapply column visibility settings after table re-render
    applySavedColumnVisibility();
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
    
    // CRITICAL: Remove ALL existing channels to avoid conflicts
    const allChannels = supabase.getChannels();
    console.log(`Found ${allChannels.length} existing channels`);
    allChannels.forEach(channel => {
        console.log(`Removing channel: ${channel.topic}`);
        supabase.removeChannel(channel);
    });
    
    // Force reconnect the realtime connection
    if (supabase.realtime) {
        console.log('Disconnecting existing realtime connection...');
        supabase.realtime.disconnect();
        
        // Small delay to ensure disconnection
        setTimeout(() => {
            console.log('Reconnecting realtime...');
            supabase.realtime.connect();
            
            // Create subscription after reconnection
            setTimeout(() => {
                createDashboardSubscription();
            }, 500);
        }, 500);
    } else {
        createDashboardSubscription();
    }
}

function createDashboardSubscription() {
    console.log('Creating fresh subscription...');
    
    // Create subscription EXACTLY like the working test page
    realtimeChannel = supabase
        .channel('pending-calls-dashboard')
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'pending_calls'
            },
            (payload) => {
                console.log('🔔 DASHBOARD UPDATE RECEIVED!');
                console.log(`Event: ${payload.eventType}`);
                console.log(`Table: ${payload.table}`);
                console.log('New:', payload.new);
                console.log('Old:', payload.old);
                handleRealtimeUpdate(payload);
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.error('Subscribe error:', error.message);
                isRealtimeWorking = false;
            } else {
                console.log(`Subscription status: ${status}`);
                
                if (status === 'SUBSCRIBED') {
                    isRealtimeWorking = true;
                    console.log('✅ Subscribed to pending_calls changes');
                    console.log('Now update any record in pending_calls table');
                    
                    // Log final state
                    const channels = supabase.getChannels();
                    console.log(`Active channels after setup: ${channels.length}`);
                    channels.forEach(ch => {
                        console.log(`- ${ch.topic}: ${ch.state}`);
                    });
                    
                    // Stop polling when realtime is working
                    if (pollingInterval) {
                        clearInterval(pollingInterval);
                        pollingInterval = null;
                        console.log('🛑 Stopped fallback polling');
                    }
                }
                
                updateConnectionStatus(status === 'SUBSCRIBED');
            }
        });
}

// Handle real-time updates for pending_calls
async function handleRealtimeUpdate(payload) {
    console.log('📋 Processing update...');
    console.log('Total calls before update:', allCalls.length);
    
    try {
        if (payload.eventType === 'INSERT') {
            // New call added
            console.log('DEBUG: About to fetch new call');
            const newCall = await fetchCallWithSessions(payload.new.id);
            if (newCall) {
                console.log('DEBUG: About to add call to allCalls');
                allCalls.unshift(newCall);
                console.log('DEBUG: About to call renderCallsTable');
                renderCallsTable();
            }
        } else if (payload.eventType === 'UPDATE') {
            // Call updated
            console.log('DEBUG: UPDATE event - old:', payload.old);
            console.log('DEBUG: UPDATE event - new:', payload.new);
            console.log('DEBUG: About to fetch updated call');
            const updatedCall = await fetchCallWithSessions(payload.new.id);
            if (updatedCall) {
                console.log('DEBUG: Fetched updated call:', updatedCall.workflow_state);
                console.log('DEBUG: About to find call in allCalls');
                const index = allCalls.findIndex(c => c.id === updatedCall.id);
                if (index !== -1) {
                    console.log('DEBUG: About to update call in allCalls');
                    allCalls[index] = updatedCall;
                    console.log('DEBUG: About to call updateSingleCallRow');
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
            console.log('DEBUG: About to filter allCalls for DELETE');
            allCalls = allCalls.filter(c => c.id !== payload.old.id);
            console.log('DEBUG: About to call renderCallsTable for DELETE');
            renderCallsTable();
        }
    } catch (error) {
        console.error('ERROR in handleRealtimeUpdate:', error);
        console.error('Error stack:', error.stack);
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
        const tempDiv = document.createElement('tbody');
        tempDiv.innerHTML = newRowHtml;
        const newRow = tempDiv.firstElementChild;
        
        if (newRow) {
            // Add a brief highlight animation
            newRow.style.backgroundColor = '#f0f9ff';
            existingRow.replaceWith(newRow);

            // Reapply column visibility to the new row
            applySavedColumnVisibility();

            // Remove highlight after animation
            setTimeout(() => {
                if (newRow && newRow.style) {
                    newRow.style.backgroundColor = '';
                }
            }, 1000);
        } else {
            console.error('Failed to create new row element');
            renderCallsTable();
        }
    } else {
        // If row doesn't exist, re-render the entire table
        renderCallsTable();
    }
}

// Format phone number to (XXX) XXX-XXXX format
function formatPhoneNumber(phone) {
    if (!phone) return '-';
    
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Check if it's a US phone number (10 digits) or international with country code
    if (cleaned.length === 10) {
        // Format as (XXX) XXX-XXXX
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        // US number with country code, remove the 1
        const usNumber = cleaned.slice(1);
        return `(${usNumber.slice(0, 3)}) ${usNumber.slice(3, 6)}-${usNumber.slice(6)}`;
    } else {
        // Return as-is for international or non-standard numbers
        return phone;
    }
}

// Get color-coded badge for success evaluation
function getSuccessBadge(successEval) {
    if (!successEval) {
        return '<span class="success-badge success-none">-</span>';
    }

    // Map success evaluation to badge class
    const badgeClass = successEval
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[()]/g, '');

    return `<span class="success-badge success-${badgeClass}">${successEval}</span>`;
}

// Get classification badge
function getClassificationBadge(classificationId) {
    if (!classificationId) {
        return '<span style="color: #9ca3af; font-style: italic;">No classification</span>';
    }
    // If there's a classification ID, show a checkmark badge
    return '<span class="classification-badge">✓ Classified</span>';
}

// Create HTML for a single call row
function createCallRowHtml(call) {
    const lastAttempt = call.last_attempt_at ?
        new Date(call.last_attempt_at).toLocaleString() : '-';

    const nextAction = call.next_action_at ?
        new Date(call.next_action_at).toLocaleString() : '-';

    const appointmentTime = call.appointment_time ?
        new Date(call.appointment_time).toLocaleString() : '-';

    const formattedPhone = formatPhoneNumber(call.phone);

    return `<tr class="clickable" data-call-id="${call.id}" onclick="viewCallDetails('${call.id}')">
        <td class="checkbox-col" onclick="event.stopPropagation();">
            <input type="checkbox" class="row-checkbox" data-call-id="${call.id}" onchange="handleRowSelection(this)">
        </td>
        <td class="actions-cell">
            <button class="make-call-btn" onclick="event.stopPropagation(); makeCall('${call.id}')" title="Make Call">
                <svg class="play-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5v14l11-7L8 5z" fill="currentColor"/>
                </svg>
            </button>
            <button class="edit-classification-btn" onclick="event.stopPropagation(); showClassificationModal('${call.id}')" title="Edit Classification">
                <svg class="edit-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
                </svg>
            </button>
            <button class="export-call-btn" onclick="event.stopPropagation(); exportCall('${call.id}')" title="Export Call Data">
                <svg class="export-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" fill="currentColor"/>
                </svg>
            </button>
            <button class="archive-call-btn${call.is_active ? '' : ' unarchive-mode'}" onclick="event.stopPropagation(); toggleArchiveCall('${call.id}')" title="${call.is_active ? 'Archive Call' : 'Unarchive Call'}">
                <svg class="archive-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    ${call.is_active
                        ? '<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z" fill="currentColor"/>'
                        : '<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 9l5.5 5.5H14v2h-4v-2H6.5L12 9zM5.12 5l.81-1h12l.94 1H5.12z" fill="currentColor"/>'
                    }
                </svg>
            </button>
            <button class="kill-call-btn" onclick="event.stopPropagation(); killCall('${call.id}')" title="Kill Live Call">
                <svg class="kill-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.28-.28.67-.36 1.02-.25 1.12.37 2.32.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="white"/>
                    <path d="M21 6l-6 6M21 12l-6-6" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </button>
            <button class="delete-call-btn" onclick="event.stopPropagation(); showDeleteConfirmation('${call.id}', '${call.employee_name}', '${call.clinic_name}')" title="Delete Call">
                <svg class="delete-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
                </svg>
            </button>
        </td>
        <td data-column="employee">${call.employee_name || '-'}</td>
        <td data-column="appointment">${appointmentTime}</td>
        <td data-column="task"><span class="task-type-badge">${call.task_type || 'records_request'}</span></td>
        <td data-column="status"><span class="workflow-badge workflow-${call.workflow_state}">${call.workflow_state}</span></td>
        <td data-column="success">${getSuccessBadge(call.success_evaluation)}</td>
        <td data-column="retries">${call.retry_count || 0}/${call.max_retries || 3}</td>
        <td data-column="client">${call.client_name || '-'}</td>
        <td data-column="clinic">${call.clinic_name || '-'}</td>
        <td data-column="phone">${formattedPhone}</td>
        <td data-column="procedures">${call.procedures || '-'}</td>
        <td data-column="address">${call.clinic_provider_address || '-'}</td>
        <td data-column="classification">${getClassificationBadge(call.classification_id)}</td>
        <td data-column="last_error">${call.last_error ? `<span class="error-text" title="${call.last_error}">${call.last_error.substring(0, 50)}${call.last_error.length > 50 ? '...' : ''}</span>` : '-'}</td>
        <td data-column="last_try">${lastAttempt}</td>
        <td data-column="next">${nextAction}</td>
        <td data-column="tags" class="tags-cell" onclick="event.stopPropagation(); editTags('${call.id}', this)">${renderTags(call.tag)}</td>
    </tr>`;
}

// Render tags as badges
function renderTags(tags) {
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
        return '<span class="tags-placeholder">Click to add tags</span>';
    }
    return tags.map(tag => `<span class="tag-badge">${tag}</span>`).join(' ');
}

// Edit tags inline
function editTags(callId, cell) {
    const call = allCalls.find(c => c.id === callId);
    if (!call) return;

    const currentTags = call.tag || [];
    const tagsString = Array.isArray(currentTags) ? currentTags.join(', ') : '';

    // Replace cell content with input
    cell.innerHTML = `
        <input type="text"
               class="tags-input"
               value="${tagsString}"
               placeholder="tag1, tag2, tag3"
               onblur="saveTags('${callId}', this.value, this.parentElement)"
               onkeypress="if(event.key === 'Enter') { this.blur(); }"
               style="width: 100%; padding: 4px; border: 1px solid #3b82f6; border-radius: 4px; outline: none;">
    `;

    // Focus the input
    const input = cell.querySelector('.tags-input');
    input.focus();
    input.select();
}

// Save tags to database
async function saveTags(callId, tagsString, cell) {
    // Parse the tags string
    const tagsArray = tagsString
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    try {
        // Update in database
        const { error } = await supabase
            .from('pending_calls')
            .update({ tag: tagsArray })
            .eq('id', callId);

        if (error) {
            console.error('Error updating tags:', error);
            alert('Failed to update tags: ' + error.message);
            // Revert to original display
            const call = allCalls.find(c => c.id === callId);
            cell.innerHTML = renderTags(call?.tag);
            return;
        }

        // Update local cache
        const call = allCalls.find(c => c.id === callId);
        if (call) {
            call.tag = tagsArray;
        }

        // Update display
        cell.innerHTML = renderTags(tagsArray);
        console.log('✅ Tags updated successfully:', tagsArray);

        // Reapply column visibility to ensure cell respects hidden/visible state
        applySavedColumnVisibility();

    } catch (error) {
        console.error('Error saving tags:', error);
        alert('Failed to save tags');
        // Revert to original display
        const call = allCalls.find(c => c.id === callId);
        cell.innerHTML = renderTags(call?.tag);

        // Reapply column visibility after reverting
        applySavedColumnVisibility();
    }
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusDot && statusText) {
        if (connected) {
            statusDot.classList.remove('disconnected');
            statusDot.classList.add('connected');
            statusText.textContent = 'Live';
        } else if (pollingInterval) {
            statusDot.classList.remove('connected', 'disconnected');
            statusText.textContent = 'Polling';
        } else {
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Offline';
        }
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
    
    // Create a SEPARATE test channel to isolate the issue
    console.log('🔬 Creating isolated test channel...');
    
    // Remove any existing test channel
    const existingChannels = supabase.getChannels();
    const testChannels = existingChannels.filter(ch => ch.topic.includes('test'));
    testChannels.forEach(ch => {
        console.log(`Removing test channel: ${ch.topic}`);
        supabase.removeChannel(ch);
    });
    
    // Create new test subscription
    const testChannel = supabase
        .channel('test-isolated-' + Date.now())
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'pending_calls'
            },
            (payload) => {
                console.log('🎯 TEST CHANNEL RECEIVED UPDATE!');
                console.log('Payload:', payload);
            }
        )
        .subscribe((status, error) => {
            if (error) {
                console.error('Test channel error:', error);
            } else {
                console.log(`Test channel status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    console.log('✅ Test channel ready');
                    performTestUpdate();
                }
            }
        });
    
    async function performTestUpdate() {
        console.log('📝 Performing test update...');
        
        // Get the first call to update
        const { data: calls, error: fetchError } = await supabase
            .from('pending_calls')
            .select('*')
            .limit(1);
        
        if (fetchError) {
            console.error('Failed to fetch call:', fetchError);
            return;
        }
        
        if (!calls || calls.length === 0) {
            console.log('No calls found to test with');
            return;
        }
        
        const testCall = calls[0];
        console.log('Updating call:', testCall.id);
        
        // Update the call
        const testTimestamp = new Date().toISOString();
        const { data: updateData, error: updateError } = await supabase
            .from('pending_calls')
            .update({ 
                updated_at: testTimestamp,
                workflow_state: testCall.workflow_state || 'pending'
            })
            .eq('id', testCall.id)
            .select();
        
        if (updateError) {
            console.error('❌ Update failed:', updateError);
        } else {
            console.log('✅ Update successful');
            console.log('⏳ Waiting for realtime event...');
            
            // After 3 seconds, clean up test channel
            setTimeout(() => {
                console.log('🧹 Cleaning up test channel');
                supabase.removeChannel(testChannel);
            }, 3000);
        }
    }
    
    // Check if channel is subscribed
    const channels = supabase.getChannels();
    console.log('Active channels:', channels.map(ch => ({
        topic: ch.topic,
        state: ch.state,
        joined: ch.isJoined ? ch.isJoined() : 'N/A'
    })));
    
    if (realtimeChannel) {
        console.log('Main channel details:', {
            state: realtimeChannel.state,
            topic: realtimeChannel.topic,
            joined: realtimeChannel.isJoined ? realtimeChannel.isJoined() : 'N/A',
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

// Column Resizing Functionality
function initializeColumnResizing() {
    const table = document.querySelector('.calls-table table');
    if (!table) return;
    
    // Add resize handles to all headers except the last one
    const headers = table.querySelectorAll('th');
    headers.forEach((header, index) => {
        if (index < headers.length - 1) { // Skip last column
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            header.appendChild(resizeHandle);
            
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;
            
            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.pageX;
                startWidth = header.offsetWidth;
                resizeHandle.classList.add('resizing');
                
                // Prevent text selection during resize
                document.body.style.userSelect = 'none';
                
                e.preventDefault();
            });
            
            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                
                const diff = e.pageX - startX;
                const newWidth = Math.max(50, startWidth + diff); // Minimum 50px
                header.style.width = newWidth + 'px';
                
                // Also set width on corresponding cells in the column
                const columnIndex = Array.from(header.parentNode.children).indexOf(header);
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach(row => {
                    const cell = row.children[columnIndex];
                    if (cell) {
                        cell.style.width = newWidth + 'px';
                    }
                });
            });
            
            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    resizeHandle.classList.remove('resizing');
                    document.body.style.userSelect = '';
                }
            });
        }
    });
}

// Re-initialize column resizing after table updates
function reinitializeColumnResizing() {
    // Remove existing resize handles
    document.querySelectorAll('.resize-handle').forEach(handle => handle.remove());
    
    // Re-initialize
    initializeColumnResizing();
}

// Column Sorting Functionality
function initializeColumnSorting() {
    const sortableHeaders = document.querySelectorAll('.sortable');
    
    sortableHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't sort if clicking on resize handle
            if (e.target.classList.contains('resize-handle')) {
                return;
            }
            
            const field = header.getAttribute('data-sort');
            sortTable(field);
        });
    });
}

function sortTable(field) {
    // Toggle direction if same field, otherwise default to asc
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'asc';
    }
    
    // Remove sort classes from all headers
    document.querySelectorAll('.sortable').forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
    });
    
    // Add sort class to current header
    const currentHeader = document.querySelector(`[data-sort="${field}"]`);
    currentHeader.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    
    // Sort the data
    allCalls.sort((a, b) => {
        let aValue = getNestedValue(a, field);
        let bValue = getNestedValue(b, field);
        
        // Handle different data types
        const result = compareValues(aValue, bValue, field);
        
        return currentSort.direction === 'asc' ? result : -result;
    });
    
    // Re-render table
    renderCallsTable();
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

function compareValues(a, b, field) {
    // Handle null/undefined values
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    
    // Date fields
    if (['appointment_time', 'last_attempt_at', 'next_action_at'].includes(field)) {
        const dateA = new Date(a);
        const dateB = new Date(b);
        return dateA.getTime() - dateB.getTime();
    }
    
    // Numeric fields
    if (field === 'retry_count') {
        return parseInt(a) - parseInt(b);
    }
    
    // String fields (case insensitive)
    const strA = String(a).toLowerCase();
    const strB = String(b).toLowerCase();
    
    if (strA < strB) return -1;
    if (strA > strB) return 1;
    return 0;
}

// Dropdown Filter Functionality
function initializeDropdownFilters() {
    // Initialize each dropdown
    initializeDropdown('statusFilterToggle', 'statusFilterMenu', 'status');
    initializeDropdown('dateFilterToggle', 'dateFilterMenu', 'dateRange');
    initializeDropdown('taskFilterToggle', 'taskFilterMenu', 'taskType');
    initializeDropdown('activeFilterToggle', 'activeFilterMenu', 'activeStatus');
    initializeDropdown('successFilterToggle', 'successFilterMenu', 'successEval');
    initializeRowLimitDropdown('rowLimitToggle', 'rowLimitMenu');

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-filter')) {
            closeAllDropdowns();
        }
    });
}

function initializeDropdown(toggleId, menuId, filterType) {
    const toggle = document.getElementById(toggleId);
    const menu = document.getElementById(menuId);

    if (!toggle || !menu) return;

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('show');

        closeAllDropdowns();

        if (!isOpen) {
            menu.classList.add('show');
            toggle.classList.add('active');
        }
    });

    // Handle checkbox changes
    menu.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            handleFilterChange(filterType, e.target.value, e.target.checked);
        }
    });
}

// Special handler for row limit dropdown (uses radio buttons)
function initializeRowLimitDropdown(toggleId, menuId) {
    const toggle = document.getElementById(toggleId);
    const menu = document.getElementById(menuId);

    if (!toggle || !menu) return;

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('show');

        closeAllDropdowns();

        if (!isOpen) {
            menu.classList.add('show');
            toggle.classList.add('active');
        }
    });

    // Handle radio button changes
    menu.addEventListener('change', (e) => {
        if (e.target.type === 'radio' && e.target.name === 'rowLimit') {
            const limit = parseInt(e.target.value);
            currentFilters.rowLimit = limit;

            // Update display text
            const filterText = toggle.querySelector('.filter-text');
            filterText.textContent = `${limit} rows`;

            // Reload calls from beginning with new limit
            loadPendingCalls();

            // Save to localStorage
            saveFiltersToStorage();

            // Close dropdown after selection
            setTimeout(() => closeAllDropdowns(), 150);
        }
    });
}

function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
    });
    document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
        toggle.classList.remove('active');
    });
}

function handleFilterChange(filterType, value, checked) {
    if (value === 'all') {
        if (checked) {
            // If "All" is checked, uncheck all others and set to ['all']
            currentFilters[filterType] = ['all'];
            updateCheckboxes(filterType, ['all']);
        }
    } else {
        if (checked) {
            // If a specific option is checked, remove 'all' and add this option
            currentFilters[filterType] = currentFilters[filterType].filter(f => f !== 'all');
            if (!currentFilters[filterType].includes(value)) {
                currentFilters[filterType].push(value);
            }
        } else {
            // If unchecked, remove from filters
            currentFilters[filterType] = currentFilters[filterType].filter(f => f !== value);

            // If no filters left, default to 'all' (except for activeStatus)
            if (currentFilters[filterType].length === 0) {
                if (filterType === 'activeStatus') {
                    // For activeStatus, default to 'active' only
                    currentFilters[filterType] = ['active'];
                } else {
                    currentFilters[filterType] = ['all'];
                }
                updateCheckboxes(filterType, currentFilters[filterType]);
            }
        }
    }

    updateFilterDisplay(filterType);
    saveFiltersToStorage();

    // For activeStatus, we need to reload data from database
    // For dateRange, reload if it includes server-side filters (last6months or alltime)
    if (filterType === 'activeStatus') {
        loadPendingCalls();
    } else if (filterType === 'dateRange') {
        // Check if server-side date filter changed
        const hasServerSideFilter = currentFilters.dateRange.includes('last6months') ||
                                     currentFilters.dateRange.includes('alltime');
        if (hasServerSideFilter) {
            loadPendingCalls();
        } else {
            renderCallsTable();
        }
    } else {
        renderCallsTable();
    }
}

function updateCheckboxes(filterType, selectedValues) {
    const menuId = filterType === 'status' ? 'statusFilterMenu' :
                   filterType === 'dateRange' ? 'dateFilterMenu' :
                   filterType === 'taskType' ? 'taskFilterMenu' :
                   filterType === 'activeStatus' ? 'activeFilterMenu' : null;
    const menu = document.getElementById(menuId);

    if (!menu) return;

    menu.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = selectedValues.includes(checkbox.value);
    });
}

function updateFilterDisplay(filterType) {
    const toggleId = filterType === 'status' ? 'statusFilterToggle' :
                     filterType === 'dateRange' ? 'dateFilterToggle' :
                     filterType === 'taskType' ? 'taskFilterToggle' :
                     filterType === 'activeStatus' ? 'activeFilterToggle' :
                     filterType === 'successEval' ? 'successFilterToggle' : null;
    const toggle = document.getElementById(toggleId);

    if (!toggle) return;

    const filterText = toggle.querySelector('.filter-text');
    const selected = currentFilters[filterType];

    let displayText;
    if (selected.includes('all') || selected.length === 0) {
        displayText = filterType === 'status' ? 'All Statuses' :
                     filterType === 'dateRange' ? 'All Dates' :
                     filterType === 'taskType' ? 'All Tasks' :
                     filterType === 'activeStatus' ? 'All' :
                     filterType === 'successEval' ? 'All Outcomes' : 'All';
    } else if (selected.length === 1) {
        displayText = formatFilterValue(selected[0]);
    } else if (selected.length === 2 && filterType === 'activeStatus') {
        displayText = 'All'; // Both active and inactive = all
    } else {
        displayText = `${selected.length} selected`;
    }

    filterText.textContent = displayText;
}

function formatFilterValue(value) {
    const formatMap = {
        // Status values
        'pending': 'Pending',
        'new': 'New',
        'ready_to_call': 'Ready to Call',
        'calling': 'Calling',
        'classifying': 'Classifying',
        'completed': 'Completed',
        'failed': 'Failed',
        'retry_pending': 'Retry Pending',

        // Date range values
        'last6months': 'Last 6 Months',
        'today': 'Today',
        'tomorrow': 'Tomorrow',
        'yesterday': 'Yesterday',
        'last7days': 'Last 7 Days',
        'last30days': 'Last 30 Days',
        'older30days': 'Older than 30 Days',
        'alltime': 'All Time',

        // Task type values
        'records_request': 'Records Request',
        'schedule': 'Schedule',
        'kit_confirmation': 'Kit Confirmation',

        // Active status values
        'active': 'Active Only',
        'inactive': 'Inactive Only'
    };

    return formatMap[value] || value;
}

function applyFilters(calls) {
    return calls.filter(call => {
        // Status filter
        if (!currentFilters.status.includes('all')) {
            if (!currentFilters.status.includes(call.workflow_state)) {
                return false;
            }
        }

        // Date range filter (client-side only)
        // Filter out server-side filters (last6months, alltime) as they're already applied at DB level
        const clientSideDateFilters = currentFilters.dateRange.filter(
            range => range !== 'last6months' && range !== 'alltime' && range !== 'all'
        );

        if (clientSideDateFilters.length > 0) {
            if (!matchesDateRange(call.appointment_time, clientSideDateFilters)) {
                return false;
            }
        }

        // Task type filter
        if (!currentFilters.taskType.includes('all')) {
            const taskType = call.task_type || 'records_request';
            if (!currentFilters.taskType.includes(taskType)) {
                return false;
            }
        }

        // Success evaluation filter
        if (!currentFilters.successEval.includes('all')) {
            const successEval = call.success_evaluation || null;
            if (successEval === null) {
                // Handle null/blank success_evaluation
                if (!currentFilters.successEval.includes('none')) {
                    return false;
                }
            } else if (!currentFilters.successEval.includes(successEval)) {
                return false;
            }
        }

        return true;
    });
}

// Save current filter state to localStorage
function saveFiltersToStorage() {
    try {
        const filterState = {
            status: currentFilters.status,
            dateRange: currentFilters.dateRange,
            taskType: currentFilters.taskType,
            activeStatus: currentFilters.activeStatus,
            successEval: currentFilters.successEval,
            savedAt: new Date().toISOString()
        };
        localStorage.setItem('dashboardFilters', JSON.stringify(filterState));
        console.log('Filters saved to localStorage:', filterState);
    } catch (error) {
        console.warn('Failed to save filters to localStorage:', error);
    }
}

// Load saved filter state from localStorage
function loadSavedFilters() {
    try {
        const saved = localStorage.getItem('dashboardFilters');
        if (!saved) {
            console.log('No saved filters found');
            return;
        }

        const filterState = JSON.parse(saved);
        console.log('Loading saved filters:', filterState);

        // Restore filter state
        if (filterState.status) currentFilters.status = filterState.status;
        if (filterState.dateRange) currentFilters.dateRange = filterState.dateRange;
        if (filterState.taskType) currentFilters.taskType = filterState.taskType;
        if (filterState.activeStatus) currentFilters.activeStatus = filterState.activeStatus;
        if (filterState.successEval) currentFilters.successEval = filterState.successEval;

        // Update UI to reflect loaded filters
        updateCheckboxes('status', currentFilters.status);
        updateCheckboxes('dateRange', currentFilters.dateRange);
        updateCheckboxes('taskType', currentFilters.taskType);
        updateCheckboxes('activeStatus', currentFilters.activeStatus);
        updateCheckboxes('successEval', currentFilters.successEval);

        updateFilterDisplay('status');
        updateFilterDisplay('dateRange');
        updateFilterDisplay('taskType');
        updateFilterDisplay('activeStatus');
        updateFilterDisplay('successEval');

        console.log('Filters restored from localStorage');
    } catch (error) {
        console.warn('Failed to load filters from localStorage:', error);
        // Reset to defaults if loading fails
        currentFilters = {
            status: ['all'],
            dateRange: ['all'],
            taskType: ['all'],
            activeStatus: ['active']
        };
    }
}

// Filter Presets System
function showSaveFilterModal() {
    const modal = document.getElementById('saveFilterModal');
    const previewContainer = document.getElementById('currentFiltersPreview');
    const nameInput = document.getElementById('filterPresetName');
    
    // Clear previous input
    nameInput.value = '';
    
    // Show current filter summary
    const summary = generateFilterSummary(currentFilters);
    previewContainer.innerHTML = `
        <h4>Current Filter Settings:</h4>
        <div class="filter-summary">${summary}</div>
    `;
    
    modal.style.display = 'flex';
    nameInput.focus();
}

function closeSaveFilterModal() {
    document.getElementById('saveFilterModal').style.display = 'none';
}

function generateFilterSummary(filters) {
    const parts = [];

    // Status
    if (!filters.status.includes('all')) {
        const statusLabels = filters.status.map(s => formatFilterValue(s));
        parts.push(`Status: ${statusLabels.join(', ')}`);
    }

    // Date Range
    if (!filters.dateRange.includes('all')) {
        const dateLabels = filters.dateRange.map(d => formatFilterValue(d));
        parts.push(`Date: ${dateLabels.join(', ')}`);
    }

    // Task Type
    if (!filters.taskType.includes('all')) {
        const taskLabels = filters.taskType.map(t => formatFilterValue(t));
        parts.push(`Task: ${taskLabels.join(', ')}`);
    }

    // Active Status
    if (filters.activeStatus) {
        if (filters.activeStatus.includes('active') && !filters.activeStatus.includes('inactive')) {
            parts.push('Archive: Active Only');
        } else if (filters.activeStatus.includes('inactive') && !filters.activeStatus.includes('active')) {
            parts.push('Archive: Inactive Only');
        } else if (filters.activeStatus.includes('active') && filters.activeStatus.includes('inactive')) {
            parts.push('Archive: All');
        }
    }

    return parts.length > 0 ? parts.join(' • ') : 'All filters (no restrictions)';
}

function saveFilterPreset() {
    const nameInput = document.getElementById('filterPresetName');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Please enter a name for this filter preset');
        nameInput.focus();
        return;
    }
    
    try {
        // Get existing presets
        const existingPresets = JSON.parse(localStorage.getItem('filterPresets') || '{}');
        
        // Check if name already exists
        if (existingPresets[name]) {
            if (!confirm(`A preset named "${name}" already exists. Overwrite it?`)) {
                return;
            }
        }
        
        // Save new preset
        existingPresets[name] = {
            filters: {
                status: [...currentFilters.status],
                dateRange: [...currentFilters.dateRange],
                taskType: [...currentFilters.taskType],
                activeStatus: [...currentFilters.activeStatus]
            },
            createdAt: new Date().toISOString()
        };
        
        localStorage.setItem('filterPresets', JSON.stringify(existingPresets));
        console.log('Filter preset saved:', name, existingPresets[name]);
        
        // Refresh preset display
        loadFilterPresets();
        
        // Close modal
        closeSaveFilterModal();
        
        // Show success message
        showToast(`Filter preset "${name}" saved!`);
        
    } catch (error) {
        console.error('Failed to save filter preset:', error);
        alert('Failed to save filter preset. Please try again.');
    }
}

function loadFilterPresets() {
    try {
        const presets = JSON.parse(localStorage.getItem('filterPresets') || '{}');
        const container = document.getElementById('savedPresets');
        
        if (Object.keys(presets).length === 0) {
            container.innerHTML = '';
            return;
        }
        
        const presetButtons = Object.entries(presets).map(([name, data]) => {
            return `
                <div class="preset-button" onclick="applyFilterPreset('${name.replace(/'/g, "\\'")}')">
                    <span>${name}</span>
                    <button class="preset-delete" onclick="event.stopPropagation(); deleteFilterPreset('${name.replace(/'/g, "\\'")}')">×</button>
                </div>
            `;
        }).join('');
        
        container.innerHTML = presetButtons;
        console.log('Loaded filter presets:', Object.keys(presets));
        
    } catch (error) {
        console.error('Failed to load filter presets:', error);
    }
}

function applyFilterPreset(name) {
    try {
        const presets = JSON.parse(localStorage.getItem('filterPresets') || '{}');
        const preset = presets[name];
        
        if (!preset) {
            console.error('Preset not found:', name);
            return;
        }
        
        // Apply the preset filters
        currentFilters = {
            status: [...preset.filters.status],
            dateRange: [...preset.filters.dateRange],
            taskType: [...preset.filters.taskType],
            activeStatus: preset.filters.activeStatus ? [...preset.filters.activeStatus] : ['active']
        };

        // Update UI
        updateCheckboxes('status', currentFilters.status);
        updateCheckboxes('dateRange', currentFilters.dateRange);
        updateCheckboxes('taskType', currentFilters.taskType);
        updateCheckboxes('activeStatus', currentFilters.activeStatus);

        updateFilterDisplay('status');
        updateFilterDisplay('dateRange');
        updateFilterDisplay('taskType');
        updateFilterDisplay('activeStatus');

        // Save as current filters
        saveFiltersToStorage();

        // Reload data if activeStatus changed (to fetch from database)
        loadPendingCalls();
        
        // Visual feedback
        highlightActivePreset(name);
        showToast(`Applied filter preset "${name}"`);
        
        console.log('Applied filter preset:', name, currentFilters);
        
    } catch (error) {
        console.error('Failed to apply filter preset:', error);
        alert('Failed to apply filter preset. Please try again.');
    }
}

function deleteFilterPreset(name) {
    if (!confirm(`Delete filter preset "${name}"?`)) {
        return;
    }
    
    try {
        const presets = JSON.parse(localStorage.getItem('filterPresets') || '{}');
        delete presets[name];
        localStorage.setItem('filterPresets', JSON.stringify(presets));
        
        // Refresh display
        loadFilterPresets();
        showToast(`Filter preset "${name}" deleted`);
        
        console.log('Deleted filter preset:', name);
        
    } catch (error) {
        console.error('Failed to delete filter preset:', error);
        alert('Failed to delete filter preset. Please try again.');
    }
}

function highlightActivePreset(activeName) {
    // Remove active class from all presets
    document.querySelectorAll('.preset-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to the applied preset
    const activeBtn = Array.from(document.querySelectorAll('.preset-button')).find(btn => {
        const nameSpan = btn.querySelector('span');
        return nameSpan && nameSpan.textContent === activeName;
    });
    
    if (activeBtn) {
        activeBtn.classList.add('active');
        // Remove active class after a delay
        setTimeout(() => {
            activeBtn.classList.remove('active');
        }, 2000);
    }
}

function showToast(message) {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 1001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('saveFilterModal');
    if (e.target === modal) {
        closeSaveFilterModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeSaveFilterModal();
    }
});

// Search Functionality
function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');

    if (!searchInput) {
        console.error('Search input not found!');
        return;
    }

    if (!searchClear) {
        console.error('Search clear button not found!');
        return;
    }

    console.log('Search initialized successfully');

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        console.log('Search query:', searchQuery);

        if (searchQuery) {
            searchClear.style.display = 'flex';
        } else {
            searchClear.style.display = 'none';
        }

        renderCallsTable();
    });

    // Also trigger search on Enter key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            console.log('Search submitted via Enter key');
            renderCallsTable();
        }
    });
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    
    searchInput.value = '';
    searchQuery = '';
    searchClear.style.display = 'none';
    
    renderCallsTable();
    searchInput.focus();
}

function applySearch(calls) {
    if (!searchQuery) {
        return calls;
    }

    const query = searchQuery.toLowerCase();
    console.log(`Searching for: "${query}" in ${calls.length} calls`);

    const filtered = calls.filter(call => {
        // Search in all visible text fields
        const searchableFields = [
            call.exam_id,
            call.employee_name,
            call.client_name,
            call.clinic_name,
            call.phone,
            call.clinic_provider_address,
            call.procedures,
            call.task_type,
            call.workflow_state,
            call.success_evaluation,
            call.type_of_visit,
            formatPhoneNumber(call.phone),
            formatDate(call.appointment_time),
            formatDate(call.last_attempt_at),
            formatDate(call.next_action_at),
            Array.isArray(call.tag) ? call.tag.join(' ') : ''
        ];

        return searchableFields.some(field => {
            if (!field) return false;
            return field.toString().toLowerCase().includes(query);
        });
    });

    console.log(`Search results: ${filtered.length} calls match "${query}"`);
    return filtered;
}

function matchesDateRange(appointmentTime, dateRanges) {
    if (!appointmentTime) return false;

    const appointmentDate = new Date(appointmentTime);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return dateRanges.some(range => {
        switch (range) {
            case 'today':
                return appointmentDate.toDateString() === today.toDateString();
            case 'tomorrow':
                return appointmentDate.toDateString() === tomorrow.toDateString();
            case 'yesterday':
                return appointmentDate.toDateString() === yesterday.toDateString();
            case 'last7days':
                return appointmentDate >= sevenDaysAgo && appointmentDate < today;
            case 'last30days':
                return appointmentDate >= thirtyDaysAgo && appointmentDate < today;
            case 'older30days':
                return appointmentDate < thirtyDaysAgo;
            default:
                return false;
        }
    });
}

// Helper function to format dates
function formatDate(dateString) {
    if (!dateString) return '';
    try {
        return new Date(dateString).toLocaleString();
    } catch (e) {
        return dateString;
    }
}

// Make Call - Reset and trigger call immediately
async function makeCall(callId) {
    if (!callId) {
        showToast('Error: No call ID provided');
        return;
    }

    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Error: Call not found');
        return;
    }

    try {
        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Show loading state
        showToast('Resetting call...');

        // Call reset-call edge function (reuses the same one we created)
        const response = await fetch(`${config.supabaseUrl}/functions/v1/reset-call`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                callId: callId,
                keepClassification: true  // Keep classification by default
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to reset call');
        }

        // Show success message
        showToast(`Call reset successfully for ${call.employee_name}!`);

        // Reload calls to get updated state
        await loadPendingCalls();

    } catch (error) {
        console.error('Error making call:', error);
        showToast(`Failed: ${error.message}`);
    }
}

// Archive Call - Mark call as inactive
async function archiveCall(callId) {
    if (!callId) {
        showToast('Error: No call ID provided');
        return;
    }

    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Error: Call not found');
        return;
    }

    // Confirm before archiving
    if (!confirm(`Archive call for ${call.employee_name} - ${call.clinic_name}?`)) {
        return;
    }

    try {
        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Show loading state
        showToast('Archiving call...');

        // Call archive-call edge function
        const response = await fetch(`${config.supabaseUrl}/functions/v1/archive-call`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                callId: callId
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to archive call');
        }

        // Show success message
        showToast(`Call archived successfully for ${call.employee_name}!`);

        // Reload calls to get updated state
        await loadPendingCalls();

    } catch (error) {
        console.error('Error archiving call:', error);
        showToast(`Failed: ${error.message}`);
    }
}

// Unarchive Call - Mark call as active
async function unarchiveCall(callId) {
    if (!callId) {
        showToast('Error: No call ID provided');
        return;
    }

    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Error: Call not found');
        return;
    }

    // Confirm before unarchiving
    if (!confirm(`Unarchive call for ${call.employee_name} - ${call.clinic_name}? This will make it active again.`)) {
        return;
    }

    try {
        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Show loading state
        showToast('Unarchiving call...');

        // Call unarchive-call edge function
        const response = await fetch(`${config.supabaseUrl}/functions/v1/unarchive-call`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                callId: callId
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to unarchive call');
        }

        // Show success message
        showToast(`Call unarchived successfully for ${call.employee_name}!`);

        // Reload calls to get updated state
        await loadPendingCalls();

    } catch (error) {
        console.error('Error unarchiving call:', error);
        showToast(`Failed: ${error.message}`);
    }
}

// Toggle Archive/Unarchive based on current state
async function toggleArchiveCall(callId) {
    if (!callId) {
        showToast('Error: No call ID provided');
        return;
    }

    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Error: Call not found');
        return;
    }

    // Check current is_active status and call appropriate function
    if (call.is_active) {
        await archiveCall(callId);
    } else {
        await unarchiveCall(callId);
    }
}

// Delete Call Functions
let deleteCallId = null;

function showDeleteConfirmation(callId, employeeName, clinicName) {
    deleteCallId = callId;
    const modal = document.getElementById('deleteConfirmModal');
    const infoEl = document.getElementById('deleteCallInfo');

    infoEl.textContent = `${employeeName} - ${clinicName}`;
    modal.style.display = 'flex';
}

function closeDeleteConfirmation() {
    const modal = document.getElementById('deleteConfirmModal');
    modal.style.display = 'none';
    deleteCallId = null;
}

// Kill live call(s)
async function killCall(pendingCallId) {
    if (!confirm('Are you sure you want to terminate any live calls for this pending call?')) {
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        await killLiveCallsForPendingCall(pendingCallId, session.access_token);
        showToast('Live call(s) terminated successfully');
    } catch (error) {
        console.error('Error killing live calls:', error);
        showToast('Error: ' + error.message);
    }
}

// Helper function to kill all live calls associated with a pending call
async function killLiveCallsForPendingCall(pendingCallId, accessToken) {
    // Find all active call sessions for this pending call
    const { data: sessions, error: sessionError } = await supabase
        .from('call_sessions')
        .select('call_id, call_status')
        .eq('pending_call_id', pendingCallId)
        .eq('call_status', 'active'); // Only get active calls

    if (sessionError) {
        throw new Error('Failed to fetch call sessions: ' + sessionError.message);
    }

    if (!sessions || sessions.length === 0) {
        console.log('No active calls found for pending call:', pendingCallId);
        return;
    }

    console.log(`Found ${sessions.length} active call(s) to terminate`);

    // Kill each active call
    for (const session of sessions) {
        if (session.call_id) {
            try {
                const response = await fetch(`${config.supabaseUrl}/functions/v1/kill-call`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ callSid: session.call_id })
                });

                if (!response.ok) {
                    const error = await response.json();
                    console.warn(`Failed to kill call ${session.call_id}:`, error);
                    // Continue with other calls even if one fails
                } else {
                    const result = await response.json();
                    console.log(`Killed call ${session.call_id}:`, result);
                }
            } catch (error) {
                console.error(`Error killing call ${session.call_id}:`, error);
                // Continue with other calls even if one fails
            }
        }
    }
}

async function confirmDeleteCall() {
    if (!deleteCallId) {
        showToast('Error: No call ID selected');
        closeDeleteConfirmation();
        return;
    }

    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const killLiveCallCheckbox = document.getElementById('killLiveCallCheckbox');
    const shouldKillLiveCall = killLiveCallCheckbox?.checked || false;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';

    try {
        const { data: { session } } = await supabase.auth.getSession();

        // If checkbox is checked, kill any live calls first
        if (shouldKillLiveCall) {
            confirmBtn.textContent = 'Terminating calls...';
            await killLiveCallsForPendingCall(deleteCallId, session.access_token);
        }

        // Then delete the pending call record
        confirmBtn.textContent = 'Deleting...';
        const response = await fetch(`${config.supabaseUrl}/functions/v1/delete-call`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ callId: deleteCallId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete call');
        }

        const result = await response.json();
        console.log('Call deleted successfully:', result);

        showToast(result.message || 'Call deleted successfully');
        closeDeleteConfirmation();

        // Realtime subscription will handle removing the row automatically

    } catch (error) {
        console.error('Error deleting call:', error);
        showToast('Error: ' + error.message);
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete';
    }
}

// Classification Editor
let currentClassificationId = null;
let currentEditCallId = null;
let ivrActionCounter = 0;
let currentActiveEditTab = 'call'; // Track which tab is active in edit modal

function showClassificationModal(callId = null) {
    const modal = document.getElementById('classificationModal');
    const title = document.getElementById('classificationModalTitle');

    // Reset form
    resetClassificationForm();
    resetEditCallForm();

    if (callId) {
        // Edit existing call
        title.textContent = 'Edit Call';
        currentEditCallId = callId;
        loadEditCallData(callId);
        loadClassificationData(callId);

        // Default to call tab
        switchEditTab('call');
    } else {
        // Add new classification
        title.textContent = 'Add New Classification';
        currentClassificationId = null;
        currentEditCallId = null;
    }

    modal.style.display = 'flex';
}

function closeClassificationModal() {
    document.getElementById('classificationModal').style.display = 'none';
    resetClassificationForm();
}

function resetClassificationForm() {
    currentClassificationId = null;
    ivrActionCounter = 0;

    document.getElementById('classificationPhone').value = '';
    document.getElementById('classificationClinicName').value = '';
    document.getElementById('classificationConfidence').value = '0.95';
    document.getElementById('confidenceValue').textContent = '0.95';

    // Reset radio buttons
    const radios = document.getElementsByName('classificationType');
    radios.forEach(radio => radio.checked = false);

    // Clear IVR actions
    document.getElementById('ivrActionsList').innerHTML = '';
    document.getElementById('ivrActionsSection').style.display = 'none';
}

function resetEditCallForm() {
    currentEditCallId = null;

    document.getElementById('editCallExamId').value = '';
    document.getElementById('editCallEmployeeName').value = '';
    document.getElementById('editCallEmployeeDob').value = '';
    document.getElementById('editCallClientName').value = '';
    document.getElementById('editCallAppointmentTime').value = '';
    document.getElementById('editCallTypeOfVisit').value = '';
    document.getElementById('editCallProcedures').value = '';
    document.getElementById('editCallClinicName').value = '';
    document.getElementById('editCallPhone').value = '';
    document.getElementById('editCallClinicAddress').value = '';
    document.getElementById('editCallClinicTimezone').value = '';
    document.getElementById('editCallTaskType').value = '';
}

function switchEditTab(tabName) {
    currentActiveEditTab = tabName;

    // Get tab buttons and content divs
    const callTab = document.querySelector('.modal-tab:nth-child(1)');
    const classificationTab = document.querySelector('.modal-tab:nth-child(2)');
    const callContent = document.getElementById('editCallTab');
    const classificationContent = document.getElementById('editClassificationTab');

    if (tabName === 'call') {
        // Show call tab
        callTab.classList.add('active');
        classificationTab.classList.remove('active');
        callContent.style.display = 'block';
        classificationContent.style.display = 'none';
    } else if (tabName === 'classification') {
        // Show classification tab
        callTab.classList.remove('active');
        classificationTab.classList.add('active');
        callContent.style.display = 'none';
        classificationContent.style.display = 'block';
    }
}

async function loadEditCallData(callId) {
    try {
        const call = allCalls.find(c => c.id === callId);
        if (!call) {
            showToast('Call not found');
            return;
        }

        // Populate all call fields
        document.getElementById('editCallExamId').value = call.exam_id || '';
        document.getElementById('editCallEmployeeName').value = call.employee_name || '';
        document.getElementById('editCallEmployeeDob').value = call.employee_dob || '';
        document.getElementById('editCallClientName').value = call.client_name || '';

        // Format appointment time for datetime-local input
        if (call.appointment_time) {
            const appointmentDate = new Date(call.appointment_time);
            const localDatetime = new Date(appointmentDate.getTime() - (appointmentDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            document.getElementById('editCallAppointmentTime').value = localDatetime;
        }

        document.getElementById('editCallTypeOfVisit').value = call.type_of_visit || '';
        document.getElementById('editCallProcedures').value = call.procedures || '';
        document.getElementById('editCallClinicName').value = call.clinic_name || '';
        document.getElementById('editCallPhone').value = call.phone || '';
        document.getElementById('editCallClinicAddress').value = call.clinic_provider_address || '';
        document.getElementById('editCallClinicTimezone').value = call.clinic_timezone || '';
        document.getElementById('editCallTaskType').value = call.task_type || '';
    } catch (error) {
        console.error('Error loading call data:', error);
        showToast('Error loading call data');
    }
}

async function loadClassificationData(callId) {
    try {
        const call = allCalls.find(c => c.id === callId);
        if (!call) {
            showToast('Call not found');
            return;
        }

        // Populate phone and clinic name from call
        document.getElementById('classificationPhone').value = call.phone || '';
        document.getElementById('classificationClinicName').value = call.clinic_name || '';

        // If there's an existing classification, load it
        if (call.classification_id) {
            currentClassificationId = call.classification_id;

            const { data: classification, error } = await supabase
                .from('call_classifications')
                .select('*')
                .eq('id', call.classification_id)
                .single();

            if (error) throw error;

            if (classification) {
                // Set classification type
                const typeRadio = document.querySelector(`input[name="classificationType"][value="${classification.classification_type}"]`);
                if (typeRadio) {
                    typeRadio.checked = true;
                    handleClassificationTypeChange();
                }

                // Set confidence
                document.getElementById('classificationConfidence').value = classification.classification_confidence || 0.95;
                document.getElementById('confidenceValue').textContent = (classification.classification_confidence || 0.95).toFixed(2);

                // Load IVR actions if present
                if (classification.ivr_actions && Array.isArray(classification.ivr_actions)) {
                    classification.ivr_actions.forEach(action => {
                        addIvrAction(action);
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error loading classification:', error);
        showToast('Error loading classification data');
    }
}

function handleClassificationTypeChange() {
    const selectedType = document.querySelector('input[name="classificationType"]:checked')?.value;
    const ivrActionsSection = document.getElementById('ivrActionsSection');

    if (selectedType === 'ivr_only' || selectedType === 'ivr_then_human') {
        ivrActionsSection.style.display = 'block';
    } else {
        ivrActionsSection.style.display = 'none';
    }
}

function addIvrAction(existingAction = null) {
    const actionsList = document.getElementById('ivrActionsList');
    const actionId = ivrActionCounter++;

    const actionHtml = `
        <div class="ivr-action-item" data-action-id="${actionId}">
            <div class="action-fields">
                <div class="form-group">
                    <label>Action Type</label>
                    <select class="action-type" onchange="handleActionTypeChange(${actionId})">
                        <option value="dtmf" ${existingAction?.action_type === 'dtmf' ? 'selected' : ''}>DTMF (Press Button)</option>
                        <option value="speech" ${existingAction?.action_type === 'speech' ? 'selected' : ''}>Speech</option>
                        <option value="transfer" ${existingAction?.action_type === 'transfer' ? 'selected' : ''}>Transfer</option>
                        <option value="wait" ${existingAction?.action_type === 'wait' ? 'selected' : ''}>Wait</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="action-value-label">Value</label>
                    <input type="text" class="action-value" placeholder="e.g., 3" value="${existingAction?.action_value || ''}">
                </div>
                <div class="form-group">
                    <label>Timing (ms)</label>
                    <input type="number" class="action-timing" placeholder="e.g., 15000" value="${existingAction?.timing_ms || ''}">
                </div>
            </div>
            <button type="button" class="remove-action-btn" onclick="removeIvrAction(${actionId})">×</button>
        </div>
    `;

    actionsList.insertAdjacentHTML('beforeend', actionHtml);

    // Trigger type change to update label
    if (existingAction) {
        handleActionTypeChange(actionId);
    }
}

function handleActionTypeChange(actionId) {
    const actionItem = document.querySelector(`.ivr-action-item[data-action-id="${actionId}"]`);
    const typeSelect = actionItem.querySelector('.action-type');
    const valueLabel = actionItem.querySelector('.action-value-label');
    const valueInput = actionItem.querySelector('.action-value');

    const type = typeSelect.value;

    switch(type) {
        case 'dtmf':
            valueLabel.textContent = 'Button';
            valueInput.placeholder = 'e.g., 3';
            break;
        case 'speech':
            valueLabel.textContent = 'Speech Text';
            valueInput.placeholder = 'e.g., operator';
            break;
        case 'transfer':
            valueLabel.textContent = 'Transfer To';
            valueInput.placeholder = 'e.g., connect_vapi';
            valueInput.value = 'connect_vapi';
            break;
        case 'wait':
            valueLabel.textContent = 'Duration (ms)';
            valueInput.placeholder = 'e.g., 5000';
            break;
    }
}

function removeIvrAction(actionId) {
    const actionItem = document.querySelector(`.ivr-action-item[data-action-id="${actionId}"]`);
    if (actionItem) {
        actionItem.remove();
    }
}

async function saveClassification() {
    try {
        // Validate required fields
        const phone = document.getElementById('classificationPhone').value.trim();
        const clinicName = document.getElementById('classificationClinicName').value.trim();
        const selectedType = document.querySelector('input[name="classificationType"]:checked');
        const confidence = parseFloat(document.getElementById('classificationConfidence').value);

        if (!phone) {
            showToast('Phone number is required');
            return;
        }

        if (!selectedType) {
            showToast('Please select a classification type');
            return;
        }

        const classificationType = selectedType.value;

        // Collect IVR actions if needed
        let ivrActions = null;
        if (classificationType === 'ivr_only' || classificationType === 'ivr_then_human') {
            ivrActions = [];
            const actionItems = document.querySelectorAll('.ivr-action-item');

            actionItems.forEach(item => {
                const actionType = item.querySelector('.action-type').value;
                const actionValue = item.querySelector('.action-value').value.trim();
                const timingMs = parseInt(item.querySelector('.action-timing').value);

                if (actionValue && !isNaN(timingMs)) {
                    ivrActions.push({
                        action_type: actionType,
                        action_value: actionValue,
                        timing_ms: timingMs
                    });
                }
            });

            if (ivrActions.length === 0) {
                showToast('Please add at least one IVR action');
                return;
            }
        }

        // Disable save button
        const saveBtn = document.getElementById('saveClassificationBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Prepare classification data
        const classificationData = {
            phone_number: phone,
            clinic_name: clinicName,
            classification_type: classificationType,
            classification_confidence: confidence,
            ivr_actions: ivrActions,
            classification_id: currentClassificationId
        };

        // Call edge function to save
        const response = await fetch(`${config.supabaseUrl}/functions/v1/save-classification`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(classificationData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to save classification');
        }

        showToast(currentClassificationId ? 'Classification updated successfully!' : 'Classification created successfully!');
        closeClassificationModal();

        // Reload calls to show updated classification
        await loadPendingCalls();

    } catch (error) {
        console.error('Error saving classification:', error);
        showToast(`Failed to save: ${error.message}`);
    } finally {
        const saveBtn = document.getElementById('saveClassificationBtn');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Classification';
    }
}

async function saveEditModal() {
    try {
        // Determine which tab is active and save accordingly
        if (currentActiveEditTab === 'call') {
            await saveEditCall();
        } else if (currentActiveEditTab === 'classification') {
            await saveClassification();
        }
    } catch (error) {
        console.error('Error saving:', error);
        showToast(`Failed to save: ${error.message}`);
    }
}

async function saveEditCall() {
    try {
        // Validate required fields
        const examId = document.getElementById('editCallExamId').value.trim();
        const employeeName = document.getElementById('editCallEmployeeName').value.trim();
        const employeeDob = document.getElementById('editCallEmployeeDob').value;
        const clientName = document.getElementById('editCallClientName').value.trim();
        const appointmentTime = document.getElementById('editCallAppointmentTime').value;
        const typeOfVisit = document.getElementById('editCallTypeOfVisit').value;
        const procedures = document.getElementById('editCallProcedures').value.trim();
        const clinicName = document.getElementById('editCallClinicName').value.trim();
        const phone = document.getElementById('editCallPhone').value.trim();
        const clinicAddress = document.getElementById('editCallClinicAddress').value.trim();
        const clinicTimezone = document.getElementById('editCallClinicTimezone').value;
        const taskType = document.getElementById('editCallTaskType').value;

        if (!examId || !employeeName || !employeeDob || !clientName || !appointmentTime ||
            !typeOfVisit || !clinicName || !phone || !clinicTimezone || !taskType) {
            showToast('Please fill in all required fields');
            return;
        }

        // Disable save button
        const saveBtn = document.getElementById('saveEditBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        // Prepare update data
        const updateData = {
            exam_id: examId,
            employee_name: employeeName,
            employee_dob: employeeDob,
            client_name: clientName,
            appointment_time: appointmentTime,
            type_of_visit: typeOfVisit,
            procedures: procedures,
            clinic_name: clinicName,
            phone: phone,
            clinic_provider_address: clinicAddress,
            clinic_timezone: clinicTimezone,
            task_type: taskType
        };

        // Update the call in Supabase
        const { error } = await supabase
            .from('pending_calls')
            .update(updateData)
            .eq('id', currentEditCallId);

        if (error) throw error;

        showToast('Call updated successfully!');
        closeClassificationModal();

        // Reload calls to show updated data
        await loadPendingCalls();

    } catch (error) {
        console.error('Error saving call:', error);
        showToast(`Failed to save call: ${error.message}`);
    } finally {
        const saveBtn = document.getElementById('saveEditBtn');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    }
}

// Initialize classification type change handlers
document.addEventListener('DOMContentLoaded', () => {
    // Add change listeners to classification type radios
    const typeRadios = document.getElementsByName('classificationType');
    typeRadios.forEach(radio => {
        radio.addEventListener('change', handleClassificationTypeChange);
    });

    // Add input listener to confidence slider
    const confidenceSlider = document.getElementById('classificationConfidence');
    if (confidenceSlider) {
        confidenceSlider.addEventListener('input', (e) => {
            document.getElementById('confidenceValue').textContent = parseFloat(e.target.value).toFixed(2);
        });
    }

    // Close modal when clicking outside
    const modal = document.getElementById('classificationModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeClassificationModal();
            }
        });
    }

    // Close new call modal when clicking outside
    const newCallModal = document.getElementById('newCallModal');
    if (newCallModal) {
        newCallModal.addEventListener('click', (e) => {
            if (e.target === newCallModal) {
                closeNewCallModal();
            }
        });
    }
});

// New Pending Call Modal Functions
function showNewCallModal() {
    const modal = document.getElementById('newCallModal');
    resetNewCallForm();
    modal.style.display = 'flex';
}

function closeNewCallModal() {
    document.getElementById('newCallModal').style.display = 'none';
    resetNewCallForm();
}

function resetNewCallForm() {
    document.getElementById('newCallExamId').value = '';
    document.getElementById('newCallEmployeeName').value = '';
    document.getElementById('newCallEmployeeDob').value = '';
    document.getElementById('newCallClientName').value = '';
    document.getElementById('newCallAppointmentTime').value = '';
    document.getElementById('newCallTypeOfVisit').value = '';
    document.getElementById('newCallProcedures').value = '';
    document.getElementById('newCallClinicName').value = '';
    document.getElementById('newCallPhone').value = '';
    document.getElementById('newCallClinicAddress').value = '';
    document.getElementById('newCallClinicTimezone').value = 'America/New_York';
    document.getElementById('newCallTaskType').value = 'records_request';
}

async function saveNewCall() {
    try {
        // Get form values
        const examId = document.getElementById('newCallExamId').value.trim();
        const employeeName = document.getElementById('newCallEmployeeName').value.trim();
        const employeeDob = document.getElementById('newCallEmployeeDob').value;
        const clientName = document.getElementById('newCallClientName').value.trim();
        const appointmentTime = document.getElementById('newCallAppointmentTime').value;
        const typeOfVisit = document.getElementById('newCallTypeOfVisit').value;
        const procedures = document.getElementById('newCallProcedures').value.trim();
        const clinicName = document.getElementById('newCallClinicName').value.trim();
        const phone = document.getElementById('newCallPhone').value.trim();
        const clinicAddress = document.getElementById('newCallClinicAddress').value.trim();
        const clinicTimezone = document.getElementById('newCallClinicTimezone').value;
        const taskType = document.getElementById('newCallTaskType').value;

        // Validate required fields
        if (!examId) {
            showToast('Exam ID is required');
            return;
        }
        if (!employeeName) {
            showToast('Employee Name is required');
            return;
        }
        if (!employeeDob) {
            showToast('Employee Date of Birth is required');
            return;
        }
        if (!clientName) {
            showToast('Client Name is required');
            return;
        }
        if (!appointmentTime) {
            showToast('Appointment Time is required');
            return;
        }
        if (!typeOfVisit) {
            showToast('Type of Visit is required');
            return;
        }
        if (!clinicName) {
            showToast('Clinic Name is required');
            return;
        }
        if (!phone) {
            showToast('Phone Number is required');
            return;
        }

        // Validate phone format
        const phoneRegex = /^\+1[0-9]{10}$/;
        if (!phoneRegex.test(phone)) {
            showToast('Phone must be in format +16095550123');
            return;
        }

        // Disable save button
        const saveBtn = document.getElementById('saveNewCallBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating...';

        // Prepare data for insert
        const newCallData = {
            exam_id: examId,
            employee_name: employeeName,
            employee_dob: employeeDob,
            client_name: clientName,
            appointment_time: appointmentTime,
            type_of_visit: typeOfVisit,
            procedures: procedures || null,
            clinic_name: clinicName,
            phone: phone,
            clinic_provider_address: clinicAddress || null,
            clinic_timezone: clinicTimezone,
            task_type: taskType,
            workflow_state: 'pending',
            retry_count: 0,
            max_retries: 3,
            is_active: true,
            next_action_at: new Date().toISOString()
        };

        // Insert into database
        const { data, error } = await supabase
            .from('pending_calls')
            .insert([newCallData])
            .select()
            .single();

        if (error) {
            throw error;
        }

        // Success!
        showToast('Call created successfully!');
        closeNewCallModal();

        // Reload the calls list
        await loadPendingCalls();

    } catch (error) {
        console.error('Error creating call:', error);
        showToast('Error creating call: ' + (error.message || 'Unknown error'));

        // Re-enable save button
        const saveBtn = document.getElementById('saveNewCallBtn');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Create Call';
    }
}

// ============================================
// IMPORT CALLS FUNCTIONALITY
// ============================================

// Import state
let importState = {
    currentStep: 1,
    fileData: null,
    fileName: '',
    headers: [],
    rows: [],
    columnMapping: {},
    transformations: {},
    selectedRows: [],
    validationResults: []
};

// Column mapping configuration with aliases and fuzzy matching
const COLUMN_MAPPINGS = {
    'exam_id': ['ExamIDExternal', 'Exam ID', 'ExamID', 'ID'],
    'employee_name': ['FullName', 'Employee Name', 'Name', 'Employee'],
    'employee_dob': ['Birthdate', 'DOB', 'Date of Birth', 'Birth Date'],
    'employee_phone_number': ['EmployeePhone', 'Employee Phone', 'Employee Phone Number', 'Patient Phone', 'Patient Phone Number', 'Phone Number'],
    'employee_address': ['EmployeeAddress', 'Employee Address', 'Patient Address', 'Home Address'],
    'client_name': ['Client', 'Client Name', 'Company'],
    'appointment_time': ['ExamDateTime', 'Appointment Time', 'Appointment', 'DateTime', 'Date Time'],
    'type_of_visit': ['AppointmentType', 'Visit Type', 'Type', 'Appointment Type'],
    'phone': ['ProviderPhone', 'Phone', 'Phone Number', 'Clinic Phone'],
    'clinic_name': ['Provider', 'Clinic', 'Clinic Name', 'Provider Name'],
    'clinic_provider_address': ['clinicaddress', 'Clinic Address', 'Address', 'Provider Address'],
    'procedures': ['ProcedureNames', 'Procedures', 'Procedure'],
    'clinic_timezone': ['TimeZone', 'Timezone', 'TZ'],
    'task_type': ['TaskType', 'Task', 'Type']
};

// Transformation rules
const TRANSFORMATION_RULES = {
    task_type: {
        'records': 'records_request',
        'Records': 'records_request',
        'schedule': 'schedule',
        'Schedule': 'schedule',
        'kit': 'kit_confirmation',
        'Kit': 'kit_confirmation'
    },
    type_of_visit: {
        'walk-in': 'walk-in',
        'walkin': 'walk-in',
        'walk in': 'walk-in',
        'Walk-in': 'walk-in',
        'Walk-in (clinic required)': 'walk-in',
        'Walk-in (employee/candidate preference)': 'walk-in',
        'appointment': 'appointment',
        'Appointment': 'appointment',
        'appt': 'appointment'
    },
    clinic_timezone: {
        'Eastern': 'America/New_York',
        'EST': 'America/New_York',
        'Central': 'America/Chicago',
        'CST': 'America/Chicago',
        'Mountain': 'America/Denver',
        'MST': 'America/Denver',
        'Pacific': 'America/Los_Angeles',
        'PST': 'America/Los_Angeles'
    },
    procedures: {
        // Transform to simpler names
        'Consent to Use or Disclose Health Information Form': 'Consent form',
        'Custom Panel Quest Diagnostics - 20453N': 'Drug Screen',
        'Custom Panel Quest Diagnostics - 41748N': 'Drug Screen',
        'Drug Collection (Urine)': 'Urine Drug Collection',
        'Drug Collection (Urine) - Regulated': 'Urine Drug Collection',
        'Drug Screen (Urine) 10 Panel': 'Drug Screen',
        'Drug Screen (Urine) Regulated': 'Urine Drug Collection',
        'Drug Screening - (729625) U10-Bund+SVT': 'Drug Screen',
        'Heplisav-B Vaccine Second Dose': 'Heplisav-B Vaccine',
        'Medical Examination Report/Certificate Page': 'Medical Examination Report',
        'OSHA Medical Questionnaire': 'OSHA Respiratory Protection Quesitonnaire',
        'Physical Ability Assessment - Level 1': 'Physical Ability Assessment',
        'Respirator Fit Test - Quantitative': 'Respirator Fit Test',
        'TB Test - Blood Test (Quantiferon Gold)': 'TB Blood Test',
        'TB Test - Blood Test - Clinic (Quantiferon Gold)': 'TB Blood Test',
        'TB Test - PPD Skin Test': 'TB Skin Test',
        'Varicella Vaccine - Full Series': 'Varicella Vaccine',
        'Venipuncture - Clinic Site Collection': 'Venipuncture',
        'Venipuncture - Lab Site Collection': 'Venipuncture - Clinic Site Collection',
        'Vision Screen - Jaeger (Near)': 'Jaeger Vision Screening',
        'Vision Screening - Titmus': 'Vision Titmus',

        // Remove these procedures (map to empty string)
        'Copy of Photo ID': '',
        'Rescheduled Appointment Requested by Patient': '',
        'Vaccine Administration': '',
        'Whisper Test': '',
        'Whisper Test (No Audiogram)': ''
    }
};

// Phone number normalization function
function normalizePhoneNumber(phone) {
    // Return null for empty/null input
    if (!phone || phone.trim() === '') {
        return null;
    }

    // Extract only digits
    const digitsOnly = String(phone).replace(/\D/g, '');

    // Handle +1 country code (11 digits starting with 1)
    let cleanDigits = digitsOnly;
    if (digitsOnly.length === 11 && digitsOnly[0] === '1') {
        cleanDigits = digitsOnly.substring(1);
    }

    // Must be exactly 10 digits for US phone number
    if (cleanDigits.length !== 10) {
        console.warn(`Invalid phone number (not 10 digits): ${phone}`);
        return phone; // Return original if invalid
    }

    // Format as (XXX) XXX-XXXX
    const areaCode = cleanDigits.substring(0, 3);
    const prefix = cleanDigits.substring(3, 6);
    const lineNumber = cleanDigits.substring(6, 10);

    return `(${areaCode}) ${prefix}-${lineNumber}`;
}

// Show import modal
function showImportModal() {
    const modal = document.getElementById('importModal');
    resetImportState();
    modal.style.display = 'flex';
}

// Close import modal
function closeImportModal() {
    document.getElementById('importModal').style.display = 'none';
    resetImportState();
}

// Reset import state
function resetImportState() {
    // Completely reset the state object
    importState = {
        currentStep: 1,
        fileData: null,
        fileName: '',
        headers: [],
        rows: [],
        columnMapping: {},
        transformations: {},
        selectedRows: [],
        validationResults: []
    };

    // Reset file input
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.value = '';

    // Clear all container contents from previous imports
    const containers = [
        'columnMappingContainer',
        'rowSelectionContainer',
        'validationSummary',
        'previewContainer',
        'importResults'
    ];

    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) container.innerHTML = '';
    });

    // Reset progress indicators
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const importResults = document.getElementById('importResults');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '';
    if (importResults) importResults.style.display = 'none';

    // Hide file info
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) fileInfo.style.display = 'none';

    // Show step 1 and hide all others (including processing step)
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`importStep${i}`);
        if (step) step.style.display = i === 1 ? 'block' : 'none';
    }
    const processingStep = document.getElementById('importStepProcessing');
    if (processingStep) processingStep.style.display = 'none';

    // Reset buttons properly
    const backBtn = document.getElementById('importBackBtn');
    const nextBtn = document.getElementById('importNextBtn');
    if (backBtn) {
        backBtn.style.display = 'none';
    }
    if (nextBtn) {
        nextBtn.textContent = 'Next';
        nextBtn.style.display = 'inline-block';
        nextBtn.disabled = true;
    }

    console.log('Import state reset:', importState);
}

// Navigate to next step
async function importNextStep() {
    console.log('importNextStep called, current step:', importState.currentStep, 'has fileData:', !!importState.fileData);

    if (importState.currentStep === 1 && importState.fileData) {
        console.log('Building column mapping...');
        buildColumnMapping();
        importState.currentStep = 2;
        updateStepDisplay();
    } else if (importState.currentStep === 2) {
        console.log('Applying column mapping and processing data...');
        applyColumnMapping();

        // Show processing step if timezone detection is needed
        const needsTimezoneDetection = await showProcessingStepIfNeeded();

        // Build row selection (old step 4, now step 3)
        console.log('Building row selection...');
        buildRowSelection();
        importState.currentStep = 3;
        updateStepDisplay();
    } else if (importState.currentStep === 3) {
        if (importState.selectedRows.length === 0) {
            showToast('Please select at least one row to import');
            return;
        }
        console.log('Building preview...');
        buildPreview();
        importState.currentStep = 4;
        updateStepDisplay();
    } else if (importState.currentStep === 4) {
        console.log('Starting import...');
        startImport();
        importState.currentStep = 5;
        updateStepDisplay();
    } else {
        console.warn('importNextStep: unexpected state', {
            currentStep: importState.currentStep,
            hasFileData: !!importState.fileData
        });
    }
}

// Show processing step if timezone detection is needed
async function showProcessingStepIfNeeded() {
    // Check if timezone column is mapped
    const timezoneColIndex = Object.entries(importState.columnMapping)
        .find(([_, field]) => field === 'clinic_timezone')?.[0];
    const addressColIndex = Object.entries(importState.columnMapping)
        .find(([_, field]) => field === 'clinic_provider_address')?.[0];

    if (!timezoneColIndex || !addressColIndex) {
        // No timezone or address column, no detection needed
        return false;
    }

    // Check if any rows are missing timezone
    const missingCount = importState.rows.filter(row => !row[timezoneColIndex] || row[timezoneColIndex].toString().trim() === '').length;

    if (missingCount === 0) {
        // No missing timezones
        return false;
    }

    // Show processing step
    console.log(`Showing processing step for ${missingCount} rows needing timezone detection`);
    const processingStep = document.getElementById('importStepProcessing');
    const processingMessage = document.getElementById('processingMessage');

    // Hide all regular steps
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`importStep${i}`);
        if (step) step.style.display = 'none';
    }

    // Show processing step
    if (processingStep) processingStep.style.display = 'block';
    if (processingMessage) processingMessage.textContent = `Detecting timezones for ${missingCount} ${missingCount === 1 ? 'address' : 'addresses'}...`;

    // Hide buttons during processing
    const backBtn = document.getElementById('importBackBtn');
    const nextBtn = document.getElementById('importNextBtn');
    if (backBtn) backBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';

    // Run timezone detection
    await detectTimezonesAuto();

    return true;
}

// Navigate to previous step
function importPreviousStep() {
    if (importState.currentStep > 1) {
        importState.currentStep--;
        updateStepDisplay();
    }
}

// Update step display
function updateStepDisplay() {
    // Hide all steps (including processing step)
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`importStep${i}`);
        if (step) step.style.display = 'none';
    }
    const processingStep = document.getElementById('importStepProcessing');
    if (processingStep) processingStep.style.display = 'none';

    // Show current step
    const currentStepEl = document.getElementById(`importStep${importState.currentStep}`);
    if (currentStepEl) currentStepEl.style.display = 'block';

    // Update buttons
    const backBtn = document.getElementById('importBackBtn');
    const nextBtn = document.getElementById('importNextBtn');

    backBtn.style.display = importState.currentStep > 1 && importState.currentStep < 5 ? 'inline-block' : 'none';

    if (importState.currentStep === 4) {
        nextBtn.textContent = 'Import';
    } else if (importState.currentStep === 5) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.textContent = 'Next';
        nextBtn.style.display = 'inline-block';
    }

    // Enable/disable next button based on current step
    if (importState.currentStep === 1) {
        nextBtn.disabled = !importState.fileData;
    } else {
        nextBtn.disabled = false;
    }
}

// Handle file upload
function handleFileUpload(event) {
    const file = event.target.files[0];
    processFile(file);
}

// Process file (used by both file input and drag & drop)
function processFile(file) {
    if (!file) return;

    console.log('Processing file:', file.name, 'Current step:', importState.currentStep);

    // Validate file type
    const validTypes = ['.xlsx', '.xls', '.csv'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    if (!validTypes.includes(fileExt)) {
        showToast('Invalid file type. Please upload .xlsx, .xls, or .csv files');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // Get first sheet
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

            if (jsonData.length < 2) {
                showToast('File must contain at least a header row and one data row');
                return;
            }

            // Store file data
            importState.fileName = file.name;
            importState.headers = jsonData[0];
            importState.rows = jsonData.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));
            importState.fileData = jsonData;

            console.log('File data stored:', {
                fileName: importState.fileName,
                headers: importState.headers,
                rowCount: importState.rows.length,
                currentStep: importState.currentStep,
                hasFileData: !!importState.fileData
            });

            // Show file info
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('fileStats').textContent = `${importState.headers.length} columns, ${importState.rows.length} rows`;
            document.getElementById('fileInfo').style.display = 'block';

            // Enable next button
            const nextBtn = document.getElementById('importNextBtn');
            if (nextBtn) {
                nextBtn.disabled = false;
                console.log('Next button enabled, disabled =', nextBtn.disabled, 'display =', nextBtn.style.display);
            }

        } catch (error) {
            console.error('Error parsing file:', error);
            showToast('Error parsing file: ' + error.message);
        }
    };

    reader.readAsArrayBuffer(file);
}

// Initialize drag and drop for file upload
function initializeFileUploadDragDrop() {
    const dropArea = document.getElementById('fileUploadArea');
    if (!dropArea) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop area when dragging over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.remove('drag-over');
        }, false);
    });

    // Handle dropped files
    dropArea.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
        processFile(files[0]);
    }
}

// Format Excel date serial for display
function formatExcelDate(value, fieldType) {
    if (typeof value !== 'number') return value;

    try {
        if (fieldType === 'employee_dob') {
            // Date only (no time)
            const date = XLSX.SSF.parse_date_code(value);
            return `${date.m}/${date.d}/${date.y}`;
        } else if (fieldType === 'appointment_time') {
            // Date and time
            const jsDate = new Date((value - 25569) * 86400 * 1000);
            return jsDate.toLocaleString();
        }
    } catch (e) {
        console.error('Error formatting Excel date:', e);
    }

    return value;
}

// Calculate similarity between two strings (simple fuzzy matching)
function stringSimilarity(str1, str2) {
    str1 = str1.toLowerCase().trim();
    str2 = str2.toLowerCase().trim();

    if (str1 === str2) return 100;

    // Check if one contains the other
    if (str1.includes(str2) || str2.includes(str1)) return 85;

    // Simple character-based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    let matches = 0;
    for (let char of shorter) {
        if (longer.includes(char)) matches++;
    }

    return Math.round((matches / longer.length) * 100);
}

// Find best matching database field for a file column
function findBestMatch(fileColumn) {
    let bestMatch = { field: null, confidence: 0 };

    for (const [dbField, aliases] of Object.entries(COLUMN_MAPPINGS)) {
        for (const alias of aliases) {
            const similarity = stringSimilarity(fileColumn, alias);
            if (similarity > bestMatch.confidence) {
                bestMatch = { field: dbField, confidence: similarity };
            }
        }
    }

    return bestMatch.confidence >= 70 ? bestMatch : { field: null, confidence: 0 };
}

// Build column mapping UI
function buildColumnMapping() {
    const container = document.getElementById('columnMappingContainer');
    let html = '';

    importState.headers.forEach((header, index) => {
        const match = findBestMatch(header);
        const isHighConfidence = match.confidence >= 90;
        const isMediumConfidence = match.confidence >= 75 && match.confidence < 90;

        // Auto-set mapping if high confidence
        if (isHighConfidence && match.field) {
            importState.columnMapping[index] = match.field;
        }

        const confidenceBadge = match.confidence > 0
            ? `<span class="confidence-badge ${isHighConfidence ? 'confidence-high' : isMediumConfidence ? 'confidence-medium' : 'confidence-low'}">${match.confidence}% match</span>`
            : '';

        html += `
            <div class="column-mapping-row ${isHighConfidence ? 'suggested' : ''}">
                <div class="column-label">
                    ${header || `Column ${index + 1}`}
                    ${confidenceBadge}
                </div>
                <div class="column-arrow">→</div>
                <div>
                    <select class="column-select" onchange="updateColumnMapping(${index}, this.value)">
                        <option value="">-- Skip this column --</option>
                        <option value="exam_id" ${match.field === 'exam_id' ? 'selected' : ''}>Exam ID *</option>
                        <option value="employee_name" ${match.field === 'employee_name' ? 'selected' : ''}>Employee Name *</option>
                        <option value="employee_dob" ${match.field === 'employee_dob' ? 'selected' : ''}>Employee DOB *</option>
                        <option value="employee_phone_number" ${match.field === 'employee_phone_number' ? 'selected' : ''}>Employee Phone Number</option>
                        <option value="employee_address" ${match.field === 'employee_address' ? 'selected' : ''}>Employee Address</option>
                        <option value="client_name" ${match.field === 'client_name' ? 'selected' : ''}>Client Name *</option>
                        <option value="appointment_time" ${match.field === 'appointment_time' ? 'selected' : ''}>Appointment Time *</option>
                        <option value="type_of_visit" ${match.field === 'type_of_visit' ? 'selected' : ''}>Type of Visit *</option>
                        <option value="phone" ${match.field === 'phone' ? 'selected' : ''}>Phone *</option>
                        <option value="clinic_name" ${match.field === 'clinic_name' ? 'selected' : ''}>Clinic Name *</option>
                        <option value="clinic_provider_address" ${match.field === 'clinic_provider_address' ? 'selected' : ''}>Clinic Address</option>
                        <option value="procedures" ${match.field === 'procedures' ? 'selected' : ''}>Procedures</option>
                        <option value="clinic_timezone" ${match.field === 'clinic_timezone' ? 'selected' : ''}>Clinic Timezone *</option>
                        <option value="task_type" ${match.field === 'task_type' ? 'selected' : ''}>Task Type *</option>
                    </select>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Update column mapping when user changes selection
function updateColumnMapping(columnIndex, dbField) {
    if (dbField) {
        importState.columnMapping[columnIndex] = dbField;
    } else {
        delete importState.columnMapping[columnIndex];
    }
    console.log('Column mapping updated:', importState.columnMapping);
}

// Apply column mapping to create mapped data
function applyColumnMapping() {
    // This will be used in later steps
    console.log('Applying column mapping:', importState.columnMapping);
}

// Automatically detect timezones from addresses (called during processing step)
async function detectTimezonesAuto() {
    try {
        // Get column indices
        const addressColIndex = Object.entries(importState.columnMapping)
            .find(([_, field]) => field === 'clinic_provider_address')?.[0];
        const timezoneColIndex = Object.entries(importState.columnMapping)
            .find(([_, field]) => field === 'clinic_timezone')?.[0];

        if (!addressColIndex || !timezoneColIndex) {
            console.log('No address or timezone column mapped, skipping timezone detection');
            return;
        }

        // Collect addresses that need timezone detection
        const addressesToDetect = [];
        const rowIndices = [];

        importState.rows.forEach((row, index) => {
            const timezone = row[timezoneColIndex];
            const address = row[addressColIndex];

            if ((!timezone || timezone.toString().trim() === '') && address && address.toString().trim() !== '') {
                addressesToDetect.push(address.toString().trim());
                rowIndices.push(index);
            }
        });

        if (addressesToDetect.length === 0) {
            console.log('No addresses need timezone detection');
            return;
        }

        console.log(`Auto-detecting timezones for ${addressesToDetect.length} addresses`);

        // Call edge function
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${config.supabaseUrl}/functions/v1/detect-timezone`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                addresses: addressesToDetect
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to detect timezones');
        }

        const result = await response.json();
        console.log('Timezone detection results:', result);

        // Apply detected timezones to rows
        result.results.forEach((item, i) => {
            if (item.timezone) {
                const rowIndex = rowIndices[i];
                importState.rows[rowIndex][timezoneColIndex] = item.timezone;
            }
        });

        console.log(`Successfully detected ${result.summary.successful} timezones, ${result.summary.failed} failed`);

    } catch (error) {
        console.error('Error auto-detecting timezones:', error);
        showToast(`Timezone detection failed: ${error.message}`);
    }
}

// Apply transformations to data
function applyTransformations() {
    importState.transformations = TRANSFORMATION_RULES;
    console.log('Transformations applied');
}

// Build row selection UI
function buildRowSelection() {
    const container = document.getElementById('rowSelectionContainer');

    // Get mapped headers for display
    const displayHeaders = Object.entries(importState.columnMapping)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([colIndex, dbField]) => ({ colIndex: parseInt(colIndex), dbField }));

    let html = '<table class="row-selection-table"><thead><tr>';
    html += '<th><input type="checkbox" class="row-checkbox" onchange="toggleAllRows(this.checked)"></th>';
    html += '<th>Row</th>';
    displayHeaders.forEach(({ dbField }) => {
        html += `<th>${dbField.replace(/_/g, ' ')}</th>`;
    });
    html += '</tr></thead><tbody>';

    importState.rows.forEach((row, rowIndex) => {
        html += '<tr>';
        html += `<td><input type="checkbox" class="row-checkbox" onchange="toggleRowSelection(${rowIndex}, this.checked)"></td>`;
        html += `<td>${rowIndex + 1}</td>`;
        displayHeaders.forEach(({ colIndex, dbField }) => {
            let value = row[colIndex] || '';
            // Format dates for display
            value = formatExcelDate(value, dbField);
            html += `<td>${value}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Reset selected rows
    importState.selectedRows = [];
    updateSelectionCount();
}

// Toggle all rows
function toggleAllRows(checked) {
    const checkboxes = document.querySelectorAll('#rowSelectionContainer .row-checkbox');
    importState.selectedRows = checked ? importState.rows.map((_, i) => i) : [];
    checkboxes.forEach((checkbox, index) => {
        if (index > 0) checkbox.checked = checked; // Skip the header checkbox
    });
    updateSelectionCount();
}

// Toggle single row selection
function toggleRowSelection(rowIndex, checked) {
    if (checked) {
        if (!importState.selectedRows.includes(rowIndex)) {
            importState.selectedRows.push(rowIndex);
        }
    } else {
        importState.selectedRows = importState.selectedRows.filter(i => i !== rowIndex);
    }
    updateSelectionCount();
}

// Update selection count display
function updateSelectionCount() {
    const count = importState.selectedRows.length;
    const total = importState.rows.length;
    document.getElementById('selectionCount').textContent = `${count} of ${total} rows selected`;
}

// Select all rows (button handler)
function selectAllRows() {
    toggleAllRows(true);
}

// Select none rows (button handler)
function selectNoneRows() {
    toggleAllRows(false);
}

// Build preview
function buildPreview() {
    const summaryContainer = document.getElementById('validationSummary');
    const previewContainer = document.getElementById('previewContainer');

    // Validate selected rows
    const validRows = [];
    const warningRows = [];
    const errorRows = [];

    importState.selectedRows.forEach(rowIndex => {
        const row = importState.rows[rowIndex];
        const mappedRow = {};
        let hasErrors = false;

        // Map and transform data
        for (const [colIndex, dbField] of Object.entries(importState.columnMapping)) {
            let value = row[colIndex];

            // Apply transformation if exists
            if (TRANSFORMATION_RULES[dbField]) {
                // For procedures field, handle comma-separated values
                if (dbField === 'procedures' && value) {
                    const items = value.split(',').map(item => item.trim());
                    const transformedItems = items
                        .map(item => TRANSFORMATION_RULES[dbField][item] !== undefined
                            ? TRANSFORMATION_RULES[dbField][item]
                            : item)
                        .filter(item => item !== ''); // Remove empty strings
                    value = transformedItems.join(', ');
                } else if (TRANSFORMATION_RULES[dbField][value]) {
                    // For other fields, do exact match
                    value = TRANSFORMATION_RULES[dbField][value];
                }
            }

            mappedRow[dbField] = value;
        }

        // Normalize phone numbers
        if (mappedRow.employee_phone_number) {
            mappedRow.employee_phone_number = normalizePhoneNumber(mappedRow.employee_phone_number);
        }
        if (mappedRow.phone) {
            mappedRow.phone = normalizePhoneNumber(mappedRow.phone);
        }

        // Validate required fields
        const required = ['exam_id', 'employee_name', 'employee_dob', 'client_name', 'appointment_time',
                         'type_of_visit', 'phone', 'clinic_name', 'clinic_timezone', 'task_type'];
        const missing = required.filter(field => !mappedRow[field]);

        if (missing.length > 0) {
            hasErrors = true;
            errorRows.push({ rowIndex, reason: `Missing required fields: ${missing.join(', ')}` });
        }

        // Validate phone format (strip non-digits first)
        if (mappedRow.phone) {
            const digitsOnly = mappedRow.phone.toString().replace(/\D/g, '');
            // Valid: 10 digits or 11 digits starting with 1
            if (digitsOnly.length !== 10 && !(digitsOnly.length === 11 && digitsOnly.startsWith('1'))) {
                hasErrors = true;
                errorRows.push({ rowIndex, reason: `Invalid phone number: ${mappedRow.phone}` });
            }
        }

        // Only add to validRows if no ERRORS (warnings are ok)
        if (!hasErrors) {
            validRows.push(rowIndex);
        }
    });

    // Summary
    let summaryHTML = '<div class="import-summary-card">';
    summaryHTML += `<div class="summary-stat"><div class="summary-stat-value">${validRows.length}</div><div class="summary-stat-label">Valid Rows</div></div>`;
    summaryHTML += `<div class="summary-stat"><div class="summary-stat-value">${warningRows.length}</div><div class="summary-stat-label">Warnings</div></div>`;
    summaryHTML += `<div class="summary-stat"><div class="summary-stat-value">${errorRows.length}</div><div class="summary-stat-label">Errors</div></div>`;
    summaryHTML += '</div>';

    if (errorRows.length > 0) {
        summaryHTML += '<div class="validation-error"><strong>Errors:</strong><ul style="margin: 8px 0 0 0;">';
        errorRows.forEach(({ rowIndex, reason }) => {
            summaryHTML += `<li>Row ${rowIndex + 1}: ${reason}</li>`;
        });
        summaryHTML += '</ul></div>';
    }

    if (warningRows.length > 0) {
        summaryHTML += '<div class="validation-warning"><strong>Warnings:</strong><ul style="margin: 8px 0 0 0;">';
        warningRows.forEach(({ rowIndex, reason }) => {
            summaryHTML += `<li>Row ${rowIndex + 1}: ${reason}</li>`;
        });
        summaryHTML += '</ul></div>';
    }

    if (validRows.length > 0 && errorRows.length === 0) {
        summaryHTML += '<div class="validation-success"><strong>✓ All selected rows are valid and ready to import!</strong></div>';
    }

    summaryContainer.innerHTML = summaryHTML;

    // Store validation results
    importState.validationResults = { validRows, warningRows, errorRows };

    // Preview data (first 5 rows)
    let previewHTML = '<p style="color: #666; margin-bottom: 12px;">Preview of first 5 rows:</p>';
    previewHTML += '<div style="overflow-x: auto;"><table class="row-selection-table"><thead><tr><th>Row</th>';

    const displayHeaders = Object.values(importState.columnMapping);
    displayHeaders.forEach(dbField => {
        previewHTML += `<th>${dbField.replace(/_/g, ' ')}</th>`;
    });
    previewHTML += '</tr></thead><tbody>';

    const previewRows = importState.selectedRows.slice(0, 5);
    previewRows.forEach(rowIndex => {
        const row = importState.rows[rowIndex];
        previewHTML += `<tr><td>${rowIndex + 1}</td>`;

        for (const [colIndex, dbField] of Object.entries(importState.columnMapping)) {
            let value = row[colIndex] || '';

            // Format dates for display first
            const displayValue = formatExcelDate(value, dbField);

            // Apply transformation preview
            if (TRANSFORMATION_RULES[dbField]) {
                // For procedures field, handle comma-separated values
                if (dbField === 'procedures' && value) {
                    const items = value.split(',').map(item => item.trim());
                    const transformedDisplay = items
                        .map(item => {
                            const transformed = TRANSFORMATION_RULES[dbField][item];
                            if (transformed !== undefined) {
                                return transformed === '' ? `<s>${item}</s>` : `${item} → ${transformed}`;
                            }
                            return item;
                        })
                        .filter((_, index) => {
                            // Filter out items that were removed (empty string)
                            const item = items[index];
                            return TRANSFORMATION_RULES[dbField][item] !== '';
                        })
                        .join(', ');
                    value = transformedDisplay;
                } else if (TRANSFORMATION_RULES[dbField][value]) {
                    // For other fields, do exact match
                    value = `${displayValue} → ${TRANSFORMATION_RULES[dbField][value]}`;
                } else {
                    value = displayValue;
                }
            } else {
                value = displayValue;
            }

            previewHTML += `<td>${value}</td>`;
        }
        previewHTML += '</tr>';
    });

    previewHTML += '</tbody></table></div>';
    previewContainer.innerHTML = previewHTML;
}

// Start import process
async function startImport() {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const resultsDiv = document.getElementById('importResults');

    try {
        // Only import valid rows
        const { validRows, errorRows } = importState.validationResults;

        console.log('Import Debug:', {
            selectedRows: importState.selectedRows,
            validRows: validRows,
            errorRows: errorRows,
            validationResults: importState.validationResults
        });

        const rowsToImport = importState.selectedRows.filter(i => validRows.includes(i));

        if (rowsToImport.length === 0) {
            let errorMsg = '<div class="validation-error"><strong>No valid rows to import</strong>';
            if (errorRows && errorRows.length > 0) {
                errorMsg += '<p style="margin-top: 8px;">Errors found:</p><ul style="margin: 8px 0 0 0;">';
                errorRows.forEach(({ rowIndex, reason }) => {
                    errorMsg += `<li>Row ${rowIndex + 1}: ${reason}</li>`;
                });
                errorMsg += '</ul>';
            } else {
                errorMsg += '<p style="margin-top: 8px;">Please check the preview step for validation errors.</p>';
            }
            errorMsg += '</div>';
            resultsDiv.innerHTML = errorMsg;
            resultsDiv.style.display = 'block';
            return;
        }

        const total = rowsToImport.length;
        let imported = 0;
        let failed = 0;
        const errors = [];

        progressText.textContent = `Importing 0 of ${total} rows...`;

        // Import rows in batches of 5
        const batchSize = 5;
        for (let i = 0; i < rowsToImport.length; i += batchSize) {
            const batch = rowsToImport.slice(i, i + batchSize);
            const batchData = [];

            batch.forEach(rowIndex => {
                const row = importState.rows[rowIndex];
                const callData = {
                    workflow_state: 'pending',
                    retry_count: 0,
                    max_retries: 3,
                    is_active: true,
                    next_action_at: new Date().toISOString()
                };

                // Map and transform columns
                for (const [colIndex, dbField] of Object.entries(importState.columnMapping)) {
                    let value = row[colIndex];

                    // Apply transformation
                    if (TRANSFORMATION_RULES[dbField]) {
                        // For procedures field, handle comma-separated values
                        if (dbField === 'procedures' && value) {
                            const items = value.split(',').map(item => item.trim());
                            const transformedItems = items
                                .map(item => TRANSFORMATION_RULES[dbField][item] !== undefined
                                    ? TRANSFORMATION_RULES[dbField][item]
                                    : item)
                                .filter(item => item !== ''); // Remove empty strings
                            value = transformedItems.join(', ');
                        } else if (TRANSFORMATION_RULES[dbField][value]) {
                            // For other fields, do exact match
                            value = TRANSFORMATION_RULES[dbField][value];
                        }
                    }

                    // Format phone number
                    if (dbField === 'phone' && value) {
                        value = value.toString().replace(/\D/g, '');
                        if (value.length === 10) {
                            value = '+1' + value;
                        } else if (value.length === 11 && value.startsWith('1')) {
                            value = '+' + value;
                        }
                    }

                    // Parse date for employee_dob if it's an Excel serial
                    if (dbField === 'employee_dob' && typeof value === 'number') {
                        const date = XLSX.SSF.parse_date_code(value);
                        value = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                    }

                    // Parse datetime for appointment_time if it's an Excel serial
                    if (dbField === 'appointment_time' && typeof value === 'number') {
                        const date = new Date((value - 25569) * 86400 * 1000);
                        value = date.toISOString();
                    }

                    callData[dbField] = value || null;
                }

                batchData.push(callData);
            });

            // Insert batch
            try {
                const { data, error } = await supabase
                    .from('pending_calls')
                    .insert(batchData);

                if (error) throw error;

                imported += batchData.length;
            } catch (error) {
                console.error('Batch import error:', error);
                failed += batchData.length;
                errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
            }

            // Update progress
            const progress = Math.round(((imported + failed) / total) * 100);
            progressBar.style.width = progress + '%';
            progressText.textContent = `Imported ${imported} of ${total} rows...`;
        }

        // Show results
        let resultsHTML = '<div class="import-summary-card">';
        resultsHTML += `<div class="summary-stat"><div class="summary-stat-value">${imported}</div><div class="summary-stat-label">Imported</div></div>`;
        resultsHTML += `<div class="summary-stat"><div class="summary-stat-value">${failed}</div><div class="summary-stat-label">Failed</div></div>`;
        resultsHTML += '</div>';

        if (imported > 0) {
            resultsHTML += '<div class="validation-success"><strong>✓ Import completed successfully!</strong></div>';
        }

        if (errors.length > 0) {
            resultsHTML += '<div class="validation-error"><strong>Errors:</strong><ul style="margin: 8px 0 0 0;">';
            errors.forEach(error => {
                resultsHTML += `<li>${error}</li>`;
            });
            resultsHTML += '</ul></div>';
        }

        resultsHTML += '<div style="margin-top: 16px;"><button class="modal-btn primary" onclick="finishImport()">Finish</button></div>';

        resultsDiv.innerHTML = resultsHTML;
        resultsDiv.style.display = 'block';

        // No need to reload - realtime subscription will pick up the new rows automatically

    } catch (error) {
        console.error('Import error:', error);
        resultsDiv.innerHTML = `<div class="validation-error">Import failed: ${error.message}</div>`;
        resultsDiv.style.display = 'block';
    }
}

// Finish import and close modal
function finishImport() {
    closeImportModal();
    showToast('Import completed!');
}

// Expose functions to global window object for inline onclick handlers
window.makeCall = makeCall;
window.archiveCall = archiveCall;
// Column visibility toggle functions
function showColumnToggleModal() {
    document.getElementById('columnToggleModal').style.display = 'flex';
    loadColumnVisibility();
}

function closeColumnToggleModal() {
    document.getElementById('columnToggleModal').style.display = 'none';
}

function loadColumnVisibility() {
    const savedColumns = JSON.parse(localStorage.getItem('visibleColumns') || '{}');
    document.querySelectorAll('#columnToggleModal input[type="checkbox"]').forEach(checkbox => {
        const column = checkbox.dataset.column;
        if (savedColumns.hasOwnProperty(column)) {
            checkbox.checked = savedColumns[column];
        }
    });
}

function applyColumnVisibility() {
    const visibleColumns = {};
    document.querySelectorAll('#columnToggleModal input[type="checkbox"]').forEach(checkbox => {
        const column = checkbox.dataset.column;
        visibleColumns[column] = checkbox.checked;

        // Show/hide column headers
        document.querySelectorAll(`th[data-column="${column}"]`).forEach(th => {
            th.style.display = checkbox.checked ? '' : 'none';
        });

        // Show/hide column cells
        document.querySelectorAll(`td[data-column="${column}"]`).forEach(td => {
            td.style.display = checkbox.checked ? '' : 'none';
        });
    });

    // Save to localStorage
    localStorage.setItem('visibleColumns', JSON.stringify(visibleColumns));
    closeColumnToggleModal();
}

function resetColumnVisibility() {
    // Default visible columns
    const defaultColumns = {
        employee: true,
        appointment: true,
        task: true,
        status: true,
        success: true,
        retries: true,
        client: true,
        clinic: true,
        phone: true,
        procedures: false,
        address: false,
        classification: false,
        last_error: false,
        last_try: true,
        next: true,
        tags: true
    };

    localStorage.setItem('visibleColumns', JSON.stringify(defaultColumns));
    loadColumnVisibility();
    applyColumnVisibility();
}

// Apply saved column visibility on page load
function applySavedColumnVisibility() {
    const savedColumns = JSON.parse(localStorage.getItem('visibleColumns') || '{}');
    Object.entries(savedColumns).forEach(([column, visible]) => {
        document.querySelectorAll(`th[data-column="${column}"]`).forEach(th => {
            th.style.display = visible ? '' : 'none';
        });
        document.querySelectorAll(`td[data-column="${column}"]`).forEach(td => {
            td.style.display = visible ? '' : 'none';
        });
    });
}

// Batch selection and actions
let selectedCallIds = new Set();

function handleRowSelection(checkbox) {
    const callId = checkbox.dataset.callId;
    if (checkbox.checked) {
        selectedCallIds.add(callId);
    } else {
        selectedCallIds.delete(callId);
    }
    updateBatchActionsBar();
    updateSelectAllCheckbox();
}

function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = checked;
        const callId = checkbox.dataset.callId;
        if (checked) {
            selectedCallIds.add(callId);
        } else {
            selectedCallIds.delete(callId);
        }
    });
    updateBatchActionsBar();
}

function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.row-checkbox');
    const checkedCount = document.querySelectorAll('.row-checkbox:checked').length;

    if (checkedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

function updateBatchActionsBar() {
    const batchBar = document.getElementById('batchActionsBar');
    const selectedCount = document.getElementById('selectedCount');

    selectedCount.textContent = selectedCallIds.size;

    if (selectedCallIds.size > 0) {
        batchBar.style.display = 'flex';
    } else {
        batchBar.style.display = 'none';
    }
}

function clearSelection() {
    selectedCallIds.clear();
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('selectAllCheckbox').checked = false;
    updateBatchActionsBar();
}

// Batch Archive
function batchArchive() {
    document.getElementById('archiveCount').textContent = selectedCallIds.size;
    document.getElementById('batchArchiveModal').style.display = 'flex';
}

function closeBatchArchiveModal() {
    document.getElementById('batchArchiveModal').style.display = 'none';
}

async function confirmBatchArchive() {
    const count = selectedCallIds.size;
    try {
        const updates = Array.from(selectedCallIds).map(id =>
            supabase.from('pending_calls').update({ is_active: false }).eq('id', id)
        );
        await Promise.all(updates);

        console.log(`✅ Archived ${count} calls`);
        closeBatchArchiveModal();
        clearSelection();
        await loadPendingCalls();
    } catch (error) {
        console.error('Error archiving calls:', error);
        alert('Failed to archive some calls. Please try again.');
    }
}

// Batch Delete
function batchDelete() {
    document.getElementById('deleteCount').textContent = selectedCallIds.size;
    document.getElementById('batchDeleteModal').style.display = 'flex';
}

function closeBatchDeleteModal() {
    document.getElementById('batchDeleteModal').style.display = 'none';
}

async function confirmBatchDelete() {
    const count = selectedCallIds.size;
    try {
        const deletes = Array.from(selectedCallIds).map(id =>
            supabase.from('pending_calls').delete().eq('id', id)
        );
        await Promise.all(deletes);

        console.log(`✅ Deleted ${count} calls`);
        closeBatchDeleteModal();
        clearSelection();
        await loadPendingCalls();
    } catch (error) {
        console.error('Error deleting calls:', error);
        alert('Failed to delete some calls. Please try again.');
    }
}

// Batch Make Calls
function batchMakeCalls() {
    document.getElementById('makeCallsCount').textContent = selectedCallIds.size;
    document.getElementById('batchMakeCallsModal').style.display = 'flex';
}

function closeBatchMakeCallsModal() {
    document.getElementById('batchMakeCallsModal').style.display = 'none';
}

async function confirmBatchMakeCalls() {
    closeBatchMakeCallsModal();
    const callIds = Array.from(selectedCallIds);

    console.log(`📞 Initiating ${callIds.length} calls...`);

    for (const callId of callIds) {
        try {
            await makeCall(callId);
            // Small delay between calls to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`Failed to make call ${callId}:`, error);
        }
    }

    clearSelection();
    console.log(`✅ Batch call initiation complete`);
}

window.unarchiveCall = unarchiveCall;
window.toggleArchiveCall = toggleArchiveCall;
window.showDeleteConfirmation = showDeleteConfirmation;
window.closeDeleteConfirmation = closeDeleteConfirmation;
window.confirmDeleteCall = confirmDeleteCall;
window.viewCallDetails = viewCallDetails;
window.monitorCall = monitorCall;
window.logout = logout;
window.loadMoreCalls = loadMoreCalls;
window.showSaveFilterModal = showSaveFilterModal;
window.closeSaveFilterModal = closeSaveFilterModal;
window.saveFilterPreset = saveFilterPreset;
window.applyFilterPreset = applyFilterPreset;
window.deleteFilterPreset = deleteFilterPreset;
window.clearSearch = clearSearch;
window.showClassificationModal = showClassificationModal;
window.closeClassificationModal = closeClassificationModal;
window.switchEditTab = switchEditTab;
window.saveEditModal = saveEditModal;
window.addIvrAction = addIvrAction;
window.handleActionTypeChange = handleActionTypeChange;
window.removeIvrAction = removeIvrAction;
window.saveClassification = saveClassification;
window.showNewCallModal = showNewCallModal;
window.closeNewCallModal = closeNewCallModal;
window.saveNewCall = saveNewCall;
window.showImportModal = showImportModal;
window.closeImportModal = closeImportModal;
window.importNextStep = importNextStep;
window.importPreviousStep = importPreviousStep;
window.handleFileUpload = handleFileUpload;
window.updateColumnMapping = updateColumnMapping;
window.selectAllRows = selectAllRows;
window.selectNoneRows = selectNoneRows;
window.toggleAllRows = toggleAllRows;
window.toggleRowSelection = toggleRowSelection;
window.finishImport = finishImport;
window.detectTimezones = detectTimezones;
window.showColumnToggleModal = showColumnToggleModal;
window.closeColumnToggleModal = closeColumnToggleModal;
window.applyColumnVisibility = applyColumnVisibility;
window.resetColumnVisibility = resetColumnVisibility;
window.handleRowSelection = handleRowSelection;
window.toggleSelectAll = toggleSelectAll;
window.clearSelection = clearSelection;
window.batchArchive = batchArchive;
window.closeBatchArchiveModal = closeBatchArchiveModal;
window.confirmBatchArchive = confirmBatchArchive;
window.batchDelete = batchDelete;
window.closeBatchDeleteModal = closeBatchDeleteModal;
window.confirmBatchDelete = confirmBatchDelete;
window.batchMakeCalls = batchMakeCalls;
window.closeBatchMakeCallsModal = closeBatchMakeCallsModal;
window.confirmBatchMakeCalls = confirmBatchMakeCalls;
window.killCall = killCall;

// Convert call data to CSV format
function callsToCSV(calls) {
    if (!calls || calls.length === 0) return '';

    // Define headers
    const headers = [
        'exam_id', 'employee_name', 'employee_dob', 'employee_phone_number', 'employee_address',
        'client_name', 'appointment_time', 'type_of_visit', 'phone', 'clinic_name',
        'clinic_provider_address', 'procedures', 'clinic_timezone', 'task_type',
        'workflow_state', 'success_evaluation', 'retry_count', 'max_retries',
        'is_active', 'classification_id', 'last_error', 'summary', 'tag', 'created_at', 'last_attempt_at'
    ];

    // Create CSV content
    let csv = headers.join(',') + '\n';

    calls.forEach(call => {
        const row = headers.map(header => {
            let value = call[header];

            // Handle special cases
            if (value === null || value === undefined) {
                return '';
            }
            if (Array.isArray(value)) {
                value = value.join('; ');
            }
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }

            // Escape and quote the value
            value = String(value).replace(/"/g, '""');
            return `"${value}"`;
        });
        csv += row.join(',') + '\n';
    });

    return csv;
}

// Export single call
async function exportCall(callId) {
    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Call not found');
        return;
    }

    // Convert to CSV and download
    const csv = callsToCSV([call]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `call-${call.exam_id || callId}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Call exported successfully');
}

// Export multiple calls (batch)
async function batchExport() {
    if (selectedCallIds.size === 0) {
        showToast('No calls selected');
        return;
    }

    const callsToExport = allCalls.filter(call => selectedCallIds.has(call.id));

    // Convert to CSV and download
    const csv = callsToCSV(callsToExport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calls-export-${callsToExport.length}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${callsToExport.length} call(s) successfully`);
}

window.exportCall = exportCall;
window.batchExport = batchExport;

// Apply saved column visibility on page load
document.addEventListener('DOMContentLoaded', () => {
    applySavedColumnVisibility();
});
