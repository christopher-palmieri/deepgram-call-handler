case 'call.answered':
      console.log('✅ Call answered');
      
      // Check if this is VAPI answering
      if (payload.to && payload.to.includes('sip:') && payload.to.includes('vapi')) {
        console.log('✅ VAPI answered! Now calling the clinic...');
        
        // Parse the clinic number from client state
        let clinicNumber = clientState.clinic_number || clientState.type || '+16093694379'; // Default to your test number
        
        // Wait for VAPI to fully connect, then mute it
        setTimeout(async () => {
          await muteVAPIAndCallClinic(payload.call_control_id, clinicNumber);
        }, CONFIG.VAPI_CONNECT_// api/telnyx/test-sip-transfer.js
// Full implementation with VAPI-first logic handled in Vercel

import fetch from 'node-fetch';
import crypto from 'crypto';

// Configuration constants
const CONFIG = {
  VAPI_SIP: 'sip:brandon-call-for-kits@sip.vapi.ai',
  TELNYX_API_URL: 'https://api.telnyx.com/v2',
  VAPI_CONNECT_DELAY_MS: 2000, // Wait 2 seconds for VAPI to fully connect
  SPEAK_BEFORE_TRANSFER: false
};

// Global state to track calls and transfers
const callState = new Map();
const transferState = new Map();
global.processedEvents = global.processedEvents || new Set();

export default async function handler(req, res) {
  console.log('🧪 TEST endpoint hit');
  console.log('📍 Method:', req.method);
  console.log('📍 Time:', new Date().toISOString());
  console.log('📍 Headers:', JSON.stringify(req.headers, null, 2));
  
  // GET: Status check
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Test endpoint ready',
      timestamp: new Date().toISOString(),
      mode: 'VAPI-first bridge mode',
      environment: {
        telnyx_api_key: process.env.TELNYX_API_KEY ? '✅ Set' : '❌ Missing',
        telnyx_phone: process.env.TELNYX_PHONE_NUMBER || 'Not set',
        auto_transfer: process.env.TEST_AUTO_TRANSFER === 'true' ? '✅ Enabled' : '❌ Disabled',
        webhook_url: process.env.WEBHOOK_URL || 'Not set',
        connection_id: process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_VOICE_API_APPLICATION_ID || 'Not set'
      },
      vapi_config: {
        sip_address: CONFIG.VAPI_SIP,
        speak_enabled: CONFIG.SPEAK_BEFORE_TRANSFER
      }
    });
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
  
  // Handle manual test requests
  if (body.control_id || body.call_control_id) {
    const controlId = body.control_id || body.call_control_id;
    console.log('🧪 Manual test for control ID:', controlId);
    return await handleManualTest(controlId, res);
  }
  
  // Unknown request
  return res.status(400).json({ 
    error: 'Invalid request',
    expected: {
      webhook: 'Telnyx webhook with data.event_type',
      manual: '{"control_id": "xxx"}'
    }
  });
}

