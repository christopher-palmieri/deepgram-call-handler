// api/telnyx/test-sip-transfer.js
// Modified to: 1) Call VAPI first, 2) Wait, 3) Mute VAPI, 4) Dial clinic

import fetch from 'node-fetch';

// Configuration constants
const CONFIG = {
  VAPI_SIP: 'sip:brandon-call-for-kits@sip.vapi.ai',
  TELNYX_API_URL: 'https://api.telnyx.com/v2',
  VAPI_CONNECT_DELAY_MS: 2000, // Wait 2 seconds for VAPI to connect
  TEST_CLINIC_NUMBER: '+16093694379', // Your test number
  SPEAK_BEFORE_TRANSFER: false
};

// Global state to track calls
const callState = new Map();
global.processedEvents = global.processedEvents || new Set();

export default async function handler(req, res) {
  console.log('🧪 TEST endpoint hit');
  console.log('📍 Method:', req.method);
  console.log('📍 Time:', new Date().toISOString());
  
  // GET: Status check
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Test endpoint ready - VAPI-first approach',
      timestamp: new Date().toISOString(),
      environment: {
        telnyx_api_key: process.env.TELNYX_API_KEY ? '✅ Set' : '❌ Missing',
        telnyx_phone: process.env.TELNYX_PHONE_NUMBER || 'Not set',
        connection_id: process.env.TELNYX_CONNECTION_ID || 'Not set',
        vapi_sip: CONFIG.VAPI_SIP
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
  
  // Manual test - initiate VAPI-first call flow
  if (body.start_test || body.clinic_number) {
    const clinicNumber = body.clinic_number || CONFIG.TEST_CLINIC_NUMBER;
    console.log('🧪 Starting VAPI-first test flow');
    console.log('📞 Will call VAPI, then dial clinic:', clinicNumber);
    
    return await initiateVAPIFirstFlow(clinicNumber, res);
  }
  
  // Unknown request
  return res.status(400).json({ 
    error: 'Invalid request',
    hint: 'Send { "start_test": true } or { "clinic_number": "+1234567890" }'
  });
}

// Initiate the VAPI-first flow
async function initiateVAPIFirstFlow(clinicNumber, res) {
  console.log('🚀 Step 1: Calling VAPI first');
  
  const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
  const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;
  const CONNECTION_ID = process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_VOICE_API_APPLICATION_ID;
  
  if (!TELNYX_API_KEY || !CONNECTION_ID) {
    return res.status(500).json({ 
      error: 'Missing configuration',
      required: ['TELNYX_API_KEY', 'TELNYX_CONNECTION_ID']
    });
  }
  
  try {
    // Step 1: Call VAPI
    const vapiCallPayload = {
      connection_id: CONNECTION_ID,
      to: CONFIG.VAPI_SIP,
      from: TELNYX_PHONE_NUMBER,
      webhook_url: `${process.env.WEBHOOK_URL || 'https://v0-new-project-qykgboija9j.vercel.app'}/api/telnyx/test-sip-transfer`,
      webhook_url_method: 'POST',
      timeout_secs: 60,
      custom_headers: [
        { name: 'X-Call-Type', value: 'vapi-first' },
        { name: 'X-Target-Clinic', value: clinicNumber }
      ],
      client_state: Buffer.from(JSON.stringify({
        flow: 'vapi_first',
        clinic_number: clinicNumber,
        step: 'calling_vapi'
      })).toString('base64')
    };
    
    console.log('📤 Calling VAPI:', JSON.stringify(vapiCallPayload, null, 2));
    
    const response = await telnyxAPI('/calls', 'POST', vapiCallPayload);
    
    if (response.ok) {
      const vapiCallId = response.data.data.call_control_id;
      console.log('✅ VAPI call initiated:', vapiCallId);
      
      // Store call state
      callState.set(vapiCallId, {
        type: 'vapi',
        clinic_number: clinicNumber,
        created_at: new Date().toISOString()
      });
      
      return res.status(200).json({
        success: true,
        message: 'VAPI call initiated, will dial clinic after connection',
        vapi_call_id: vapiCallId,
        next_steps: [
          '1. VAPI will be called',
          '2. After 2 seconds, VAPI will be muted',
          '3. Clinic will be dialed',
          '4. Both calls will be bridged'
        ]
      });
    } else {
      throw new Error('Failed to initiate VAPI call');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to start VAPI-first flow',
      message: error.message
    });
  }
}

