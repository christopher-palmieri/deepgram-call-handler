// api/telnyx/voice-api-handler-vapi-bridge.js

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { initiateConference } from './conference-bridge.js';

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export const config = { api: { bodyParser: true } };

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
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok) {
    console.error('❌ Telnyx API Error', resp.status, data);
    throw new Error(data?.errors?.[0]?.detail || `HTTP ${resp.status}`);
  }
  return { status: resp.status, data };
}

export default async function handler(req, res) {
  console.log('🔍 Incoming webhook:', req.method);

  if (req.method === 'GET') {
    return res.status(200).send('voice-api-handler-vapi-bridge is live');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const event = req.body?.data;
  if (!event) {
    return res.status(200).json({ received: true });
  }

  console.log('📞 Event type:', event.event_type);
  switch (event.event_type) {
    case 'call.initiated':     return handleCallInitiated(event, res);
    case 'call.answered':      return handleCallAnswered(event, res);
    case 'streaming.started':  return handleStreamingStarted(event, res);
    case 'streaming.stopped':  return handleStreamingStopped(event, res);
    case 'call.hangup':        return handleCallHangup(event, res);
    default:
      console.log('Unhandled event type:', event.event_type);
      return res.status(200).json({ received: true });
  }
}

// --- Event Handlers ---

async function handleCallInitiated(event, res) {
  console.log('📞 call.initiated:', event.payload.call_control_id);
  // Retain existing logic if needed; here we simply ACK
  return res.status(200).json({ received: true });
}

async function handleCallAnswered(event, res) {
  const ctl = event.payload.call_control_id;
  const leg = event.payload.call_leg_id;
  console.log('📞 Call answered — starting IVR stream then initiating conference');

  // 1) Start the IVR audio stream
  try {
    await telnyxAPI(
      `/calls/${ctl}/actions/streaming_start`,
      'POST',
      {
        stream_url: `${process.env.TELNYX_WS_URL}?call_id=${leg}&call_control_id=${ctl}`,
        stream_track: 'inbound_track',
        enable_dialogflow: false
      }
    );
    console.log('✅ IVR stream started');
  } catch (err) {
    console.error('❌ Error starting IVR stream:', err);
  }

  // 2) Extract human number from client_state (encoded by edge function)
  let humanNum;
  if (event.payload.client_state) {
    try {
      const state = JSON.parse(Buffer.from(event.payload.client_state, 'base64').toString());
      humanNum = state.human;
      console.log('Decoded client_state:', state);
    } catch (err) {
      console.warn('Failed to parse client_state:', err);
    }
  }
  if (!humanNum) {
    console.error('❌ No human number provided in client_state!');
    return res.status(500).json({ error: 'Missing human number in client_state' });
  }

  // 3) Bridge via conference
  const vapiSip   = process.env.VAPI_SIP_ADDRESS;
  const fromNum   = process.env.TELNYX_PHONE_NUMBER;
  const appId     = process.env.TELNYX_VOICE_API_APPLICATION_ID;
  const apiKey    = process.env.TELNYX_API_KEY;
  const webhook   = process.env.CONFERENCE_WEBHOOK_URL;

  try {
    const { session_id, room } = await initiateConference(
      vapiSip,
      humanNum,
      fromNum,
      appId,
      apiKey,
      webhook
    );
    console.log('✅ Conference initiated:', session_id, room);
  } catch (err) {
    console.error('❌ Conference initiation error:', err);
  }

  return res.status(200).json({ received: true });
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
  console.log('📞 call.hangup:', event.payload.call_leg_id);
  return res.status(200).json({ received: true });
}