// Handle different Telnyx webhook events
async function handleTelnyxWebhook(event, res) {
  const eventType = event.event_type;
  const payload = event.payload || {};
  
  // Check for duplicate webhooks
  if (global.processedEvents?.has(event.id)) {
    console.log('⚠️ Duplicate webhook - already processed');
    return res.status(200).json({ received: true });
  }
  global.processedEvents.add(event.id);
  
  console.log(`📞 Webhook ${eventType} at ${new Date().toISOString()}`);
  console.log(`📞 For call: ${payload.call_control_id}`);
  
  // Parse client state if available
  let clientState = {};
  try {
    if (payload.client_state) {
      clientState = JSON.parse(Buffer.from(payload.client_state, 'base64').toString());
    }
  } catch (e) {
    console.log('Could not parse client state');
  }
  
  console.log('📞 Call details:', {
    control_id: payload.call_control_id,
    leg_id: payload.call_leg_id,
    state: payload.state,
    direction: payload.direction,
    from: payload.from,
    to: payload.to,
    client_state: clientState
  });

  switch (eventType) {
    case 'call.initiated':
      console.log('📞 Call initiated - intercepting to use VAPI-first flow...');
      
      // Store call info
      callState.set(payload.call_control_id, {
        leg_id: payload.call_leg_id,
        from: payload.from,
        to: payload.to,
        direction: payload.direction,
        client_state: clientState,
        initiated_at: new Date().toISOString()
      });
      
      // INTERCEPT: Instead of calling the clinic, redirect to VAPI
      if (shouldUseVAPIFirst(payload, clientState) && payload.direction === 'outgoing') {
        console.log('🔄 Redirecting call to VAPI instead of clinic...');
        
        // Store the original target (clinic number)
        const originalTarget = payload.to;
        
        // Redirect this call to VAPI
        try {
          await telnyxAPI(
            `/calls/${payload.call_control_id}/actions/redirect`,
            'POST',
            {
              to: CONFIG.VAPI_SIP,
              client_state: Buffer.from(JSON.stringify({
                flow: 'vapi_first_redirected',
                original_target: originalTarget,
                clinic_number: originalTarget
              })).toString('base64')
            }
          );
          console.log('✅ Call redirected to VAPI');
        } catch (error) {
          console.error('❌ Failed to redirect to VAPI:', error);
        }
      }
      
      // Answer incoming calls normally
      else if (payload.direction === 'incoming') {
        console.log('📞 Incoming call detected - answering...');
        await answerCall(payload.call_control_id);
      }
      break;

    case 'call.answered':
      console.log('✅ Call answered');
      
      // Check if this is VAPI answering after our redirect
      if (clientState.flow === 'vapi_first_redirected' && payload.to.includes('sip:')) {
        console.log('✅ VAPI answered! Waiting before calling clinic...');
        
        const clinicNumber = clientState.original_target || clientState.clinic_number;
        
        // Wait for VAPI to fully connect
        setTimeout(async () => {
          await handleVAPIConnectedAndCallClinic(payload.call_control_id, clinicNumber);
        }, CONFIG.VAPI_CONNECT_DELAY_MS);
      }
      
      // Check if this is clinic answering
      else if (clientState.flow === 'calling_clinic') {
        console.log('✅ Clinic answered! Bridging with VAPI...');
        await bridgeVAPIAndClinic(payload.call_control_id, clientState.vapi_call_id);
      }
      
      break;

    case 'call.bridged':
      console.log('✅ Calls successfully bridged!');
      break;

    case 'call.hangup':
      console.log('📞 Call ended:', payload.hangup_cause);
      callState.delete(payload.call_control_id);
      transferState.delete(payload.call_control_id);
      break;

    default:
      console.log(`📨 Other event: ${eventType}`);
  }

  return res.status(200).json({ received: true });
}

// Determine if we should use VAPI-first approach
function shouldUseVAPIFirst(payload, clientState) {
  // Enable VAPI-first for all outbound calls when TEST_AUTO_TRANSFER is true
  if (process.env.TEST_AUTO_TRANSFER === 'true') {
    // Make sure we don't redirect already redirected calls
    if (clientState.flow === 'vapi_first_redirected' || 
        clientState.flow === 'calling_clinic' ||
        payload.to?.includes('sip:')) {
      return false;
    }
    return true;
  }
  
  // Add other business logic here:
  // - Check custom headers for specific call types
  // - Check time of day
  // - Check specific phone numbers
  // - etc.
  
  return false;
}

// This function is no longer needed with the redirect approach
// Keeping for reference but not used

