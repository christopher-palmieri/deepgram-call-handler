// public/scripts/dashboard.js
// Dashboard functionality

let currentUser = null;
let allCalls = [];
let currentFilters = {
    status: ['all'],
    dateRange: ['all'],
    taskType: ['all']
};
let realtimeChannel = null;
let callSessionsChannel = null;
let pollingInterval = null;
let isRealtimeWorking = false;
let currentSort = { field: null, direction: 'asc' };

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
    
    // Load saved filters from localStorage
    loadSavedFilters();
    
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

// Legacy filter function - keeping for compatibility
function filterCalls(filter) {
    console.log('Legacy filter function called:', filter);
}

// Render calls table
function renderCallsTable() {
    const tbody = document.getElementById('callsTableBody');
    
    let filteredCalls = applyFilters(allCalls);
    
    if (filteredCalls.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-table">No calls found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredCalls.map(call => createCallRowHtml(call)).join('');
    
    // Re-initialize column resizing after table update
    reinitializeColumnResizing();
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
        <td>${call.employee_name || '-'}</td>
        <td>${appointmentTime}</td>
        <td><span class="task-type-badge">${call.task_type || 'records_request'}</span></td>
        <td><span class="workflow-badge workflow-${call.workflow_state}">${call.workflow_state}</span></td>
        <td>${call.success_evaluation || '-'}</td>
        <td>${call.retry_count || 0}/${call.max_retries || 3}</td>
        <td>${call.client_name || '-'}</td>
        <td>${call.clinic_name || '-'}</td>
        <td>${formattedPhone}</td>
        <td>${lastAttempt}</td>
        <td>${nextAction}</td>
    </tr>`;
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
            
            // If no filters left, default to 'all'
            if (currentFilters[filterType].length === 0) {
                currentFilters[filterType] = ['all'];
                updateCheckboxes(filterType, ['all']);
            }
        }
    }
    
    updateFilterDisplay(filterType);
    saveFiltersToStorage();
    renderCallsTable();
}

function updateCheckboxes(filterType, selectedValues) {
    const menuId = filterType === 'status' ? 'statusFilterMenu' : 
                   filterType === 'dateRange' ? 'dateFilterMenu' : 'taskFilterMenu';
    const menu = document.getElementById(menuId);
    
    if (!menu) return;
    
    menu.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = selectedValues.includes(checkbox.value);
    });
}

function updateFilterDisplay(filterType) {
    const toggleId = filterType === 'status' ? 'statusFilterToggle' : 
                     filterType === 'dateRange' ? 'dateFilterToggle' : 'taskFilterToggle';
    const toggle = document.getElementById(toggleId);
    
    if (!toggle) return;
    
    const filterText = toggle.querySelector('.filter-text');
    const selected = currentFilters[filterType];
    
    let displayText;
    if (selected.includes('all') || selected.length === 0) {
        displayText = filterType === 'status' ? 'All Statuses' :
                     filterType === 'dateRange' ? 'All Dates' : 'All Tasks';
    } else if (selected.length === 1) {
        displayText = formatFilterValue(selected[0]);
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
        'today': 'Today',
        'tomorrow': 'Tomorrow',
        'yesterday': 'Yesterday',
        'last7days': 'Last 7 Days',
        'last30days': 'Last 30 Days',
        'older30days': 'Older than 30 Days',
        
        // Task type values
        'records_request': 'Records Request',
        'schedule': 'Schedule',
        'kit_confirmation': 'Kit Confirmation'
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
        
        // Date range filter
        if (!currentFilters.dateRange.includes('all')) {
            if (!matchesDateRange(call.appointment_time, currentFilters.dateRange)) {
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
        
        // Update UI to reflect loaded filters
        updateCheckboxes('status', currentFilters.status);
        updateCheckboxes('dateRange', currentFilters.dateRange);
        updateCheckboxes('taskType', currentFilters.taskType);
        
        updateFilterDisplay('status');
        updateFilterDisplay('dateRange');
        updateFilterDisplay('taskType');
        
        console.log('Filters restored from localStorage');
    } catch (error) {
        console.warn('Failed to load filters from localStorage:', error);
        // Reset to defaults if loading fails
        currentFilters = {
            status: ['all'],
            dateRange: ['all'],
            taskType: ['all']
        };
    }
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
