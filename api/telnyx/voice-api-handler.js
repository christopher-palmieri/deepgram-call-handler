// api/telnyx/voice-api-handler.js - Updated with immediate DTMF execution
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Telnyx API configuration
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

// Store active call control IDs
const activeCallControls = new Map();

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

// Real-time subscription to IVR events
let ivrSubscription = null;

function setupRealtimeSubscription() {
  if (ivrSubscription) return;
  
  console.log('🔄 Setting up real-time IVR event subscription');
  
  ivrSubscription = supabase
    .channel('ivr-events')
    .on('postgres_changes', 
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'ivr_events',
        filter: 'executed=eq.false'
      }, 
      async (payload) => {
        console.log('🎯 Real-time IVR event received:', payload.new);
        const event = payload.new;
        
        // Check if we have the call control ID for this call
        const callControlId = activeCallControls.get(event.call_id);
        if (!callControlId) {
          console.log('⚠️ No active call control for:', event.call_id);
          return;
        }
        
        // Execute immediately
        if (event.action_type && event.action_value) {
          console.log('⚡ Executing IVR action immediately');
          await executeIVRAction(callControlId, event.call_id, event);
        }
      }
    )
    .subscribe();
}

// Initialize subscription on startup
setupRealtimeSubscription();

export default async function handler(req, res) {
  console.log('🔍 Incoming webhook:', req.method);
  
  if (req.method === 'POST') {
    const event = req.body?.data;
    
    if (!event) {
      console.error('❌ No event data found in request body');
      return res.status(200).json({ received: true });
    }
    
    console.log('📞 Event type:', event.event_type);
    
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
  
  // Store the mapping
  activeCallControls.set(callLegId, callControlId);
  
  // Create session in Supabase
  await getOrCreateSession(callLegId, callControlId);
  
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
  
  // Ensure mapping is stored
  activeCallControls.set(callLegId, callControlId);
  
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
    
    // Update session with stream info
    await supabase
      .from('call_sessions')
      .update({ 
        stream_id: streamResponse.data?.stream_id,
        stream_started: true,
        call_control_id: callControlId 
      })
      .eq('call_id', callLegId);
    
    // Also start checking periodically as backup
    startIVRActionChecker(callControlId, callLegId);
    
  } catch (err) {
    console.error('❌ Error starting stream:', err);
  }
  
  return res.status(200).json({ received: true });
}

// Simplified checker that runs less frequently as backup
async function startIVRActionChecker(callControlId, callLegId) {
  console.log('🔄 Starting backup IVR checker for call:', callLegId);
  
  let checkCount = 0;
  const maxChecks = 30; // 1 minute total
  
  const checkInterval = setInterval(async () => {
    checkCount++;
    
    try {
      // Check for pending actions
      const { data: ivrActions, error } = await supabase
        .from('ivr_events')
        .select('*')
        .eq('call_id', callLegId)
        .eq('executed', false)
        .not('action_value', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      
      const ivrAction = ivrActions && ivrActions.length > 0 ? ivrActions[0] : null;
      
      if (ivrAction) {
        console.log(`🎯 Backup checker found pending action:`, ivrAction);
        await executeIVRAction(callControlId, callLegId, ivrAction);
      }
      
      // Stop if max checks reached
      if (checkCount >= maxChecks) {
        console.log(`⏹️ Stopping backup checker for ${callLegId}`);
        clearInterval(checkInterval);
      }
      
    } catch (err) {
      console.error(`❌ Backup checker error:`, err.message);
    }
  }, 2000); // Check every 2 seconds
}

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action);
  console.log('📞 Using Call Control ID:', callControlId);
  
  if (!action.action_value) {
    console.error('❌ Skipping action with null/empty value');
    return;
  }
  
  try {
    if (action.action_type === 'dtmf') {
      const commandId = crypto.randomUUID();
      const clientState = Buffer.from(JSON.stringify({
        action_id: action.id,
        call_id: callLegId,
        timestamp: new Date().toISOString()
      })).toString('base64');
      
      const dtmfPayload = {
        digits: action.action_value,
        duration_millis: 500,
        client_state: clientState,
        command_id: commandId
      };
      
      console.log('📤 Sending DTMF:', dtmfPayload.digits);
      
      const dtmfResponse = await telnyxAPI(`/calls/${callControlId}/actions/send_dtmf`, 'POST', dtmfPayload);
      
      console.log('✅ DTMF sent successfully');
      
    } else if (action.action_type === 'speech') {
      const commandId = crypto.randomUUID();
      const clientState = Buffer.from(JSON.stringify({
        action_id: action.id,
        call_id: callLegId,
        timestamp: new Date().toISOString()
      })).toString('base64');
      
      await telnyxAPI(`/calls/${callControlId}/actions/speak`, 'POST', {
        payload: action.action_value,
        voice: 'female',
        language: 'en-US',
        client_state: clientState,
        command_id: commandId
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
    
  } catch (err) {
    console.error('❌ Error executing action:', err);
    
    // Mark as failed
    await supabase
      .from('ivr_events')
      .update({ 
        executed: true,
        executed_at: new Date().toISOString(),
        error: err.message
      })
      .eq('id', action.id);
  }
}

async function handleStreamingStarted(event, res) {
  console.log('🎙️ Media streaming started');
  console.log('📡 Stream ID:', event.payload?.stream_id);
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
  
  // Clean up mapping
  activeCallControls.delete(callLegId);
  
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

async function getOrCreateSession(callId, callControlId) {
  try {
    console.log('🔍 Getting/creating session for:', callId);
    
    const { data: existing, error: fetchError } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .maybeSingle(); // Use maybeSingle to avoid errors
    
    if (existing && !fetchError) {
      console.log('✅ Found existing session');
      return existing;
    }
    
    console.log('📝 Creating new session');
    const { data: newSession, error: insertError } = await supabase
      .from('call_sessions')
      .insert([{
        call_id: callId,
        call_control_id: callControlId,
        created_at: new Date().toISOString(),
        stream_started: false,
        ivr_detection_state: null
      }])
      .select()
      .single();
    
    if (insertError) {
      console.error('❌ Error creating session:', insertError);
      return null;
    }
    
    console.log('✅ Session created successfully');
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
