// api/telnyx/test-sip-transfer.js
// Enhanced test script for debugging VAPI SIP transfers - NO pre-transfer announcement

import fetch from 'node-fetch';

// Configuration constants
const CONFIG = {
  VAPI_SIP: 'sip:brandon-call-for-kits@sip.vapi.ai',
  TELNYX_API_URL: 'https://api.telnyx.com/v2',
  TRANSFER_DELAY_MS: 500, // Reduced delay for faster transfer
  SPEAK_BEFORE_TRANSFER: false // DISABLED pre-transfer announcement
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
      status: 'Test endpoint ready',
      timestamp: new Date().toISOString(),
      environment: {
        telnyx_api_key: process.env.TELNYX_API_KEY ? '✅ Set' : '❌ Missing',
        telnyx_phone: process.env.TELNYX_PHONE_NUMBER || 'Not set',
        auto_transfer: process.env.TEST_AUTO_TRANSFER === 'true' ? '✅ Enabled' : '❌ Disabled',
        webhook_url: process.env.WEBHOOK_URL || 'Not set'
      },
      vapi_config: {
        sip_address: CONFIG.VAPI_SIP,
        speak_enabled: CONFIG.SPEAK_BEFORE_TRANSFER
      },
      instructions: {
        manual_test: 'POST to this endpoint with {"control_id": "your-call-control-id"}',
        auto_test: 'Set TEST_AUTO_TRANSFER=true and call your Telnyx number',
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
  
  // Handle Telnyx webhooks
  if (body.data?.event_type) {
    return await handleTelnyxWebhook(body.data, res);
  }
  
  // Handle manual transfer test
  if (body.control_id || body.call_control_id) {
    const controlId = body.control_id || body.call_control_id;
    console.log('🧪 Manual transfer test for control ID:', controlId);
    
    // Optional: Answer call first if specified
    if (body.answer_first) {
      await answerCall(controlId);
      await sleep(500);
    }
    
    return await executeTransferTest(controlId, res);
  }
  
  // Invalid request
  return res.status(400).json({ 
    error: 'Invalid request',
    expected: {
      webhook: 'Telnyx webhook with data.event_type',
      manual: '{"control_id": "xxx", "answer_first": true/false}'
    }
  });
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
  
  console.log('📞 Call details:', {
    control_id: payload.call_control_id,
    leg_id: payload.call_leg_id,
    state: payload.state,
    direction: payload.direction,
    from: payload.from,
    to: payload.to
  });

  switch (eventType) {
    case 'call.initiated':
      console.log('📞 Call initiated - waiting for answer...');
      
      // Answer incoming calls
      if (payload.direction === 'incoming') {
        console.log('📞 Incoming call detected - answering...');
        const answered = await answerCall(payload.call_control_id);
        if (!answered) {
          console.error('❌ Failed to answer call');
        }
      }
      break;

    case 'call.answered':
      console.log('✅ Call answered');
      
      // Check if this is the original call leg (not a transfer leg)
      if (payload.to && !payload.to.includes('sip:')) {
        console.log('📞 Original call leg answered');
        
        // Auto-transfer if enabled
        if (process.env.TEST_AUTO_TRANSFER === 'true') {
          console.log('🤖 Auto-transfer enabled - starting transfer sequence...');
          
          // Store call info for diagnostics
          global.lastAnsweredCall = {
            control_id: payload.call_control_id,
            leg_id: payload.call_leg_id,
            from: payload.from,
            to: payload.to,
            answered_at: new Date().toISOString()
          };
          
          // Wait briefly to ensure call is stable
          await sleep(CONFIG.TRANSFER_DELAY_MS);
          
          // Execute transfer
          return await executeTransferTest(payload.call_control_id, res);
        } else {
          console.log('ℹ️ Auto-transfer disabled. Call answered but not transferring.');
          console.log('💡 Enable with TEST_AUTO_TRANSFER=true or use manual test');
        }
      } else {
        console.log('📞 Transfer leg answered - ignoring to prevent loops');
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

// Main transfer test execution with duplicate prevention
async function executeTransferTest(controlId, res) {
  console.log('🚀 Starting transfer test sequence');
  
  // CRITICAL: Prevent duplicate transfers
  if (transferState.has(controlId)) {
    const state = transferState.get(controlId);
    if (state.transferring || state.completed) {
      console.log('⚠️ Transfer already in progress or completed for this call');
      return res.status(200).json({
        message: 'Transfer already handled',
        control_id: controlId,
        state: state
      });
    }
  }
  
  // Mark as transferring
  transferState.set(controlId, {
    transferring: true,
    started_at: new Date().toISOString(),
    completed: false
  });
  
  try {
    // Check environment
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }
    
    // Verify call status
    const callStatus = await getCallStatus(controlId);
    if (!callStatus.active) {
      throw new Error(`Call not active. State: ${callStatus.state}`);
    }
    
    console.log('✅ Call is active and ready for transfer');
    
    // Execute transfer immediately (no announcement)
    const transferResult = await doTransfer(controlId);
    
    // Mark as completed
    transferState.set(controlId, {
      ...transferState.get(controlId),
      transferring: false,
      completed: true,
      completed_at: new Date().toISOString()
    });
    
    // Clean up after 5 minutes
    setTimeout(() => transferState.delete(controlId), 5 * 60 * 1000);
    
    // Return comprehensive result
    return res.status(200).json({
      test: 'completed',
      success: transferResult.success,
      timestamp: new Date().toISOString(),
      call_info: {
        control_id: controlId,
        was_active: callStatus.active,
        state_before_transfer: callStatus.state
      },
      transfer_details: {
        to: CONFIG.VAPI_SIP,
        from: process.env.TELNYX_PHONE_NUMBER,
        type: transferResult.type
      },
      result: transferResult
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    // Mark as failed
    transferState.set(controlId, {
      ...transferState.get(controlId),
      transferring: false,
      completed: false,
      error: error.message
    });
    
    return res.status(500).json({
      test: 'failed',
      error: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Enhanced doTransfer function for seamless experience
async function doTransfer(controlId) {
  console.log('🔄 Executing seamless SIP transfer to VAPI');
  
  const VAPI_SIP = CONFIG.VAPI_SIP;
  const TELNYX_NUMBER = process.env.TELNYX_PHONE_NUMBER;
  
  if (!TELNYX_NUMBER) {
    throw new Error('TELNYX_PHONE_NUMBER environment variable is required');
  }
  
  try {
    // Option 1: Try supervised transfer first (most seamless)
    console.log('🔄 Attempting supervised transfer...');
    
    const supervisedPayload = {
      to: VAPI_SIP,
      from: TELNYX_NUMBER,
      // Supervised transfer waits for answer before completing
      transfer_type: 'supervised', // or 'attended' depending on Telnyx API
      // Add SIP headers to signal auto-answer
      sip_headers: [
        {
          name: 'Alert-Info',
          value: 'auto-answer' // Standard auto-answer header
        },
        {
          name: 'X-Transfer-Type',
          value: 'seamless'
        },
        {
          name: 'X-Original-Call-ID',
          value: controlId
        }
      ],
      // Custom headers for tracking
      custom_headers: [
        {
          name: 'X-Seamless-Transfer',
          value: 'true'
        }
      ]
    };
    
    const response = await telnyxAPI(
      `/calls/${controlId}/actions/transfer`,
      'POST',
      supervisedPayload
    );
    
    if (response.ok) {
      console.log('✅ Supervised transfer successful');
      return { success: true, type: 'supervised', data: response.data };
    }
    
  } catch (error) {
    console.log('⚠️ Supervised transfer not supported, trying blind transfer...');
  }
  
  // Skip blind transfer - may be causing issues
  // Blind transfer commented out to simplify
  
  // Simple standard transfer only
  console.log('🔄 Executing standard SIP transfer...');
  
  const standardPayload = {
    to: VAPI_SIP,
    from: TELNYX_NUMBER,
    webhook_url: process.env.WEBHOOK_URL ? 
      `${process.env.WEBHOOK_URL}/api/telnyx/test-sip-transfer` : undefined,
    webhook_url_method: 'POST'
  };
  
  // Remove undefined fields
  Object.keys(standardPayload).forEach(key => 
    standardPayload[key] === undefined && delete standardPayload[key]
  );
  
  console.log('📤 Standard transfer payload:', JSON.stringify(standardPayload, null, 2));
  
  const response = await telnyxAPI(
    `/calls/${controlId}/actions/transfer`,
    'POST',
    standardPayload
  );
  
  console.log('📥 Transfer response:', {
    status: response.status,
    ok: response.ok,
    data: response.data
  });
  
  if (response.ok) {
    console.log('✅ Transfer initiated successfully!');
    console.log('🎯 Call should now be connected to:', CONFIG.VAPI_SIP);
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
    type: 'standard',
    status: response.status,
    data: response.data,
    sip_address: CONFIG.VAPI_SIP,
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

export const config = {
  api: {
    bodyParser: true
  }
};