// Handle Telnyx webhooks
async function handleTelnyxWebhook(event, res) {
  const eventType = event.event_type;
  const payload = event.payload || {};
  
  // Check for duplicate webhooks
  if (global.processedEvents?.has(event.id)) {
    console.log('⚠️ Duplicate webhook - already processed');
    return res.status(200).json({ received: true });
  }
  global.processedEvents.add(event.id);
  
  console.log(`📞 Webhook: ${eventType} at ${new Date().toISOString()}`);
  console.log(`📞 For call: ${payload.call_control_id}`);
  
  // Parse client state
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
    client_state: clientState
  });

  switch (eventType) {
    case 'call.answered':
      // Check if this is VAPI answering
      if (payload.to === CONFIG.VAPI_SIP && clientState.flow === 'vapi_first') {
        console.log('✅ VAPI answered! Waiting before muting...');
        
        // Wait for VAPI to fully connect
        setTimeout(async () => {
          await handleVAPIConnected(payload.call_control_id, clientState.clinic_number);
        }, CONFIG.VAPI_CONNECT_DELAY_MS);
      }
      // Check if this is clinic answering
      else if (clientState.flow === 'clinic_call') {
        console.log('✅ Clinic answered! Bridging with VAPI...');
        await bridgeCallsSimple(payload.call_control_id, clientState.vapi_call_id);
      }
      break;

    case 'call.bridged':
      console.log('✅ Calls successfully bridged!');
      break;

    case 'call.hangup':
      console.log('📞 Call ended:', payload.hangup_cause);
      callState.delete(payload.call_control_id);
      break;

    default:
      console.log(`📨 Other event: ${eventType}`);
  }

  return res.status(200).json({ received: true });
}

// Handle VAPI connection
async function handleVAPIConnected(vapiCallId, clinicNumber) {
  console.log('🔇 Step 2: Muting VAPI');
  
  try {
    // Mute VAPI
    await telnyxAPI(
      `/calls/${vapiCallId}/actions/mute`,
      'POST',
      { direction: 'both' } // Mute both directions
    );
    console.log('✅ VAPI muted');
    
    // Step 3: Call the clinic
    console.log('📞 Step 3: Calling clinic:', clinicNumber);
    
    const clinicCallPayload = {
      connection_id: process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_VOICE_API_APPLICATION_ID,
      to: clinicNumber,
      from: process.env.TELNYX_PHONE_NUMBER,
      webhook_url: `${process.env.WEBHOOK_URL || 'https://v0-new-project-qykgboija9j.vercel.app'}/api/telnyx/test-sip-transfer`,
      webhook_url_method: 'POST',
      timeout_secs: 60,
      custom_headers: [
        { name: 'X-Call-Type', value: 'clinic-call' },
        { name: 'X-VAPI-Call-ID', value: vapiCallId }
      ],
      client_state: Buffer.from(JSON.stringify({
        flow: 'clinic_call',
        vapi_call_id: vapiCallId,
        step: 'calling_clinic'
      })).toString('base64')
    };
    
    const response = await telnyxAPI('/calls', 'POST', clinicCallPayload);
    
    if (response.ok) {
      const clinicCallId = response.data.data.call_control_id;
      console.log('✅ Clinic call initiated:', clinicCallId);
      
      // Store clinic call info
      callState.set(clinicCallId, {
        type: 'clinic',
        vapi_call_id: vapiCallId,
        clinic_number: clinicNumber
      });
    }
    
  } catch (error) {
    console.error('❌ Error in VAPI connected handler:', error);
  }
}

// Bridge the calls using simple bridge command
async function bridgeCallsSimple(clinicCallId, vapiCallId) {
  console.log('🌉 Step 4: Bridging calls');
  
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
      console.log('🎯 VAPI and clinic are now connected');
    } else {
      console.error('❌ Bridge failed:', bridgeResponse.data);
      
      // Fallback: Try conference approach
      console.log('🔄 Trying conference fallback...');
      await conferenceFailback(clinicCallId, vapiCallId);
    }
    
  } catch (error) {
    console.error('❌ Error bridging calls:', error);
  }
}

// Conference fallback if bridge doesn't work
async function conferenceFailback(clinicCallId, vapiCallId) {
  const conferenceId = `bridge-${Date.now()}`;
  
  try {
    // Put clinic in conference
    await telnyxAPI(
      `/calls/${clinicCallId}/actions/join_conference`,
      'POST',
      {
        call_control_id: clinicCallId,
        name: conferenceId,
        mute: false
      }
    );
    
    // Put VAPI in same conference
    await telnyxAPI(
      `/calls/${vapiCallId}/actions/join_conference`,
      'POST',
      {
        call_control_id: vapiCallId,
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
