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
  console.log('🔍 Incoming webhook:', req.method, req.body?.event_type);
  
  // Handle webhook events
  if (req.method === 'POST') {
    const event = req.body;
    
    // Verify webhook signature if needed
    // const signature = req.headers['telnyx-signature'];
    
    switch (event.event_type) {
      case 'call.initiated':
        return handleCallInitiated(event, res);
      case 'call.answered':
        return handleCallAnswered(event, res);
      case 'media.started':
        return handleMediaStarted(event, res);
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
  const callId = event.data.payload.call_control_id;
  const callLegId = event.data.payload.call_leg_id;
  
  console.log('📞 Call initiated:', callId);
  
  // Create session in Supabase
  await getOrCreateSession(callLegId);
  
  // Answer the call
  try {
    await telnyxAPI(`/calls/${callId}/actions/answer`);
    console.log('✅ Call answered');
  } catch (err) {
    console.error('❌ Error answering call:', err);
  }
  
  return res.status(200).json({ received: true });
}

async function handleCallAnswered(event, res) {
  const callId = event.data.payload.call_control_id;
  const callLegId = event.data.payload.call_leg_id;
  
  console.log('📞 Call answered, starting streams...');
  
  // Get Railway WebSocket URLs
  const DEEPGRAM_WS_URL = process.env.DEEPGRAM_WS_URL || 'wss://telnyx-service.railway.internal:3002';
  const AMBIANCE_WS_URL = process.env.AMBIANCE_WS_URL || 'wss://ambiance-service.railway.internal:8081';
  
  try {
    // Start Deepgram stream for IVR detection
    const deepgramStream = await telnyxAPI(`/calls/${callId}/actions/streaming_start`, 'POST', {
      stream_url: DEEPGRAM_WS_URL,
      stream_track: 'inbound_track',
      enable_dialogflow: false
    });
    
    console.log('✅ Deepgram stream started:', deepgramStream.data.stream_id);
    
    // Update session with stream info
    await supabase
      .from('call_sessions')
      .update({ 
        deepgram_stream_id: deepgramStream.data.stream_id,
        stream_started: true 
      })
      .eq('call_id', callLegId);
    
    // Optionally start ambiance stream
    if (process.env.ENABLE_AMBIANCE === 'true') {
      const ambianceStream = await telnyxAPI(`/calls/${callId}/actions/streaming_start`, 'POST', {
        stream_url: AMBIANCE_WS_URL,
        stream_track: 'outbound_track',
        enable_dialogflow: false
      });
      
      console.log('✅ Ambiance stream started:', ambianceStream.data.stream_id);
      
      await supabase
        .from('call_sessions')
        .update({ ambiance_stream_id: ambianceStream.data.stream_id })
        .eq('call_id', callLegId);
    }
    
  } catch (err) {
    console.error('❌ Error starting streams:', err);
  }
  
  // Schedule classification check
  setTimeout(() => checkClassification(callId, callLegId), 3000);
  
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
    
    if (ivrAction) {
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
      // Stop ambiance if playing
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ambiance_stream_id')
        .eq('call_id', callLegId)
        .single();
      
      if (session?.ambiance_stream_id) {
        await telnyxAPI(`/calls/${callControlId}/actions/streaming_stop`, 'POST', {
          stream_id: session.ambiance_stream_id
        });
      }
      
      // Send DTMF
      await telnyxAPI(`/calls/${callControlId}/actions/send_dtmf`, 'POST', {
        digits: action.action_value,
        duration_millis: 250
      });
      
      // Restart ambiance after delay
      if (session?.ambiance_stream_id) {
        setTimeout(async () => {
          const AMBIANCE_WS_URL = process.env.AMBIANCE_WS_URL || 'wss://ambiance-service.railway.internal:8081';
          await telnyxAPI(`/calls/${callControlId}/actions/streaming_start`, 'POST', {
            stream_url: AMBIANCE_WS_URL,
            stream_track: 'outbound_track'
          });
        }, 1000);
      }
      
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

async function handleMediaStarted(event, res) {
  console.log('🎙️ Media streaming started');
  return res.status(200).json({ received: true });
}

async function handleCallHangup(event, res) {
  const callLegId = event.data.payload.call_leg_id;
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
