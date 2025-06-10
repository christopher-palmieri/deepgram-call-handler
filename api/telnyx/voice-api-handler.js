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
  const direction = event.payload?.direction;
  
  console.log('📞 Call initiated - Control ID:', callControlId);
  console.log('📞 Call initiated - Leg ID:', callLegId);
  console.log('📞 Call direction:', direction);
  
  // Create session in Supabase
  await getOrCreateSession(callLegId);
  
  // Only answer INBOUND calls
  if (direction === 'incoming') {
    try {
      await telnyxAPI(`/calls/${callControlId}/actions/answer`, 'POST');
      console.log('✅ Inbound call answered');
    } catch (err) {
      console.error('❌ Error answering call:', err);
    }
  } else {
    console.log('📤 Outbound call - no need to answer');
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
      stream_url: `${TELNYX_WS_URL}?call_id=${callLegId}&call_control_id=${callControlId}`,
      stream_track: 'both_tracks',
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
    
    // Start checking for IVR actions immediately and repeatedly
    // Using a different approach that doesn't rely on setTimeout
    startIVRActionPoller(callControlId, callLegId);
    
  } catch (err) {
    console.error('❌ Error starting stream:', err);
    console.error('❌ Error details:', JSON.stringify(err.response?.data || err, null, 2));
  }
  
  return res.status(200).json({ received: true });
}

// Start a polling mechanism for IVR actions
async function startIVRActionPoller(callControlId, callLegId) {
  // Poll every 2 seconds for up to 2 minutes
  const maxPolls = 60;
  let pollCount = 0;
  
  const pollInterval = setInterval(async () => {
    pollCount++;
    
    try {
      // Check if call is still active
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status')
        .eq('call_id', callLegId)
        .single();
      
      // Stop polling if call ended or human detected
      if (session?.call_status === 'completed' || 
          session?.ivr_detection_state === 'human' || 
          session?.ivr_detection_state === 'ivr_then_human' ||
          pollCount >= maxPolls) {
        clearInterval(pollInterval);
        
        if (session?.ivr_detection_state === 'human' || session?.ivr_detection_state === 'ivr_then_human') {
          console.log('👤 Human detected - transferring to VAPI');
          await transferToVAPI(callControlId);
        }
        return;
      }
      
      // Check for pending IVR actions
      const { data: ivrAction, error } = await supabase
        .from('ivr_events')
        .select('*')
        .eq('call_id', callLegId)
        .eq('executed', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (ivrAction && !error) {
        console.log('🎯 Found pending IVR action:', ivrAction);
        await executeIVRAction(callControlId, callLegId, ivrAction);
      }
      
    } catch (err) {
      console.error('❌ Polling error:', err);
    }
  }, 2000);
}

// Remove the old checkClassification function as we're using the poller now

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action);
  console.log('📞 Using Call Control ID:', callControlId);
  
  try {
    if (action.action_type === 'dtmf') {
      // Send DTMF
      const dtmfResponse = await telnyxAPI(`/calls/${callControlId}/actions/send_dtmf`, 'POST', {
        digits: action.action_value,
        duration_millis: 250 // Standard DTMF tone duration
      });
      
      console.log('✅ DTMF sent:', action.action_value);
      console.log('📞 DTMF Response:', dtmfResponse);
      
    } else if (action.action_type === 'speech') {
      // Speak text
      await telnyxAPI(`/calls/${callControlId}/actions/speak`, 'POST', {
        payload: action.action_value,
        voice: 'female',
        language: 'en-US'
      });
      
      console.log('✅ Speech sent:', action.action_value);
    }
    
    // Mark as executed
    await supabase
      .from('ivr_events')
      .update({ 
        executed: true,
        executed_at: new Date().toISOString()
      })
      .eq('id', action.id);
    
    console.log('✅ IVR action marked as executed');
    
  } catch (err) {
    console.error('❌ Error executing action:', err);
    console.error('❌ Error details:', JSON.stringify(err.response?.data || err, null, 2));
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
