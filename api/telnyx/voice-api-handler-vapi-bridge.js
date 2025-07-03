// api/telnyx/voice-api-handler-vapi-bridge.js
// New version that uses conference bridging while keeping original intact

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';
const EDGE_FUNCTION_URL = process.env.SUPABASE_EDGE_FUNCTION_URL || 'https://your-project.supabase.co/functions/v1/telnyx-conference-vapi';

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

// Helper: Call the edge function to initiate conference
async function initiateConferenceBridge(callLegId) {
  console.log('🌉 Initiating conference bridge via edge function');
  
  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        call_leg_id: callLegId
      })
    });

    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Edge function failed');
    }

    console.log('✅ Conference initiated:', result.session_id);
    return result;
    
  } catch (error) {
    console.error('❌ Failed to initiate conference:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  // — DEBUG DTMF via GET?
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

  // — WEBHOOK HANDLING
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

  console.log(
    '📞 Call initiated - Control ID:',
    callControlId,
    'Leg ID:',
    callLegId,
    'Dir:',
    direction
  );

  // Check if this is a conference clinic leg
  let conferenceInfo = null;
  let actualCallId = callLegId;
  
  if (event.payload.client_state) {
    try {
      const state = JSON.parse(Buffer.from(event.payload.client_state, 'base64').toString());
      console.log('🔍 Client state in call initiated:', state);
      if (state.is_conference_leg) {
        console.log('🎯 Conference clinic leg initiated');
        conferenceInfo = state;
        actualCallId = `clinic-${state.session_id}`;
        console.log('📍 Using actualCallId:', actualCallId);
      }
    } catch (e) {
      console.log('Not a conference leg, using regular flow');
    }
  }

  // CRITICAL: Clean up ALL stale actions for this call_id first
  try {
    const { data: existingActions } = await supabase
      .from('ivr_events')
      .select('id, created_at, transcript')
      .eq('call_id', callLegId) // Always use actual Telnyx leg ID for ivr_events
      .eq('executed', false);
    
    if (existingActions && existingActions.length > 0) {
      console.log(`⚠️ Found ${existingActions.length} existing actions for call_id ${callLegId}`);
      
      const { data: cleaned } = await supabase
        .from('ivr_events')
        .update({ 
          executed: true, 
          executed_at: new Date().toISOString(),
          error: 'expired_same_call_id_reused'
        })
        .eq('call_id', callLegId)
        .eq('executed', false)
        .select();
      
      if (cleaned) {
        console.log(`🧹 Cleaned up ${cleaned.length} stale actions for reused call_id ${callLegId}`);
      }
    }
  } catch (err) {
    console.error('❌ Error cleaning stale actions:', err);
  }

  // 1) Create or fetch your Supabase session
  const session = await getOrCreateSession(actualCallId);
  console.log('📊 Session created/fetched:', {
    call_id: session?.call_id,
    telnyx_leg_id: session?.telnyx_leg_id,
    actualCallId,
    originalLegId: callLegId
  });

  // 2) Persist the Telnyx control ID and conference info
  try {
    const updateData = { 
      call_control_id: callControlId,
      call_initiated_at: new Date().toISOString(),
      bridge_mode: true,
      telnyx_leg_id: callLegId // Always store the actual Telnyx leg ID
    };
    
    if (conferenceInfo) {
      updateData.conference_session_id = conferenceInfo.session_id;
      updateData.vapi_control_id = conferenceInfo.vapi_control_id;
      updateData.target_number = event.payload.to;
    }
    
    console.log('📝 Updating session with:', updateData);
    
    const { data: updated, error } = await supabase
      .from('call_sessions')
      .update(updateData)
      .eq('call_id', actualCallId)
      .select();
      
    if (error) {
      console.error('❌ Error updating session:', error);
    } else {
      console.log('✅ Updated session:', updated?.[0]);
    }
  } catch (err) {
    console.error('❌ Could not save call_control_id:', err);
  }

  // 3) If this is an inbound call, answer it
  if (direction === 'incoming') {
    try {
      await telnyxAPI(`/calls/${callControlId}/actions/answer`);
      console.log('✅ Inbound call answered');
    } catch (err) {
      console.error('❌ Error answering call:', err);
    }
  } else {
    console.log('📤 Outbound call — nothing to answer');
  }

  return res.status(200).json({ received: true });
}

async function handleCallAnswered(event, res) {
  console.log('📞 Call answered - Bridge mode');
  
  const ctl = event.payload.call_control_id;
  const leg = event.payload.call_leg_id;
  console.log('📞 Call answered - Control ID:', ctl, 'Leg ID:', leg);

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

    await supabase
      .from('call_sessions')
      .update({ stream_started: true })
      .eq('call_id', leg);

    // Start monitoring for IVR detection changes (bridge mode)
    startIVRMonitorBridgeMode(ctl, leg);
  } catch (err) {
    console.error('❌ Error starting stream:', err);
  }
  return res.status(200).json({ received: true });
}

