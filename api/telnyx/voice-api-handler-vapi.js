// api/telnyx/voice-api-handler-vapi.js

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

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

  // CRITICAL: Clean up ALL stale actions for this call_id first
  try {
    // First, check if there are any old actions with this exact call_id
    const { data: existingActions, error: checkError } = await supabase
      .from('ivr_events')
      .select('id, created_at, transcript')
      .eq('call_id', callLegId)
      .eq('executed', false);
    
    if (existingActions && existingActions.length > 0) {
      console.log(`⚠️ Found ${existingActions.length} existing actions for call_id ${callLegId}`);
      
      // Mark ALL of them as expired since this is a new call with the same ID
      const { data: cleaned, error: cleanError } = await supabase
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
    
    // Also clean up any orphaned actions older than 60 seconds
    const { data: oldActions, error } = await supabase
      .from('ivr_events')
      .update({ 
        executed: true, 
        executed_at: new Date().toISOString(),
        error: 'expired_timeout'
      })
      .eq('executed', false)
      .lt('created_at', new Date(Date.now() - 60000).toISOString()) // Actions older than 60 seconds
      .select();
    
    if (oldActions && oldActions.length > 0) {
      console.log(`🧹 Cleaned up ${oldActions.length} old actions (timeout)`);
    }
  } catch (err) {
    console.error('❌ Error cleaning stale actions:', err);
  }

  // 1) Create or fetch your Supabase session
  await getOrCreateSession(callLegId);

  // 2) Persist the Telnyx control ID on that session row
  try {
    await supabase
      .from('call_sessions')
      .update({ 
        call_control_id: callControlId,
        call_initiated_at: new Date().toISOString()
      })
      .eq('call_id', callLegId);
    console.log('✅ Saved call_control_id to session');
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
  const ctl = event.payload.call_control_id;
  const leg = event.payload.call_leg_id;
  console.log('📞 Call answered - Control ID:', ctl, 'Leg ID:', leg, 'Starting WebSocket…');

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

    // Start monitoring for IVR detection changes
    startIVRMonitor(ctl, leg);
  } catch (err) {
    console.error('❌ Error starting stream:', err);
  }
  return res.status(200).json({ received: true });
}

