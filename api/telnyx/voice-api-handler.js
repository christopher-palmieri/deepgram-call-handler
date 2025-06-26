// api/telnyx/voice-api-handler.js

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

// Create or fetch Supabase session row
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
      .insert([{ call_id: callId, created_at: new Date().toISOString(), stream_started: false, call_status: 'active' }])
      .single();
    return newSession;
  } catch (err) {
    console.error('❌ getOrCreateSession error:', err);
    return null;
  }
}

async function handleCallInitiated(event, res) {
  const callControlId = event.payload.call_control_id;
  const callLegId     = event.payload.call_leg_id;
  const direction     = event.payload.direction;

  console.log('📞 Call initiated - Control ID:', callControlId, 'Leg ID:', callLegId, 'Dir:', direction);

  await getOrCreateSession(callLegId);

  try {
    await supabase
      .from('call_sessions')
      .update({ call_control_id: callControlId })
      .eq('call_id', callLegId);
    console.log('✅ Saved call_control_id to session');
  } catch (err) {
    console.error('❌ Could not save call_control_id:', err);
  }

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
      `/calls/${ctl}/actions/streaming_start`, 'POST', {
        stream_url: `${WS}?call_id=${leg}&call_control_id=${ctl}`,
        stream_track: 'inbound_track', enable_dialogflow: false
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

  const { data: initial } = await supabase
    .from('call_sessions')
    .select('call_status')
    .eq('call_id', leg)
    .single();
  if (initial?.call_status === 'transferred') {
    console.log(`👀 Poller not started for ${leg}, already transferred`);
    return;
  }

  const timer = setInterval(async () => {
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state,call_status')
        .eq('call_id', leg)
        .maybeSingle();

      if (!session || session.call_status === 'completed' || session.call_status === 'transferred') {
        clearInterval(timer);
        return;
      }

      if (['human','ivr_then_human'].includes(session.ivr_detection_state)) {
        console.log(`[${id}] Human detected — transferring to VAPI`);
        clearInterval(timer);
        await transferToVAPI(ctl, leg);
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

      if (actions.length) {
        await executeIVRAction(ctl, leg, actions[0]);
      }
    } catch (err) {
      console.error(`[${id}] Poll error:`, err);
    }
  }, 500);

  console.log(`✅ Poller running for ${leg} every 500ms`);
}

async function executeIVRAction(callControlId, callLegId, action) {
  // Guard: skip if call is no longer active
  const { data: session } = await supabase
    .from('call_sessions')
    .select('call_status')
    .eq('call_id', callLegId)
    .maybeSingle();
  if (!session || session.call_status !== 'active') {
    console.log(`🚫 Skipping action ${action.id} because call_status=${session?.call_status}`);
    return;
  }

  console.log('🎯 Executing IVR action:', action.id, action.action_type, action.action_value);

  const common = {
    client_state: Buffer.from(JSON.stringify({ action_id: action.id, call_id: callLegId, timestamp: new Date().toISOString() })).toString('base64'),
    command_id: crypto.randomUUID()
  };

  try {
    if (action.action_type === 'dtmf') {
      const payload = { digits: action.action_value, duration_millis: 500, ...common };
      console.log('📤 Sending DTMF:', payload);
      await telnyxAPI(`/calls/${callControlId}/actions/send_dtmf`, 'POST', payload);
    } else if (action.action_type === 'speech') {
      const payload = { payload: action.action_value, voice: 'female', language: 'en-US', ...common };
      console.log('📤 Speaking prompt:', payload);
      await telnyxAPI(`/calls/${callControlId}/actions/speak`, 'POST', payload);
    }

    await supabase
      .from('ivr_events')
      .update({ executed: true, executed_at: new Date().toISOString() })
      .eq('id', action.id);
  } catch (err) {
    console.error('❌ executeIV