// Bridge mode monitor that initiates conference instead of direct transfer
async function startIVRMonitorBridgeMode(ctl, leg) {
  console.log('🌉 Starting IVR detection monitor (BRIDGE MODE) for call:', leg);
  const monitorId = crypto.randomUUID().slice(0, 8);
  let checkCount = 0;
  const maxChecks = 480; // 2 minutes at 250ms intervals
  let conferenceInitiated = false;

  const monitor = setInterval(async () => {
    checkCount++;
    
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status, transfer_initiated, conference_session_id')
        .eq('call_id', leg)
        .maybeSingle();

      const shouldStop = !session || 
                        session.call_status === 'completed' || 
                        session.conference_session_id || // Conference already created
                        (session.transfer_initiated && conferenceInitiated) ||
                        (!session.ivr_detection_state && checkCount >= maxChecks);
      
      if (shouldStop) {
        console.log(`⏹️ [${monitorId}] Stopping IVR monitor (bridge mode)`);
        clearInterval(monitor);
        
        if (global.actionPollers && global.actionPollers[leg]) {
          clearInterval(global.actionPollers[leg]);
          delete global.actionPollers[leg];
        }
        
        return;
      }

      // Check if human detected
      if (['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
        console.log(`👤 [${monitorId}] Human detected - initiating conference bridge via edge function`);
        
        conferenceInitiated = true;
        await supabase
          .from('call_sessions')
          .update({ transfer_initiated: true })
          .eq('call_id', leg);
        
        if (global.actionPollers && global.actionPollers[leg]) {
          clearInterval(global.actionPollers[leg]);
          delete global.actionPollers[leg];
        }
        
        // Call edge function to create conference
        try {
          const conferenceResult = await initiateConferenceBridge(leg);
          
          // Store conference session ID
          await supabase
            .from('call_sessions')
            .update({ 
              conference_session_id: conferenceResult.session_id,
              conference_created_at: new Date().toISOString()
            })
            .eq('call_id', leg);
            
          console.log('✅ Conference bridge created:', conferenceResult.session_id);
            
        } catch (err) {
          console.error('❌ Conference bridge creation error:', err);
          
          // Update error state
          await supabase
            .from('call_sessions')
            .update({ 
              conference_error: err.message,
              conference_error_at: new Date().toISOString()
            })
            .eq('call_id', leg);
        }
        
        clearInterval(monitor);
        return;
      }

      // If IVR detected and no action poller running, start one
      if (session.ivr_detection_state === 'ivr_only' && 
          (!global.actionPollers || !global.actionPollers[leg])) {
        console.log(`🤖 [${monitorId}] IVR detected, starting action poller (bridge mode)`);
        startIVRActionPollerBridgeMode(ctl, leg);
      }

    } catch (err) {
      console.error(`❌ [${monitorId}] Monitor error:`, err.message);
    }
  }, 250);

  console.log(`✅ [${monitorId}] IVR monitor running (bridge mode)`);
}

