// api/telnyx/test-sip-transfer.js
// Enhanced test script - Calls VAPI first, then transfers to add human
// testing unmuting

import fetch from 'node-fetch';

// Configuration constants
const CONFIG = {
  VAPI_SIP: 'sip:brandon-call-for-kits@sip.vapi.ai',
  TELNYX_API_URL: 'https://api.telnyx.com/v2',
  VAPI_ANSWER_DELAY_MS: 2000, // Wait for VAPI to answer
  TRANSFER_TO_HUMAN_DELAY_MS: 500 // Small delay before transferring
};

// Global state to track transfers and prevent duplicates
const transferState = new Map();
global.processedEvents = global.processedEvents || new Set();

export default async function handler(req, res) {
  console.log('🧪 TEST endpoint hit');
  console.log('📍 Method:', req.method);
  console.log('📍 Time:', new Date().toISOString());
  console.log('📍 Headers:', JSON.stringify(req.headers, null, 2));
  
  // GET: Status check and manual test instructions
  if (req.method === 'GET') {
    const status = {
      status: 'Test endpoint ready - VAPI First Mode',
      timestamp: new Date().toISOString(),
      mode: 'VAPI_FIRST_THEN_HUMAN',
      environment: {
        telnyx_api_key: process.env.TELNYX_API_KEY ? '✅ Set' : '❌ Missing',
        telnyx_phone: process.env.TELNYX_PHONE_NUMBER || 'Not set',
        human_phone: process.env.HUMAN_PHONE_NUMBER || 'Not set',
        auto_transfer: process.env.TEST_AUTO_TRANSFER === 'true' ? '✅ Enabled' : '❌ Disabled',
        webhook_url: process.env.WEBHOOK_URL || 'Not set'
      },
      vapi_config: {
        sip_address: CONFIG.VAPI_SIP,
        answer_delay: CONFIG.VAPI_ANSWER_DELAY_MS
      },
      instructions: {
        trigger_call: 'POST to this endpoint with {"action": "initiate", "to_number": "+1234567890"}',
        manual_test: 'POST with {"control_id": "your-vapi-call-control-id", "to_number": "+1234567890"}',
        webhook_path: `${process.env.WEBHOOK_URL || 'YOUR_DOMAIN'}/api/telnyx/test-sip-transfer`
      }
    };
    
    return res.status(200).json(status);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  console.log('📨 Request body:', JSON.stringify(body, null, 2));
  
  // Handle call initiation request
  if (body.action === 'initiate') {
    return await initiateVAPIFirstCall(body, res);
  }
  
  // Handle Telnyx webhooks
  if (body.data?.event_type) {
    return await handleTelnyxWebhook(body.data, res);
  }
  
  // Handle manual transfer test
  if (body.control_id || body.call_control_id) {
    const controlId = body.control_id || body.call_control_id;
    const toNumber = body.to_number || process.env.HUMAN_PHONE_NUMBER;
    console.log('🧪 Manual transfer test for control ID:', controlId);
    console.log('📞 Transfer to:', toNumber);
    
    return await executeTransferToHuman(controlId, toNumber, res);
  }
  
  // Invalid request
  return res.status(400).json({ 
    error: 'Invalid request',
    expected: {
      initiate: '{"action": "initiate", "to_number": "+1234567890"}',
      webhook: 'Telnyx webhook with data.event_type',
      manual: '{"control_id": "xxx", "to_number": "+1234567890"}'
    }
  });
}

// Initiate VAPI-first call sequence
async function initiateVAPIFirstCall(params, res) {
  console.log('🚀 Starting VAPI-first call sequence');
  
  const toNumber = params.to_number || process.env.HUMAN_PHONE_NUMBER;
  if (!toNumber) {
    return res.status(400).json({ error: 'to_number required' });
  }
  
  try {
    // Step 1: Call VAPI
    console.log('📞 Step 1: Calling VAPI...');
    
    const vapiCallResponse = await telnyxAPI('/calls', 'POST', {
      connection_id: process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_VOICE_API_APPLICATION_ID,
      to: CONFIG.VAPI_SIP,
      from: process.env.TELNYX_PHONE_NUMBER,
      webhook_url: `${process.env.WEBHOOK_URL}/api/telnyx/test-sip-transfer`,
      webhook_url_method: 'POST',
      timeout_secs: 60,
      timeout_limit_secs: 600,
      // Custom headers to track intent
      custom_headers: [
        {
          name: 'X-Call-Type',
          value: 'vapi-first'
        },
        {
          name: 'X-Human-Number',
          value: toNumber
        },
        {
          name: 'X-Session-ID',
          value: crypto.randomUUID()
        }
      ],
      // Track state
      client_state: btoa(JSON.stringify({
        initiated_at: new Date().toISOString(),
        type: 'vapi_first',
        human_number: toNumber,
        auto_transfer: true
      }))
    });
    
    if (!vapiCallResponse.ok) {
      console.error('❌ Failed to call VAPI:', vapiCallResponse.status, vapiCallResponse.data);
      throw new Error(vapiCallResponse.data?.errors?.[0]?.detail || 'Failed to call VAPI');
    }
    
    const callData = vapiCallResponse.data?.data;
    console.log('✅ VAPI call initiated');
    console.log('📞 Call Control ID:', callData?.call_control_id);
    console.log('🔗 Call Leg ID:', callData?.call_leg_id);
    
    // Store transfer intent locally for this process only
    transferState.set(callData.call_control_id, {
      human_number: toNumber,
      vapi_called_at: new Date().toISOString(),
      status: 'calling_vapi'
    });
    
    return res.status(200).json({
      success: true,
      message: 'VAPI call initiated, will auto-transfer when answered',
      call_control_id: callData?.call_control_id,
      vapi_sip: CONFIG.VAPI_SIP,
      human_number: toNumber,
      next_steps: [
        'VAPI will be called',
        'When VAPI answers, system will wait briefly',
        'Call will be transferred to add human participant'
      ]
    });
    
  } catch (error) {
    console.error('❌ Error initiating VAPI call:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Handle different Telnyx webhook events
async function handleTelnyxWebhook(event, res) {
  const eventType = event.event_type;
  const payload = event.payload || {};
  
  // Log webhook with deduplication check
  console.log(`📞 Webhook ${eventType} at ${new Date().toISOString()}`);
  console.log(`📞 For call: ${payload.call_control_id}`);
  
  // Check for duplicate webhooks
  if (global.processedEvents?.has(event.id)) {
    console.log('⚠️ Duplicate webhook - already processed');
    return res.status(200).json({ received: true });
  }
  
  // Track processed events
  global.processedEvents.add(event.id);
  
  // Extract custom headers
  const customHeaders = payload.custom_headers || [];
  const callType = customHeaders.find(h => h.name === 'X-Call-Type')?.value;
  const humanNumber = customHeaders.find(h => h.name === 'X-Human-Number')?.value;
  
  console.log('📞 Call details:', {
    control_id: payload.call_control_id,
    leg_id: payload.call_leg_id,
    state: payload.state,
    direction: payload.direction,
    from: payload.from,
    to: payload.to,
    call_type: callType,
    human_number: humanNumber
  });

  switch (eventType) {
    case 'call.initiated':
      console.log('📞 Call initiated - waiting for answer...');
      
      // For incoming calls (not our outbound VAPI call)
      if (payload.direction === 'incoming' && callType !== 'vapi-first') {
        console.log('📞 Incoming call detected - answering...');
        await answerCall(payload.call_control_id);
      }
      break;

    case 'call.answered':
      console.log('✅ Call answered');
      
      // Check if this is our VAPI call being answered
      if (callType === 'vapi-first' && payload.to?.includes('sip:')) {
        console.log('🤖 VAPI answered!');
        
        // First, try to get human number from custom headers
        const humanNumberFromHeader = customHeaders.find(h => h.name === 'X-Human-Number')?.value;
        
        if (humanNumberFromHeader) {
          console.log('🔄 Auto-transferring to human from header:', humanNumberFromHeader);
          
          // Wait briefly for VAPI to fully establish
          await sleep(CONFIG.VAPI_ANSWER_DELAY_MS);
          
          // MUTE VAPI before transfer
          console.log('🔇 Muting VAPI before transfer...');
          const muteResponse = await telnyxAPI(
            `/calls/${payload.call_control_id}/actions/mute`,
            'POST',
            {
              direction: 'both' // Mute both inbound and outbound audio
            }
          );
          
          if (muteResponse.ok) {
            console.log('✅ VAPI muted successfully');
          } else {
            console.log('⚠️ Failed to mute VAPI:', muteResponse.status);
          }
          
          // Execute transfer to add human
          const transferResult = await executeTransferToHuman(
            payload.call_control_id, 
            humanNumberFromHeader, 
            res
          );
          
          // Schedule unmute after 15 seconds
          if (transferResult.success) {
            console.log('⏰ Scheduling unmute in 15 seconds...');
            setTimeout(async () => {
              await unmuteVAPIWithAnnouncement(payload.call_control_id);
            }, 15000); // 15 seconds
          }
          
          return transferResult;
        } else {
          // Fallback: Try to decode from client_state
          console.log('⚠️ No human number in headers, checking client_state...');
          
          if (payload.client_state) {
            try {
              const clientState = JSON.parse(atob(payload.client_state));
              console.log('📦 Decoded client state:', clientState);
              
              if (clientState.human_number) {
                console.log('🔄 Found human number in client_state:', clientState.human_number);
                
                // Wait briefly for VAPI to fully establish
                await sleep(CONFIG.VAPI_ANSWER_DELAY_MS);
                
                // MUTE VAPI before transfer
                console.log('🔇 Muting VAPI before transfer...');
                const muteResponse = await telnyxAPI(
                  `/calls/${payload.call_control_id}/actions/mute`,
                  'POST',
                  {
                    direction: 'both'
                  }
                );
                
                if (muteResponse.ok) {
                  console.log('✅ VAPI muted successfully');
                } else {
                  console.log('⚠️ Failed to mute VAPI:', muteResponse.status);
                }
                
                // Execute transfer to add human
                const transferResult = await executeTransferToHuman(
                  payload.call_control_id, 
                  clientState.human_number, 
                  res
                );
                
                // Schedule unmute after 15 seconds
                if (transferResult.success) {
                  console.log('⏰ Scheduling unmute in 15 seconds...');
                  setTimeout(async () => {
                    await unmuteVAPIWithAnnouncement(payload.call_control_id);
                  }, 15000); // 15 seconds
                }
                
                return transferResult;
              } else {
                console.error('❌ No human number found in client_state!');
              }
            } catch (e) {
              console.error('❌ Failed to parse client_state:', e);
            }
          } else {
            console.error('❌ No client_state to decode!');
          }
          
          // If we get here, we couldn't find a human number
          console.error('❌ Unable to determine human number for transfer!');
        }
      } else if (payload.to && !payload.to.includes('sip:')) {
        // This is likely the human leg answering after transfer
        console.log('👤 Human answered - bridge complete!');
      }
      break;

    case 'call.hangup':
      console.log('📞 Call ended:', payload.hangup_cause);
      // Clean up transfer state
      if (payload.call_control_id) {
        transferState.delete(payload.call_control_id);
      }
      break;

    case 'call.transfer.completed':
      console.log('✅ Transfer completed successfully!');
      console.log('🌉 VAPI and human are now connected');
      break;

    case 'call.transfer.failed':
      console.log('❌ Transfer failed:', payload.failure_reason);
      break;

    default:
      console.log(`📨 Other event: ${eventType}`);
  }

  // Always return 200 for webhooks
  return res.status(200).json({ received: true });
}

// Answer an incoming call
async function answerCall(controlId) {
  console.log('📞 Answering call:', controlId);
  
  try {
    const response = await telnyxAPI(
      `/calls/${controlId}/actions/answer`,
      'POST'
    );
    
    if (response.ok) {
      console.log('✅ Call answered successfully');
      return true;
    } else {
      console.error('❌ Failed to answer:', response.status, response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error answering call:', error.message);
    return false;
  }
}

// Execute transfer to add human to the VAPI call
async function executeTransferToHuman(vapiControlId, humanNumber, res) {
  console.log('🚀 Starting transfer to add human');
  console.log('📞 VAPI Control ID:', vapiControlId);
  console.log('📞 Human Number:', humanNumber);
  
  // Prevent duplicate transfers using local state
  const currentState = transferState.get(vapiControlId);
  if (currentState?.transferring || currentState?.completed) {
    console.log('⚠️ Transfer already in progress or completed');
    return res.status(200).json({
      message: 'Transfer already handled',
      control_id: vapiControlId,
      state: currentState
    });
  }
  
  // Mark as transferring
  transferState.set(vapiControlId, {
    ...currentState,
    transferring: true,
    transfer_started_at: new Date().toISOString()
  });
  
  try {
    // Check environment
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }
    
    // Verify call is still active
    const callStatus = await getCallStatus(vapiControlId);
    if (!callStatus.active) {
      throw new Error(`VAPI call not active. State: ${callStatus.state}`);
    }
    
    console.log('✅ VAPI call is active and ready for transfer');
    
    // Execute REFER transfer to add human
    const transferResult = await doReferTransfer(vapiControlId, humanNumber);
    
    // Mark as completed
    transferState.set(vapiControlId, {
      ...transferState.get(vapiControlId),
      transferring: false,
      completed: true,
      completed_at: new Date().toISOString()
    });
    
    // Clean up after 5 minutes
    setTimeout(() => transferState.delete(vapiControlId), 5 * 60 * 1000);
    
    // Return result
    return res.status(200).json({
      test: 'completed',
      success: transferResult.success,
      timestamp: new Date().toISOString(),
      vapi_call: {
        control_id: vapiControlId,
        was_active: callStatus.active,
        state_before_transfer: callStatus.state
      },
      transfer_details: {
        to: humanNumber,
        from: process.env.TELNYX_PHONE_NUMBER,
        method: 'REFER',
        type: transferResult.type
      },
      result: transferResult
    });
    
  } catch (error) {
    console.error('❌ Transfer failed:', error.message);
    
    // Mark as failed
    transferState.set(vapiControlId, {
      ...transferState.get(vapiControlId),
      transferring: false,
      completed: false,
      error: error.message
    });
    
    return res.status(500).json({
      test: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Execute REFER transfer to add human to VAPI call
async function doReferTransfer(vapiControlId, humanNumber) {
  console.log('🔄 Executing REFER transfer to add human');
  
  const TELNYX_NUMBER = process.env.TELNYX_PHONE_NUMBER;
  
  if (!TELNYX_NUMBER) {
    throw new Error('TELNYX_PHONE_NUMBER environment variable is required');
  }
  
  // Use standard transfer which implements SIP REFER
  console.log('🔄 Using REFER transfer method...');
  
  const transferPayload = {
    to: humanNumber, // Transfer to human number
    from: TELNYX_NUMBER,
    webhook_url: process.env.WEBHOOK_URL ? 
      `${process.env.WEBHOOK_URL}/api/telnyx/test-sip-transfer` : undefined,
    webhook_url_method: 'POST',
    // Custom headers for the new leg
    custom_headers: [
      {
        name: 'X-Call-Type',
        value: 'human-leg'
      },
      {
        name: 'X-VAPI-Bridge',
        value: 'true'
      }
    ]
  };
  
  // Remove undefined fields
  Object.keys(transferPayload).forEach(key => 
    transferPayload[key] === undefined && delete transferPayload[key]
  );
  
  console.log('📤 Transfer payload:', JSON.stringify(transferPayload, null, 2));
  
  const response = await telnyxAPI(
    `/calls/${vapiControlId}/actions/transfer`,
    'POST',
    transferPayload
  );
  
  console.log('📥 Transfer response:', {
    status: response.status,
    ok: response.ok,
    data: response.data
  });
  
  if (response.ok) {
    console.log('✅ REFER transfer initiated successfully!');
    console.log('🎯 Human will be added to call with VAPI');
  } else {
    console.error('❌ Transfer failed');
    
    // Log detailed error info
    if (response.data?.errors) {
      response.data.errors.forEach(err => {
        console.error('  Error:', err.title || err.detail || err);
      });
    }
  }
  
  return {
    success: response.ok,
    type: 'REFER',
    status: response.status,
    data: response.data,
    human_number: humanNumber,
    warning: response.ok ? null : 'Transfer failed'
  };
}

// Get current call status
async function getCallStatus(controlId) {
  console.log('🔍 Checking call status...');
  
  try {
    const response = await telnyxAPI(
      `/calls/${controlId}`,
      'GET'
    );
    
    if (response.ok && response.data?.data) {
      const call = response.data.data;
      const state = call.state || 'unknown';
      const active = state !== 'hangup' && state !== 'parked';
      
      console.log(`📞 Call state: ${state} (active: ${active})`);
      
      return {
        active,
        state,
        details: call
      };
    }
    
    return { active: false, state: 'error' };
    
  } catch (error) {
    console.error('❌ Could not get call status:', error.message);
    return { active: false, state: 'error' };
  }
}

// Telnyx API helper
async function telnyxAPI(endpoint, method = 'POST', body = null) {
  const url = `${CONFIG.TELNYX_API_URL}${endpoint}`;
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, options);
    
    let data = null;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse JSON:', text);
          data = { raw: text };
        }
      }
    }
    
    return {
      ok: response.ok,
      status: response.status,
      data
    };
    
  } catch (error) {
    console.error(`API call failed: ${method} ${endpoint}`, error);
    throw error;
  }
}

// Helper function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Unmute VAPI with announcement
async function unmuteVAPIWithAnnouncement(callControlId) {
  console.log('🔊 Time to unmute VAPI with announcement...');
  
  try {
    // First, play the announcement
    console.log('📢 Playing unmute announcement...');
    const speakResponse = await telnyxAPI(
      `/calls/${callControlId}/actions/speak`,
      'POST',
      {
        payload: "Unmuting",
        voice: "male",
        language: "en-US"
      }
    );
    
    if (!speakResponse.ok) {
      console.error('⚠️ Failed to play announcement:', speakResponse.status);
    } else {
      console.log('✅ Announcement played');
    }
    
    // Wait a moment for the announcement to finish
    await sleep(1000);
    
    // Now unmute the call
    console.log('🔊 Unmuting VAPI...');
    const unmuteResponse = await telnyxAPI(
      `/calls/${callControlId}/actions/unmute`,
      'POST',
      {
        direction: 'both' // Unmute both directions
      }
    );
    
    if (unmuteResponse.ok) {
      console.log('✅ VAPI unmuted successfully at', new Date().toISOString());
    } else {
      console.error('❌ Failed to unmute VAPI:', unmuteResponse.status, unmuteResponse.data);
    }
    
  } catch (error) {
    console.error('❌ Error in unmute process:', error.message);
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};
