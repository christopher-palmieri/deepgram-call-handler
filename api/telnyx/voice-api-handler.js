// api/telnyx/voice-api-handler.js
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Telnyx API configuration
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

// Helper to make Telnyx API calls
async function telnyxAPI(endpoint, method = 'POST', body = {}) {
  const response = await fetch(`${TELNYX_API_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  
  const data = await response.json();
  if (!response.ok) {
    console.error('Telnyx API Error:', data);
    throw new Error(data.errors?.[0]?.detail || 'Telnyx API Error');
  }
  
  return data;
}

export default async function handler(req, res) {
  console.log('🔍 Incoming webhook:', req.method);
  console.log('🔍 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🔍 Body:', JSON.stringify(req.body, null, 2));
  
  // Handle webhook events
  if (req.method === 'POST') {
    const event = req.body?.data;  // Telnyx wraps events in a 'data' object
    
    if (!event) {
      console.error('❌ No event data found in request body');
      return res.status(200).json({ received: true });
    }
    
    console.log('📞 Event type:', event.event_type);
    console.log('📞 Event payload:', JSON.stringify(event.payload, null, 2));
    
    switch (event.event_type) {
      case 'call.initiated':
        return handleCallInitiated(event, res);
      case 'call.answered':
        return handleCallAnswered(event, res);
      case 'streaming.started':
        return handleStreamingStarted(event, res);
      case 'streaming.stopped':
        return handleStreamingStopped(event, res);
      case 'call.hangup':
        return handleCallHangup(event, res);
      default:
        console.log('Unhandled event type:', event.event_type);
        return res.status(200).json({ received: true });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleCallInitiated(event, res) {
  const callControlId = event.payload?.call_control_id;
  const callLegId = event.payload?.call_leg_id;
  
  console.log('📞 Call initiated - Control ID:', callControlId);
  console.log('📞 Call initiated - Leg ID:', callLegId);
  
  // Create session in Supabase
  await getOrCreateSession(callLegId);
  
  // Answer the call
  try {
    await telnyxAPI(`/calls/${callControlId}/actions/answer`, 'POST');
    console.log('✅ Call answered');
  } catch (err) {
    console.error('❌ Error answering call:', err);
  }
  
  return res.status(200).json({ received: true });
}

async function handleCallAnswered(event, res) {
  const callControlId = event.payload?.call_control_id;
  const callLegId = event.payload?.call_leg_id;
  
  console.log('📞 Call answered - Control ID:', callControlId);
  console.log('📞 Call answered - Leg ID:', callLegId);
  console.log('📞 Starting WebSocket stream...');
  
  // Get Railway WebSocket URL from environment
  const TELNYX_WS_URL = process.env.TELNYX_WS_URL || 'wss://telnyx-server-production.up.railway.app';
  
  try {
    // Start WebSocket stream for IVR detection
    const streamResponse = await telnyxAPI(`/calls/${callControlId}/actions/streaming_start`, 'POST', {
      stream_url: TELNYX_WS_URL,
      stream_track: 'both_tracks', // Match the example format
      enable_dialogflow: false
    });
    
    console.log('✅ WebSocket stream started:', streamResponse.data?.stream_id);
    console.log('📡 Stream URL:', TELNYX_WS_URL);
    
    // Update session with stream info
    await supabase
      .from('call_sessions')
      .update({ 
        stream_id: streamResponse.data?.stream_id,
        stream_started: true,
        call_control_id: callControlId 
      })
      .eq('call_id', callLegId);
    
  } catch (err) {
    console.error('❌ Error starting stream:', err);
    console.error('❌ Error details:', JSON.stringify(err.response?.data || err, null, 2));
  }
  
  // Schedule classification check
  setTimeout(() => checkClassification(callControlId, callLegId), 3000);
  
  return res.status(200).json({ received: true });
}

async function checkClassification(callControlId, callLegId) {
  console.log('🔍 Checking classification for:', callLegId);
  
  const { data: session } = await supabase
    .from('call_sessions')
    .select('ivr_detection_state')
    .eq('call_id', callLegId)
    .single();
  
  if (session?.ivr_detection_state === 'human' || session?.ivr_detection_state === 'ivr_then_human') {
    console.log('👤 Human detected - transferring to VAPI');
    await transferToVAPI(callControlId);
  } else {
    // Check for IVR actions
    const { data: ivrAction } = await supabase
      .from('ivr_events')
      .select('*')
      .eq('call_id', callLegId)
      .eq('executed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (ivrAction && !ivrAction.error) {
      await executeIVRAction(callControlId, callLegId, ivrAction);
    }
    
    // Continue checking
    setTimeout(() => checkClassification(callControlId, callLegId), 2000);
  }
}

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action);
  
  try {
    if (action.action_type === 'dtmf') {
      // Send DTMF
      await telnyxAPI(`/calls/${callControlId}/actions/send_dtmf`, 'POST', {
        digits: action.action_value,
        duration_millis: 250
      });
      
    } else if (action.action_type === 'speech') {
      // Speak text
      await telnyxAPI(`/calls/${callControlId}/actions/speak`, 'POST', {
        payload: action.action_value,
        voice: 'female',
        language: 'en-US'
      });
    }
    
    // Mark as executed
    await supabase
      .from('ivr_events')
      .update({ 
        executed: true,
        executed_at: new Date().toISOString()
      })
      .eq('id', action.id);
    
  } catch (err) {
    console.error('❌ Error executing action:', err);
  }
}

async function transferToVAPI(callControlId) {
  const transferTo = process.env.VAPI_SIP_ADDRESS 
    ? `sip:${process.env.VAPI_SIP_ADDRESS}`
    : process.env.VAPI_PHONE_NUMBER;
  
  try {
    await telnyxAPI(`/calls/${callControlId}/actions/transfer`, 'POST', {
      to: transferTo,
      sip_headers: {
        'X-Transfer-Reason': 'human-detected'
      }
    });
    console.log('✅ Transferred to VAPI');
  } catch (err) {
    console.error('❌ Transfer error:', err);
  }
}

async function handleStreamingStarted(event, res) {
  console.log('🎙️ Media streaming started');
  console.log('📡 Stream ID:', event.payload?.stream_id);
  console.log('📡 Media connection ID:', event.payload?.media_connection_id);
  return res.status(200).json({ received: true });
}

async function handleStreamingStopped(event, res) {
  console.log('🛑 Media streaming stopped');
  console.log('📡 Stream ID:', event.payload?.stream_id);
  return res.status(200).json({ received: true });
}

async function handleCallHangup(event, res) {
  const callLegId = event.payload?.call_leg_id;
  console.log('📞 Call ended:', callLegId);
  
  // Update session
  await supabase
    .from('call_sessions')
    .update({ 
      call_ended_at: new Date().toISOString(),
      call_status: 'completed'
    })
    .eq('call_id', callLegId);
  
  return res.status(200).json({ received: true });
}

async function getOrCreateSession(callId) {
  try {
    const { data: existing } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .single();
    
    if (existing) return existing;
    
    const { data: newSession } = await supabase
      .from('call_sessions')
      .insert([{
        call_id: callId,
        created_at: new Date().toISOString(),
        stream_started: false,
        ivr_detection_state: null
      }])
      .select()
      .single();
    
    return newSession;
  } catch (err) {
    console.error('❌ Session error:', err);
    return null;
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};
