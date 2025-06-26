// api/telnyx/voice-api-handler.js

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

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

  // 1) Create or fetch your Supabase session
  await getOrCreateSession(callLegId);

  // 2) Persist the Telnyx control ID on that session row
  try {
    await supabase
      .from('call_sessions')
      .update({ call_control_id: callControlId })
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

    startIVRActionPoller(ctl, leg);
  } catch (err) {
    console.error('❌ Error starting stream:', err);
  }
  return res.status(200).json({ received: true });
}

async function startIVRActionPoller(ctl, leg) {
  console.log('🔄 Poller start for call:', leg);
  const id = crypto.randomUUID().slice(0, 8);
  let count = 0, max = 60;

  const timer = setInterval(async () => {
    count++;
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state,call_status')
        .eq('call_id', leg)
        .maybeSingle();

      if (!session || session.call_status === 'completed' ||
          ['human','ivr_then_human'].includes(session.ivr_detection_state) ||
          count >= max) {
        console.log(`⏹️ [${id}] Stopping poller (reason: ${
          session?.call_status==='completed'?'ended':
          session?.ivr_detection_state==='human'?'human':
          session?.ivr_detection_state==='ivr_then_human'?'ivr_then_human':
          'timeout'})`);
        clearInterval(timer);
        if (['human','ivr_then_human'].includes(session?.ivr_detection_state)) {
          console.log('👤 Human detected — hand off to VAPI');
          await transferToVAPI(ctl, leg);
        }
        return;
      }

      const { data: actions } = await supabase
        .from('ivr_events')
        .select('*')
        .eq('call_id', leg)
        .eq('executed', false)
        .not('action_value', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      const action = actions && actions[0];
      if (action) {
        console.log(`🎯 [${id}] Pending action:`, action);
        await executeIVRAction(ctl, leg, action);
      }
    } catch (err) {
      console.error(`❌ [${id}] Poll error:`, err.message);
    }
  }, 2000);

  console.log(`✅ [${id}] Poller running`);
}

async function executeIVRAction(callControlId, callLegId, action) {
  console.log('🎯 Executing IVR action:', action.id, action.action_type, action.action_value);

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

async function handleStreamingStarted(event, res) {
  console.log('🎙️ streaming.started:', event.payload.stream_id);
  return res.status(200).json({ received: true });
}

async function handleStreamingStopped(event, res) {
  console.log('🛑 streaming.stopped:', event.payload.stream_id);
  return res.status(200).json({ received: true });
}

async function handleCallHangup(event, res) {
  const leg = event.payload.call_leg_id;
  console.log('📞 call.hangup:', leg);
  await supabase
    .from('call_sessions')
    .update({ call_ended_at: new Date().toISOString(), call_status: 'completed' })
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
      .insert([{
        call_id:        callId,
        created_at:     new Date().toISOString(),
        stream_started: false,
        call_status:    'active'
      }])
      .single();
    return newSession;

  } catch (err) {
    console.error('❌ getOrCreateSession error:', err);
    return null;
  }
}

async function transferToVAPI(callControlId, callLegId) {
  const baseSip = process.env.VAPI_SIP_ADDRESS;

  if (!baseSip) {
    console.error('❌ VAPI_SIP_ADDRESS is not defined.');
    return;
  }

  // Add any query parameters you want to pass to Vapi
  const sipAddress = `${baseSip}?X-Call-ID=${callLegId}&source=ivr`;

  try {
    console.log(`🔁 Transferring call ${callControlId} to ${sipAddress}`);
    const { status, data } = await telnyxAPI(
      `/calls/${callControlId}/actions/transfer_call`,
      'POST',
      {
        to: sipAddress,
        sip: {
          headers: {
            'X-Routed-By': 'IVR-Poller'
          }
        }
      }
    );
    console.log(`✅ Transfer initiated (${status}):`, data);
  } catch (err) {
    console.error('❌ Error transferring to VAPI SIP:', err);
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};