// New monitor function that watches for human detection
async function startIVRMonitor(ctl, leg) {
  console.log('👁️ Starting IVR detection monitor for call:', leg);
  const monitorId = crypto.randomUUID().slice(0, 8);
  let checkCount = 0;
  const maxChecks = 120; // 2 minutes at 1-second intervals
  let transferred = false;

  const monitor = setInterval(async () => {
    checkCount++;
    
    try {
      // Check call session state
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status, transfer_initiated')
        .eq('call_id', leg)
        .maybeSingle();

      // Stop conditions
      if (!session || 
          session.call_status === 'completed' || 
          session.transfer_initiated ||
          transferred ||
          checkCount >= maxChecks) {
        
        console.log(`⏹️ [${monitorId}] Stopping IVR monitor (reason: ${
          !session ? 'no_session' :
          session.call_status === 'completed' ? 'call_ended' :
          session.transfer_initiated || transferred ? 'already_transferred' :
          'timeout'
        })`);
        
        clearInterval(monitor);
        
        // Also stop the action poller if it's running
        if (global.actionPollers && global.actionPollers[leg]) {
          clearInterval(global.actionPollers[leg]);
          delete global.actionPollers[leg];
          console.log(`⏹️ Stopped action poller for ${leg}`);
        }
        
        return;
      }

      // Check if human detected
      if (['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
        console.log(`👤 [${monitorId}] Human detected (${session.ivr_detection_state}) - initiating transfer`);
        
        // Mark as transferring to prevent duplicate transfers
        transferred = true;
        await supabase
          .from('call_sessions')
          .update({ transfer_initiated: true })
          .eq('call_id', leg);
        
        // Stop the action poller immediately
        if (global.actionPollers && global.actionPollers[leg]) {
          clearInterval(global.actionPollers[leg]);
          delete global.actionPollers[leg];
          console.log(`⏹️ Stopped action poller due to human detection`);
        }
        
        // Transfer to VAPI
        await transferToVAPI(ctl, leg);
        
        // Stop this monitor
        clearInterval(monitor);
        return;
      }

      // If IVR detected and no action poller running, start one
      if (session.ivr_detection_state === 'ivr_only' && 
          (!global.actionPollers || !global.actionPollers[leg])) {
        console.log(`🤖 [${monitorId}] IVR detected, starting action poller`);
        startIVRActionPoller(ctl, leg);
      }

    } catch (err) {
      console.error(`❌ [${monitorId}] Monitor error:`, err.message);
    }
  }, 1000); // Check every second

  console.log(`✅ [${monitorId}] IVR monitor running`);
}

// Initialize global storage for action pollers
if (!global.actionPollers) {
  global.actionPollers = {};
}

async function startIVRActionPoller(ctl, leg) {
  // Prevent duplicate pollers
  if (global.actionPollers[leg]) {
    console.log('⚠️ Action poller already running for', leg);
    return;
  }

  console.log('🔄 Starting IVR action poller for call:', leg);
  const pollerId = crypto.randomUUID().slice(0, 8);
  let count = 0, max = 60;

  const timer = setInterval(async () => {
    count++;
    try {
      // Re-check session state before each action
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, call_status, transfer_initiated')
        .eq('call_id', leg)
        .maybeSingle();

      // Stop if human detected, call ended, or already transferred
      if (!session || 
          session.call_status === 'completed' ||
          session.transfer_initiated ||
          ['human', 'ivr_then_human'].includes(session.ivr_detection_state) ||
          count >= max) {
        
        console.log(`⏹️ [${pollerId}] Stopping action poller (reason: ${
          !session ? 'no_session' :
          session?.call_status === 'completed' ? 'call_ended' :
          session?.transfer_initiated ? 'already_transferred' :
          ['human', 'ivr_then_human'].includes(session?.ivr_detection_state) ? 'human_detected' :
          'timeout'
        })`);
        
        clearInterval(timer);
        delete global.actionPollers[leg];
        return;
      }

      // Only process actions if still in IVR mode
      if (session.ivr_detection_state === 'ivr_only') {
        // Get the call initialization time to filter out old actions
        const { data: callSession } = await supabase
          .from('call_sessions')
          .select('created_at, call_initiated_at')
          .eq('call_id', leg)
          .single();
        
        if (!callSession) {
          console.log(`❌ [${pollerId}] No call session found`);
          return;
        }

        // Use call_initiated_at if available, otherwise created_at
        const callStartTime = callSession.call_initiated_at || callSession.created_at;

        const { data: actions } = await supabase
          .from('ivr_events')
          .select('*')
          .eq('call_id', leg)
          .eq('executed', false)
          .not('action_value', 'is', null)
          .gte('created_at', callStartTime) // Only get actions created after call started
          .order('created_at', { ascending: false })
          .limit(1);

        const action = actions && actions[0];
        if (action) {
          // Triple-check: ensure this action was created AFTER this call started
          const actionTime = new Date(action.created_at);
          const callTime = new Date(callStartTime);
          
          if (actionTime < callTime) {
            console.log(`⚠️ [${pollerId}] Skipping action created before call start: ${action.created_at} < ${callStartTime}`);
            
            // Mark this old action as expired
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
          
          // Double-check this action is really for this call
          if (action.call_id !== leg) {
            console.log(`⚠️ [${pollerId}] Skipping action for different call: ${action.call_id} !== ${leg}`);
            
            // This should never happen with the query above, but just in case
            await supabase
              .from('ivr_events')
              .update({ 
                executed: true, 
                executed_at: new Date().toISOString(),
                error: 'wrong_call_id'
              })
              .eq('id', action.id);
            return;
          }
          
          console.log(`🎯 [${pollerId}] Executing action:`, action.action_type, action.action_value);
          await executeIVRAction(ctl, leg, action);
        }
      }
    } catch (err) {
      console.error(`❌ [${pollerId}] Poll error:`, err.message);
    }
  }, 2000);

  // Store the timer reference
  global.actionPollers[leg] = timer;
  console.log(`✅ [${pollerId}] Action poller running`);
}

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action.id, action.action_type, action.action_value);

  // Final check before execution - verify call still exists and is active
  try {
    const { data: session } = await supabase
      .from('call_sessions')
      .select('ivr_detection_state, transfer_initiated, call_status, call_control_id')
      .eq('call_id', callLegId)
      .maybeSingle();

    if (!session) {
      console.log('⏭️ Skipping IVR action - no session found');
      await supabase
        .from('ivr_events')
        .update({ 
          executed: true, 
          executed_at: new Date().toISOString(), 
          error: 'no_session_found' 
        })
        .eq('id', action.id);
      return;
    }

    // Verify the control ID matches
    if (session.call_control_id !== callControlId) {
      console.log('⏭️ Skipping IVR action - control ID mismatch');
      await supabase
        .from('ivr_events')
        .update({ 
          executed: true, 
          executed_at: new Date().toISOString(), 
          error: 'control_id_mismatch' 
        })
        .eq('id', action.id);
      return;
    }

    if (session.call_status !== 'active' || 
        session.transfer_initiated || 
        ['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
      console.log('⏭️ Skipping IVR action - call not active, human detected, or transfer initiated');
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
  } catch (err) {
    console.error('❌ Error checking call state:', err);
    // Don't execute if we can't verify state
    await supabase
      .from('ivr_events')
      .update({ 
        executed: true, 
        executed_at: new Date().toISOString(), 
        error: `state_check_error: ${err.message}` 
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
      .update({ executed: true, executed_at: new Date().toISOString() })
      .eq('id', action.id);

  } catch (err) {
    console.error('❌ executeIVRAction error:', err);
    await supabase
      .from('ivr_events')
      .update({ executed: true, executed_at: new Date().toISOString(), error: err.message })
      .eq('id', action.id);
  }
}

async function transferToVAPI(callControlId, callLegId) {
  const baseSip = process.env.VAPI_SIP_ADDRESS;

  if (!baseSip) {
    console.error('❌ VAPI_SIP_ADDRESS is not defined.');
    return;
  }

  // First verify the call is still active
  try {
    // Try to get call status from Telnyx
    const { data: callStatus } = await telnyxAPI(
      `/calls/${callControlId}`,
      'GET'
    ).catch(err => {
      console.log('⚠️ Could not retrieve call status:', err.message);
      return { data: null };
    });

    if (!callStatus || callStatus.data?.state === 'hangup') {
      console.log('❌ Cannot transfer - call already ended');
      
      // Update session to reflect this
      await supabase
        .from('call_sessions')
        .update({ 
          transfer_error: 'call_already_ended',
          transfer_error_at: new Date().toISOString(),
          call_status: 'completed'
        })
        .eq('call_id', callLegId);
      
      return;
    }

    // Also check our database
    const { data: session } = await supabase
      .from('call_sessions')
      .select('call_status, call_control_id')
      .eq('call_id', callLegId)
      .maybeSingle();

    if (!session || session.call_status !== 'active') {
      console.error('❌ Cannot transfer - call is not active in database');
      return;
    }

    if (session.call_control_id !== callControlId) {
      console.error('❌ Control ID mismatch - updating to use correct ID');
      callControlId = session.call_control_id;
    }
  } catch (err) {
    console.error('❌ Error verifying call state before transfer:', err);
    return;
  }

  const sipAddress = baseSip.startsWith('sip:') ? baseSip : `sip:${baseSip}`;

  try {
    console.log(`🔁 Transferring call ${callControlId} to ${sipAddress}`);
    
    // Mark transfer as started
    await supabase
      .from('call_sessions')
      .update({ 
        transfer_started_at: new Date().toISOString()
      })
      .eq('call_id', callLegId);
    
    // Telnyx transfer request body according to their docs
    const transferBody = {
      to: sipAddress,
      // Optional fields that might help:
      webhook_url: process.env.WEBHOOK_URL ? `${process.env.WEBHOOK_URL}/api/telnyx/voice-api-handler-vapi` : undefined,
      webhook_url_method: 'POST'
    };
    
    // Add custom headers if needed - Telnyx supports custom_headers for SIP
    if (callLegId) {
      transferBody.custom_headers = [
        { name: 'X-Call-ID', value: callLegId },
        { name: 'X-Source', value: 'ivr-detection' },
        { name: 'X-Detection-Result', value: 'human' }
      ];
    }
    
    console.log('📤 Transfer request:', JSON.stringify(transferBody, null, 2));
    
    const { status, data } = await telnyxAPI(
      `/calls/${callControlId}/actions/transfer`,
      'POST',
      transferBody
    );
    
    console.log(`✅ Transfer initiated (${status}):`, data);
    
    // Mark transfer as completed
    await supabase
      .from('call_sessions')
      .update({ 
        transfer_completed: true,
        transfer_completed_at: new Date().toISOString()
      })
      .eq('call_id', callLegId);
      
  } catch (err) {
    console.error('❌ Error transferring to VAPI SIP:', err);
    
    // Update session with error
    await supabase
      .from('call_sessions')
      .update({ 
        transfer_error: err.message,
        transfer_error_at: new Date().toISOString()
      })
      .eq('call_id', callLegId);
  }
}

async function handleStreamingStarted(event, res) {
  console.log('🎙️ streaming.started:', event.payload.stream_id);
  return res.status(200).json({ received: true });
}

async function handleStreamingStopped(event, res) {
  console.log('🛑 streaming.stopped:', event.payload.stream_id);
  
  // Clean up any running pollers
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
  
  // Clean up any running pollers
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
          transfer_completed: false
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