// Handle when VAPI is connected and we need to call the clinic
async function handleVAPIConnectedAndCallClinic(vapiCallId, clinicNumber) {
  console.log('🔇 Muting VAPI...');
  
  try {
    // Mute VAPI
    await telnyxAPI(
      `/calls/${vapiCallId}/actions/mute`,
      'POST',
      { direction: 'both' }
    );
    console.log('✅ VAPI muted');
    
    // Now call the clinic
    console.log('📞 Calling clinic:', clinicNumber);
    
    const clinicCallResponse = await telnyxAPI(
      '/calls',
      'POST',
      {
        connection_id: process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_VOICE_API_APPLICATION_ID,
        to: clinicNumber,
        from: process.env.TELNYX_PHONE_NUMBER,
        webhook_url: `${process.env.WEBHOOK_URL || 'https://v0-new-project-qykgboija9j.vercel.app'}/api/telnyx/test-sip-transfer`,
        webhook_url_method: 'POST',
        timeout_secs: 60,
        client_state: Buffer.from(JSON.stringify({
          flow: 'calling_clinic',
          vapi_call_id: vapiCallId
        })).toString('base64')
      }
    );
    
    if (clinicCallResponse.ok) {
      const clinicCallId = clinicCallResponse.data.data.call_control_id;
      console.log('✅ Clinic call initiated:', clinicCallId);
      
      // Store the relationship
      callState.set(clinicCallId, {
        type: 'clinic_call',
        vapi_call_id: vapiCallId
      });
    }
    
  } catch (error) {
    console.error('❌ Error calling clinic:', error);
  }
}

// Bridge VAPI and clinic calls
async function bridgeVAPIAndClinic(clinicCallId, vapiCallId) {
  console.log('🌉 Bridging VAPI and clinic calls...');
  
  try {
    // First unmute VAPI
    await telnyxAPI(
      `/calls/${vapiCallId}/actions/unmute`,
      'POST',
      { direction: 'both' }
    );
    console.log('✅ VAPI unmuted');
    
    // Bridge the calls
    const bridgeResponse = await telnyxAPI(
      `/calls/${clinicCallId}/actions/bridge`,
      'POST',
      { call_control_id: vapiCallId }
    );
    
    if (bridgeResponse.ok) {
      console.log('✅ Calls bridged successfully!');
      console.log('🎯 Clinic is now connected to VAPI');
    } else {
      console.log('⚠️ Bridge failed, trying conference...');
      await conferenceFailback(clinicCallId, vapiCallId);
    }
    
  } catch (error) {
    console.error('❌ Error bridging calls:', error);
  }
}

// Conference fallback if bridge doesn't work
async function conferenceFailback(call1Id, call2Id) {
  const conferenceId = `vapi-bridge-${Date.now()}`;
  
  try {
    console.log('🎪 Creating conference bridge...');
    
    // Put both calls in the same conference
    await telnyxAPI(
      `/calls/${call1Id}/actions/join_conference`,
      'POST',
      {
        call_control_id: call1Id,
        name: conferenceId,
        mute: false,
        start_conference_on_enter: true
      }
    );
    
    await telnyxAPI(
      `/calls/${call2Id}/actions/join_conference`,
      'POST',
      {
        call_control_id: call2Id,
        name: conferenceId,
        mute: false
      }
    );
    
    console.log('✅ Both calls joined conference:', conferenceId);
    
  } catch (error) {
    console.error('❌ Conference fallback failed:', error);
  }
}

// Handle manual test
async function handleManualTest(controlId, res) {
  try {
    // Check if call exists
    const callStatus = await checkCallStatus(controlId);
    if (!callStatus.active) {
      return res.status(400).json({
        error: 'Call not active',
        state: callStatus.state
      });
    }
    
    // Simulate the VAPI-first flow
    const mockPayload = {
      call_control_id: controlId,
      from: process.env.TELNYX_PHONE_NUMBER,
      to: '+16093694379' // Your test number
    };
    
    return await handleVAPIFirstFlow(controlId, mockPayload, res);
    
  } catch (error) {
    return res.status(500).json({
      error: 'Manual test failed',
      message: error.message
    });
  }
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

// Check call status
async function checkCallStatus(controlId) {
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