// Initialize global storage for action pollers
if (!global.actionPollers) {
  global.actionPollers = {};
}

// Conference IVR monitor - monitors clinic leg and unmutes VAPI when appropriate
async function startConferenceIVRMonitor(ctl, dbCallId, telnyxLegId, conferenceInfo) {
  console.log('🌉 Starting Conference IVR monitor');
  console.log('   DB Call ID:', dbCallId);
  console.log('   Telnyx Leg ID:', telnyxLegId);
  
  const monitorId = crypto.randomUUID().slice(0, 8);
  let checkCount = 0;
  const maxChecks = 480; // 2 minutes at 250ms intervals

  const monitor = setInterval(async () => {
    checkCount++;
    
    try {
      // Check session by database ID
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status, vapi_on_hold')
        .eq('call_id', dbCallId)
        .maybeSingle();

      const shouldStop = !session || 
                        session.call_status === 'completed' || 
                        !session.vapi_on_hold || // Already unmuted
                        (!session.ivr_detection_state && checkCount >= maxChecks);
      
      if (shouldStop) {
        console.log(`⏹️ [${monitorId}] Stopping conference IVR monitor`);
        clearInterval(monitor);
        
        if (global.actionPollers && global.actionPollers[telnyxLegId]) {
          clearInterval(global.actionPollers[telnyxLegId]);
          delete global.actionPollers[telnyxLegId];
        }
        
        return;
      }

      // Check if human detected on clinic leg
      if (['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
        console.log(`👤 [${monitorId}] Human detected on clinic leg - unmuting VAPI`);
        
        // Unmute VAPI
        try {
          const unholdResp = await fetch(
            `${TELNYX_API_URL}/calls/${conferenceInfo.vapi_control_id}/actions/unhold`,
            { 
              method: 'POST', 
              headers: { 
                'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
                'Content-Type':'application/json' 
              } 
            }
          );
          console.log('Unhold response:', unholdResp.status);

          // Update database
          await supabase
            .from('call_sessions')
            .update({ 
              vapi_on_hold: false,
              vapi_unmuted_at: new Date().toISOString(),
              vapi_unmute_reason: 'human_detected_clinic_leg'
            })
            .eq('call_id', dbCallId);

        } catch (err) {
          console.error('❌ Failed to unmute VAPI:', err);
        }
        
        // Stop monitoring
        clearInterval(monitor);
        if (global.actionPollers && global.actionPollers[telnyxLegId]) {
          clearInterval(global.actionPollers[telnyxLegId]);
          delete global.actionPollers[telnyxLegId];
        }
        
        return;
      }

      // If IVR detected and no action poller running, start one
      if (session.ivr_detection_state === 'ivr_only' && 
          (!global.actionPollers || !global.actionPollers[telnyxLegId])) {
        console.log(`🤖 [${monitorId}] IVR detected on clinic leg, starting action poller`);
        startConferenceIVRActionPoller(ctl, dbCallId, telnyxLegId, conferenceInfo);
      }

    } catch (err) {
      console.error(`❌ [${monitorId}] Conference monitor error:`, err.message);
    }
  }, 250);

  console.log(`✅ [${monitorId}] Conference IVR monitor running`);
}

// Conference IVR action poller - handles DTMF/speech for clinic leg
async function startConferenceIVRActionPoller(ctl, dbCallId, telnyxLegId, conferenceInfo) {
  if (global.actionPollers[telnyxLegId]) {
    console.log('⚠️ Action poller already running for', telnyxLegId);
    return;
  }

  console.log('🔄 Starting Conference IVR action poller');
  console.log('   DB Call ID:', dbCallId);
  console.log('   Telnyx Leg ID:', telnyxLegId);
  
  const pollerId = crypto.randomUUID().slice(0, 8);
  let count = 0, max = 60;

  const timer = setInterval(async () => {
    count++;
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status, vapi_on_hold')
        .eq('call_id', dbCallId)
        .maybeSingle();

      if (!session || 
          session.call_status === 'completed' ||
          !session.vapi_on_hold ||
          ['human', 'ivr_then_human'].includes(session.ivr_detection_state) ||
          count >= max) {
        
        console.log(`⏹️ [${pollerId}] Stopping conference action poller`);
        clearInterval(timer);
        delete global.actionPollers[telnyxLegId];
        return;
      }

      if (session.ivr_detection_state === 'ivr_only') {
        // Check for actions using the Telnyx leg ID (that's what Railway will use)
        const { data: actions } = await supabase
          .from('ivr_events')
          .select('*')
          .eq('call_id', telnyxLegId)  // Use actual Telnyx leg ID
          .eq('executed', false)
          .not('action_value', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);

        const action = actions && actions[0];
        if (action) {
          console.log(`🎯 [${pollerId}] Executing conference action:`, action.action_type, action.action_value);
          await executeIVRAction(ctl, telnyxLegId, action);  // Use Telnyx leg ID
          
          // Check if this action should trigger VAPI unmute
          if (action.action_type === 'dtmf' && /^[1-9]$/.test(action.action_value)) {
            console.log('🔊 DTMF action completed - unmuting VAPI');
            
            const unholdResp = await fetch(
              `${TELNYX_API_URL}/calls/${conferenceInfo.vapi_control_id}/actions/unhold`,
              { 
                method: 'POST', 
                headers: { 
                  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
                  'Content-Type':'application/json' 
                } 
              }
            );
            
            await supabase
              .from('call_sessions')
              .update({ 
                vapi_on_hold: false,
                vapi_unmuted_at: new Date().toISOString(),
                vapi_unmute_reason: 'ivr_action_completed'
              })
              .eq('call_id', dbCallId);  // Update using DB call ID
          }
        }
      }
    } catch (err) {
      console.error(`❌ [${pollerId}] Conference poll error:`, err.message);
    }
  }, 2000);

  global.actionPollers[telnyxLegId] = timer;
  console.log(`✅ [${pollerId}] Conference action poller running`);
}

