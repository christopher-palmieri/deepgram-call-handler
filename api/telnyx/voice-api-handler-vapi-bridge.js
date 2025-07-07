// api/telnyx/voice-api-handler-vapi-bridge.js
// Simplified version that only handles clinic leg monitoring and classification

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

// In-memory tracking of conference sessions
const activeConferenceSessions = new Map();

// Helper: call Telnyx and return status + parsed JSON
async function telnyxAPI(endpoint, method = 'POST', body = {}) {
  const resp = await fetch(`${TELNYX_API_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: method !== 'GET' ? JSON.stringify(body) : undefined,
  });

  let data;
  try { data = await resp.json(); }
  catch (_){ data = null; }

  if (!resp.ok) {
    console.error('❌ Telnyx API Error', resp.status, data);
    throw new Error(data?.errors?.[0]?.detail || `HTTP ${resp.status}`);
  }

  return { status: resp.status, data };
}

export default async function handler(req, res) {
  // DEBUG DTMF via GET
  if (req.method === 'GET') {
    const { debug_call_control_id, digits } = req.query;
    if (debug_call_control_id) {
      const dt = digits || '1';
      console.log('🔧 Debug DTMF ➡️', debug_call_control_id, dt);
      try {
        const { status, data } = await telnyxAPI(
          `/calls/${debug_call_control_id}/actions/send_dtmf`,
          'POST',
          { digits: dt, duration_millis: 500 }
        );
        console.log(`🔧 Debug DTMF response ${status}:`, data);
        return res.status(200).json({ status, data });
      } catch (err) {
        console.error('🔧 Debug DTMF error:', err);
        return res.status(500).json({ error: err.message });
      }
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // WEBHOOK HANDLING
  if (req.method === 'POST') {
    console.log('🔍 Incoming webhook:', req.method);

    const event = req.body?.data;
    if (!event) {
      console.error('❌ No event data found');
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
  const callControlId = event.payload.call_control_id;
  const callLegId     = event.payload.call_leg_id;
  const direction     = event.payload.direction;

  console.log('📞 Call initiated - Control ID:', callControlId, 'Leg ID:', callLegId, 'Dir:', direction);

  // Check if this is a conference clinic leg
  if (event.payload.client_state) {
    try {
      const state = JSON.parse(Buffer.from(event.payload.client_state, 'base64').toString());
      console.log('🔍 Client state in call initiated:', state);
      
      if (state.is_conference_leg && state.session_id) {
        console.log('🎯 Conference clinic leg initiated');
        
        // Store in memory for fast lookup during classification
        activeConferenceSessions.set(callLegId, {
          conference_session_id: state.session_id,
          initiated_at: Date.now()
        });
        
        // Update database immediately with clinic leg info
        const { error } = await supabase
          .from('call_sessions')
          .update({
            clinic_leg_id: callLegId,
            telnyx_leg_id: callLegId,
            call_control_id: callControlId,
            call_initiated_at: new Date().toISOString()
          })
          .eq('conference_session_id', state.session_id);
          
        if (error) {
          console.error('❌ Error updating clinic leg info:', error);
        } else {
          console.log('✅ Updated conference session with clinic leg info');
        }
      }
    } catch (e) {
      console.log('Failed to parse client state:', e);
    }
  }

  // Answer incoming calls
  if (direction === 'incoming') {
    try {
      await telnyxAPI(`/calls/${callControlId}/actions/answer`);
      console.log('✅ Inbound call answered');
    } catch (err) {
      console.error('❌ Error answering call:', err);
    }
  }

  return res.status(200).json({ received: true });
}

async function handleCallAnswered(event, res) {
  const ctl = event.payload.call_control_id;
  const leg = event.payload.call_leg_id;
  console.log('📞 Call answered - Control ID:', ctl, 'Leg ID:', leg);

  // Start WebSocket streaming for IVR classification
  const WS = process.env.TELNYX_WS_URL;
  try {
    const { data: sr } = await telnyxAPI(
      `/calls/${ctl}/actions/streaming_start`,
      'POST',
      {
        stream_url: `${WS}?call_id=${leg}&call_control_id=${ctl}`,
        stream_track: 'inbound_track',
        enable_dialogflow: false
      }
    );
    console.log('✅ Stream started:', sr.stream_id);

    // Start monitoring for IVR classification updates
    startClassificationMonitor(ctl, leg);
  } catch (err) {
    console.error('❌ Error starting stream:', err);
  }
  
  return res.status(200).json({ received: true });
}

// Monitor for IVR classification and update conference session
async function startClassificationMonitor(ctl, leg) {
  console.log('👁️ Starting classification monitor for call:', leg);
  const monitorId = crypto.randomUUID().slice(0, 8);
  let checkCount = 0;
  const maxChecks = 240; // 2 minutes at 500ms intervals

  const monitor = setInterval(async () => {
    checkCount++;
    
    try {
      // Get conference session ID from memory or database
      let sessionId = activeConferenceSessions.get(leg)?.conference_session_id;
      
      if (!sessionId) {
        // Fallback to database lookup
        const { data } = await supabase
          .from('call_sessions')
          .select('conference_session_id')
          .eq('telnyx_leg_id', leg)
          .single();
        
        sessionId = data?.conference_session_id;
      }
      
      if (!sessionId) {
        console.log(`⚠️ [${monitorId}] No conference session found yet for leg:`, leg);
        
        // Stop monitoring if we can't find session after many attempts
        if (checkCount > 20) {
          console.log(`⏹️ [${monitorId}] Stopping monitor - no session found`);
          clearInterval(monitor);
        }
        return;
      }
      
      // Check current classification state
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status')
        .eq('conference_session_id', sessionId)
        .single();

      // Stop if already classified or call ended
      if (session?.ivr_detection_state || session?.call_status === 'completed' || checkCount >= maxChecks) {
        console.log(`⏹️ [${monitorId}] Stopping classification monitor`);
        clearInterval(monitor);
        activeConferenceSessions.delete(leg);
        
        // Clean up IVR action poller if running
        if (global.actionPollers && global.actionPollers[leg]) {
          clearInterval(global.actionPollers[leg]);
          delete global.actionPollers[leg];
        }
        return;
      }
      
      // Check if WebSocket has classified this call
      const { data: wsClassification } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state')
        .eq('telnyx_leg_id', leg)
        .not('ivr_detection_state', 'is', null)
        .single();
      
      if (wsClassification?.ivr_detection_state) {
        console.log(`🎯 [${monitorId}] Classification detected:`, wsClassification.ivr_detection_state);
        
        // Update the conference session with classification
        await supabase
          .from('call_sessions')
          .update({ 
            ivr_detection_state: wsClassification.ivr_detection_state,
            ivr_classified_at: new Date().toISOString()
          })
          .eq('conference_session_id', sessionId);
        
        console.log('✅ Updated conference session with classification');
        
        // Clean up
        clearInterval(monitor);
        activeConferenceSessions.delete(leg);
        
        // If IVR detected, start action poller
        if (wsClassification.ivr_detection_state === 'ivr_only' && (!global.actionPollers || !global.actionPollers[leg])) {
          console.log(`🤖 [${monitorId}] IVR detected, starting action poller`);
          startIVRActionPoller(ctl, leg, sessionId);
        }
      }
      
    } catch (err) {
      console.error(`❌ [${monitorId}] Monitor error:`, err.message);
    }
  }, 500);

  console.log(`✅ [${monitorId}] Classification monitor running`);
}

// Initialize global storage for action pollers
if (!global.actionPollers) {
  global.actionPollers = {};
}

// Poll for IVR actions when IVR is detected
async function startIVRActionPoller(ctl, leg, sessionId) {
  if (global.actionPollers[leg]) {
    console.log('⚠️ Action poller already running for', leg);
    return;
  }

  console.log('🔄 Starting IVR action poller for call:', leg);
  const pollerId = crypto.randomUUID().slice(0, 8);
  let count = 0;
  const maxPolls = 60; // 2 minutes at 2s intervals

  const timer = setInterval(async () => {
    count++;
    
    try {
      // Check if still IVR and active
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status')
        .eq('conference_session_id', sessionId)
        .single();

      if (!session || 
          session.call_status !== 'active' ||
          session.ivr_detection_state !== 'ivr_only' ||
          count >= maxPolls) {
        
        console.log(`⏹️ [${pollerId}] Stopping action poller`);
        clearInterval(timer);
        delete global.actionPollers[leg];
        return;
      }

      // Check for pending IVR actions
      const { data: actions } = await supabase
        .from('ivr_events')
        .select('*')
        .eq('call_id', leg)
        .eq('executed', false)
        .not('action_value', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      const action = actions?.[0];
      if (action) {
        console.log(`🎯 [${pollerId}] Executing action:`, action.action_type, action.action_value);
        await executeIVRAction(ctl, leg, action);
      }
      
    } catch (err) {
      console.error(`❌ [${pollerId}] Poll error:`, err.message);
    }
  }, 2000);

  global.actionPollers[leg] = timer;
  console.log(`✅ [${pollerId}] Action poller running`);
}

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action.id, action.action_type, action.action_value);

  try {
    if (action.action_type === 'dtmf') {
      const payload = {
        digits: action.action_value,
        duration_millis: 500,
        client_state: action.client_state,
        command_id: action.command_id
      };
      
      await telnyxAPI(`/calls/${callControlId}/actions/send_dtmf`, 'POST', payload);
      console.log('✅ DTMF sent successfully');
      
    } else if (action.action_type === 'speech') {
      const payload = {
        payload: action.action_value,
        voice: 'female',
        language: 'en-US',
        client_state: action.client_state,
        command_id: action.command_id
      };
      
      await telnyxAPI(`/calls/${callControlId}/actions/speak`, 'POST', payload);
      console.log('✅ Speech sent successfully');
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
    console.error('❌ executeIVRAction error:', err);
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
  console.log('🎙️ streaming.started:', event.payload.stream_id);
  return res.status(200).json({ received: true });
}

async function handleStreamingStopped(event, res) {
  console.log('🛑 streaming.stopped:', event.payload.stream_id);
  
  const callLegId = event.payload.call_leg_id;
  if (callLegId) {
    // Clean up memory
    activeConferenceSessions.delete(callLegId);
    
    // Clean up action poller
    if (global.actionPollers && global.actionPollers[callLegId]) {
      clearInterval(global.actionPollers[callLegId]);
      delete global.actionPollers[callLegId];
      console.log('🧹 Cleaned up action poller on stream stop');
    }
  }
  
  return res.status(200).json({ received: true });
}

async function handleCallHangup(event, res) {
  const leg = event.payload.call_leg_id;
  console.log('📞 call.hangup:', leg);
  
  // Clean up memory
  activeConferenceSessions.delete(leg);
  
  // Clean up action poller
  if (global.actionPollers && global.actionPollers[leg]) {
    clearInterval(global.actionPollers[leg]);
    delete global.actionPollers[leg];
    console.log('🧹 Cleaned up action poller on hangup');
  }
  
  // Update call status
  await supabase
    .from('call_sessions')
    .update({ 
      call_ended_at: new Date().toISOString(), 
      call_status: 'completed' 
    })
    .eq('telnyx_leg_id', leg);
    
  return res.status(200).json({ received: true });
}

// Clean up stale in-memory entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [legId, info] of activeConferenceSessions.entries()) {
    if (now - info.initiated_at > 300000) { // 5 minutes
      console.log('🧹 Cleaning up stale conference session:', legId);
      activeConferenceSessions.delete(legId);
    }
  }
}, 60000); // Every minute

export const config = {
  api: {
    bodyParser: true
  }
};
