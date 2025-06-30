// api/telnyx/test-sip-transfer.js
// VAPI-first implementation with call interception

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
  
  // GET: Status check
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Test endpoint ready - VAPI-first intercept mode',
      timestamp: new Date().toISOString(),
      environment: {
        telnyx_api_key: process.env.TELNYX_API_KEY ? '✅ Set' : '❌ Missing',
        telnyx_phone: process.env.TELNYX_PHONE_NUMBER || 'Not set',
        auto_transfer: process.env.TEST_AUTO_TRANSFER === 'true' ? '✅ Enabled' : '❌ Disabled',
        webhook_url: process.env.WEBHOOK_URL || 'Not set',
        connection_id: process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_VOICE_API_APPLICATION_ID || 'Not set'
      },
      vapi_config: {
        sip_address: CONFIG.VAPI_SIP
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
  
  // Unknown request
  return res.status(400).json({ 
    error: 'Invalid request',
    expected: 'Telnyx webhook with data.event_type'
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
    from: payload.from,
    to: payload.to,
    direction: payload.direction,
    client_state: clientState
  });

  switch (eventType) {
    case 'call.initiated':
      console.log('📞 Call initiated');
      
      // INTERCEPT: Redirect outbound calls to VAPI first
      if (shouldUseVAPIFirst(payload, clientState) && payload.direction === 'outgoing') {
        console.log('🔄 Intercepting call - redirecting to VAPI first...');
        
        const originalTarget = payload.to;
        console.log('📍 Original target (clinic):', originalTarget);
        
        try {
          await telnyxAPI(
            `/calls/${payload.call_control_id}/actions/transfer`,
            'POST',
            {
              to: CONFIG.VAPI_SIP,
              from: payload.from,
              client_state: Buffer.from(JSON.stringify({
                flow: 'vapi_first_intercepted',
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
      break;

    case 'call.answered':
      console.log('✅ Call answered');
      
      // Check if this is VAPI answering after our redirect
      if (clientState.flow === 'vapi_first_intercepted' && payload.to.includes('sip:')) {
        console.log('✅ VAPI answered! Waiting before calling clinic...');
        
        const clinicNumber = clientState.original_target || clientState.clinic_number;
        console.log('📞 Will call clinic:', clinicNumber);
        
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
    if (clientState.flow === 'vapi_first_intercepted' || 
        clientState.flow === 'calling_clinic' ||
        payload.to?.includes('sip:')) {
      return false;
    }
    return true;
  }
  
  return false;
}

// Handle when VAPI is connected and we need to call the clinic
async function handleVAPIConnectedAndCallClinic(vapiCallId, clinicNumber) {
  console.log('🔇 Step 1: Muting VAPI...');
  
  try {
    // Mute VAPI
    await telnyxAPI(
      `/calls/${vapiCallId}/actions/mute`,
      'POST',
      { direction: 'both' }
    );
    console.log('✅ VAPI muted');
    
    // Now call the clinic
    console.log('📞 Step 2: Calling clinic:', clinicNumber);
    
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
    } else {
      console.error('❌ Failed to call clinic:', clinicCallResponse.data);
    }
    
  } catch (error) {
    console.error('❌ Error in VAPI connect handler:', error);
  }
}

// Bridge VAPI and clinic calls
async function bridgeVAPIAndClinic(clinicCallId, vapiCallId) {
  console.log('🌉 Step 3: Bridging VAPI and clinic calls...');
  
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
      console.log('🎯 Clinic is now connected to VAPI with no ringing!');
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