// Bridge mode action poller
async function startIVRActionPollerBridgeMode(ctl, leg) {
  if (global.actionPollers[leg]) {
    console.log('⚠️ Action poller already running for', leg);
    return;
  }

  console.log('🔄 Starting IVR action poller (BRIDGE MODE) for call:', leg);
  const pollerId = crypto.randomUUID().slice(0, 8);
  let count = 0, max = 60;

  const timer = setInterval(async () => {
    count++;
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status, transfer_initiated, conference_session_id')
        .eq('call_id', leg)
        .maybeSingle();

      if (!session || 
          session.call_status === 'completed' ||
          session.transfer_initiated ||
          session.conference_session_id ||
          ['human', 'ivr_then_human'].includes(session.ivr_detection_state) ||
          count >= max) {
        
        console.log(`⏹️ [${pollerId}] Stopping action poller (bridge mode)`);
        clearInterval(timer);
        delete global.actionPollers[leg];
        return;
      }

      if (session.ivr_detection_state === 'ivr_only') {
        const { data: callSession } = await supabase
          .from('call_sessions')
          .select('created_at, call_initiated_at')
          .eq('call_id', leg)
          .single();
        
        if (!callSession) return;

        const callStartTime = callSession.call_initiated_at || callSession.created_at;

        const { data: actions } = await supabase
          .from('ivr_events')
          .select('*')
          .eq('call_id', leg)
          .eq('executed', false)
          .not('action_value', 'is', null)
          .gte('created_at', callStartTime)
          .order('created_at', { ascending: false })
          .limit(1);

        const action = actions && actions[0];
        if (action) {
          const actionTime = new Date(action.created_at);
          const callTime = new Date(callStartTime);
          
          if (actionTime < callTime) {
            await supabase
              .from('ivr_events')
              .update({ 
                executed: true, 
                executed_at: new Date().toISOString(),
                error: 'created_before_call_start'
              })
              .eq('id', action.id);
            return;
          }
          
          console.log(`🎯 [${pollerId}] Executing action:`, action.action_type, action.action_value);
          await executeIVRAction(ctl, leg, action);
          
          // In bridge mode, we'll rely on the conference webhook to unmute VAPI
          // after successful IVR actions
        }
      }
    } catch (err) {
      console.error(`❌ [${pollerId}] Poll error:`, err.message);
    }
  }, 2000);

  global.actionPollers[leg] = timer;
  console.log(`✅ [${pollerId}] Action poller running (bridge mode)`);
}

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action.id, action.action_type, action.action_value);

  const { data: session } = await supabase
    .from('call_sessions')
    .select('ivr_detection_state, transfer_initiated, call_status, call_control_id')
    .eq('call_id', callLegId)
    .maybeSingle();

  if (!session || session.call_status !== 'active' || 
      session.transfer_initiated || 
      ['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
    console.log('⏭️ Skipping IVR action - call not active or human detected');
    await supabase
      .from('ivr_events')
      .update({ 
        executed: true, 
        executed_at: new Date().toISOString(), 
        error: 'skipped_due_to_state' 
      })
      .eq('id', action.id);
    return;
  }

  const common = {
    client_state: Buffer.from(JSON.stringify({
      action_id: action.id,
      call_id:   callLegId,
      timestamp: new Date().toISOString()
    })).toString('base64'),
    command_id: crypto.randomUUID()
  };

  try {
    if (action.action_type === 'dtmf') {
      const payload = {
        digits:           action.action_value,
        duration_millis:  500,
        ...common
      };
      console.log('📤 Sending DTMF:', payload);
      const { status, data } = await telnyxAPI(
        `/calls/${callControlId}/actions/send_dtmf`,
        'POST',
        payload
      );
      console.log(`✅ DTMF response ${status}:`, data);

    } else if (action.action_type === 'speech') {
      const payload = {
        payload: action.action_value,
        voice:   'female',
        language:'en-US',
        ...common
      };
      const { status, data } = await telnyxAPI(
        `/calls/${callControlId}/actions/speak`,
        'POST',
        payload
      );
      console.log(`✅ Speech response ${status}:`, data);
    }

    await supabase
      .from('ivr_events')
      .update({ 
        executed: true, 
        executed_at: new Date().toISOString(),
        bridge_mode: true // Mark as executed in bridge mode
      })
      .eq('id', action.id);

  } catch (err) {
    console.error('❌ executeIVRAction error:', err);
    await supabase
      .from('ivr_events')
      .update({ executed: true, executed_at: new Date().toISOString(), error: err.message })
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
  if (callLegId && global.actionPollers && global.actionPollers[callLegId]) {
    clearInterval(global.actionPollers[callLegId]);
    delete global.actionPollers[callLegId];
    console.log('🧹 Cleaned up action poller on stream stop');
  }
  
  return res.status(200).json({ received: true });
}

async function handleCallHangup(event, res) {
  const leg = event.payload.call_leg_id;
  console.log('📞 call.hangup:', leg);
  
  if (global.actionPollers && global.actionPollers[leg]) {
    clearInterval(global.actionPollers[leg]);
    delete global.actionPollers[leg];
    console.log('🧹 Cleaned up action poller on hangup');
  }
  
  await supabase
    .from('call_sessions')
    .update({ 
      call_ended_at: new Date().toISOString(), 
      call_status: 'completed' 
    })
    .eq('call_id', leg);
    
  return res.status(200).json({ received: true });
}

async function getOrCreateSession(callId) {
  try {
    const { data: existing } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .maybeSingle();
    if (existing) return existing;

    const { data: newSession } = await supabase
      .from('call_sessions')
      .insert([
        {
          call_id:        callId,
          created_at:     new Date().toISOString(),
          stream_started: false,
          call_status:    'active',
          transfer_initiated: false,
          transfer_completed: false,
          bridge_mode: true
        }
      ])
      .single();
    return newSession;

  } catch (err) {
    console.error('❌ getOrCreateSession error:', err);
    return null;
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};
