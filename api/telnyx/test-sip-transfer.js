// api/telnyx/test-sip-transfer.js
// Enhanced test script for debugging VAPI SIP transfers

import fetch from 'node-fetch';

// Configuration constants
const CONFIG = {
  VAPI_SIP: 'sip:brandon-call-for-kits@sip.vapi.ai',
  TELNYX_API_URL: 'https://api.telnyx.com/v2',
  TRANSFER_DELAY_MS: 1000, // Wait 1 second after answering before transfer
  SPEAK_BEFORE_TRANSFER: true // Enable/disable announcement
};

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
      await sleep(1000);
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
  
  console.log(`📞 Webhook: ${eventType}`);
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
      break;

    case 'call.speak.ended':
      console.log('🗣️ Speak action completed');
      
      // If this was our pre-transfer announcement, now do the transfer
      if (payload.client_state) {
        try {
          const state = JSON.parse(Buffer.from(payload.client_state, 'base64').toString());
          if (state.action === 'pre_transfer_announcement') {
            console.log('📞 Pre-transfer announcement complete, transferring now...');
            await doTransfer(payload.call_control_id);
          }
        } catch (e) {
          console.error('Error parsing client_state:', e);
        }
      }
      break;

    case 'call.hangup':
      console.log('📞 Call ended:', payload.hangup_cause);
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

// Main transfer test execution
async function executeTransferTest(controlId, res) {
  console.log('🚀 Starting transfer test sequence');
  
  try {
    // 1. Check environment
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }
    
    // 2. Verify call status
    const callStatus = await getCallStatus(controlId);
    if (!callStatus.active) {
      throw new Error(`Call not active. State: ${callStatus.state}`);
    }
    
    console.log('✅ Call is active and ready for transfer');
    
    // 3. Optional: Play announcement before transfer
    if (CONFIG.SPEAK_BEFORE_TRANSFER) {
      console.log('🗣️ Playing pre-transfer announcement...');
      
      const speakResponse = await telnyxAPI(
        `/calls/${controlId}/actions/speak`,
        'POST',
        {
          payload: "Connecting you to an agent now. Please wait.",
          voice: 'female',
          language: 'en-US',
          client_state: Buffer.from(JSON.stringify({
            action: 'pre_transfer_announcement',
            timestamp: new Date().toISOString()
          })).toString('base64')
        }
      );
      
      if (speakResponse.ok) {
        console.log('✅ Announcement started');
        // Wait for speak to complete (webhook will handle transfer)
        await sleep(3000); // Give time for message to play
      } else {
        console.log('⚠️ Could not play announcement, proceeding with transfer');
      }
    }
    
    // 4. Execute transfer
    const transferResult = await doTransfer(controlId);
    
    // 5. Return comprehensive result
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
        from: process.env.TELNYX_PHONE_NUMBER || 'default',
        speak_enabled: CONFIG.SPEAK_BEFORE_TRANSFER
      },
      result: transferResult
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    return res.status(500).json({
      test: 'failed',
      error: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Execute the actual SIP transfer
async function doTransfer(controlId) {
  console.log('🔄 Executing SIP transfer to VAPI');
  
  const transferPayload = {
    to: CONFIG.VAPI_SIP,
    from: process.env.TELNYX_PHONE_NUMBER || '+14156021922', // Use your number as fallback
    // Optional: Add webhook for transfer status
    webhook_url: process.env.WEBHOOK_URL ? 
      `${process.env.WEBHOOK_URL}/api/telnyx/test-sip-transfer` : undefined,
    webhook_url_method: 'POST'
  };
  
  // Remove undefined fields
  Object.keys(transferPayload).forEach(key => 
    transferPayload[key] === undefined && delete transferPayload[key]
  );
  
  console.log('📤 Transfer payload:', JSON.stringify(transferPayload, null, 2));
  
  try {
    const response = await telnyxAPI(
      `/calls/${controlId}/actions/transfer`,
      'POST',
      transferPayload
    );
    
    console.log('📥 Transfer response:', {
      status: response.status,
      ok: response.ok,
      data: response.data
    });
    
    if (response.ok) {
      console.log('✅ Transfer initiated successfully!');
      console.log('🎯 Call should now be connected to:', CONFIG.VAPI_SIP);
      
      return {
        success: true,
        status: response.status,
        data: response.data,
        sip_address: CONFIG.VAPI_SIP
      };
    } else {
      console.error('❌ Transfer failed');
      
      // Log detailed error info
      if (response.data?.errors) {
        response.data.errors.forEach(err => {
          console.error('  Error:', err.title || err.detail || err);
        });
      }
      
      return {
        success: false,
        status: response.status,
        errors: response.data?.errors || response.data,
        sip_address: CONFIG.VAPI_SIP
      };
    }
    
  } catch (error) {
    console.error('❌ Transfer exception:', error);
    throw error;
  }
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

// Store diagnostic info
global.transferTests = global.transferTests || [];

export const config = {
  api: {
    bodyParser: true
  }
};
