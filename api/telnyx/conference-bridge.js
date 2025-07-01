// -----------------------------
// File: conference-bridge.js
// Encapsulates conference creation and management logic
// -----------------------------
import fetch from 'node-fetch';

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

/**
 * Initiates a VAPI-first conference:
 *  - Dials VAPI leg (muted)
 *  - Returns session and conference room
 */
export async function initiateConference(vapiSip, humanNumber, fromNumber, voiceAppId, apiKey, webhookUrl) {
  const session_id = crypto.randomUUID();
  const room = `conf-${session_id}`;
  const clientState = btoa(JSON.stringify({ session_id, human: humanNumber }));

  const resp = await fetch(`${TELNYX_API_URL}/calls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      connection_id: voiceAppId,
      to: vapiSip,
      from: fromNumber,
      enable_early_media: true,
      conference_config: {
        conference_name: room,
        start_conference_on_enter: true,
        end_conference_on_exit: true,
        muted: true
      },
      webhook_events_filter: [
        'conference.participant.joined',
        'conference.participant.left'
      ],
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientState
    })
  });

  const result = await resp.json();
  if (!resp.ok) throw new Error(`Failed to start conference: ${JSON.stringify(result)}`);

  return { session_id, room, telnyxResponse: result };
}


// -----------------------------
// File: conferenceWebhook.js
// Handles conference webhooks: hold/unhold VAPI, dial human
// -----------------------------
import fetch from 'node-fetch';

const TELNYX_API_URL_WEB = 'https://api.telnyx.com/v2';

export async function conferenceWebhookHandler(req, res, apiKey, phoneNumber, webhookUrl) {
  if (req.method === 'GET') return res.status(200).send('Conference webhook live');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  let body = req.body;
  if (!Object.keys(body).length) body = JSON.parse(await getRaw(req));

  const evt = body.data.event_type;
  const pl = body.data.payload;
  console.log('Conference event:', evt, pl);

  if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
    const { session_id, human } = JSON.parse(atob(pl.client_state));
    const room = `conf-${session_id}`;

    // Hold VAPI leg
    console.log('Holding VAPI leg:', pl.call_control_id);
    await fetch(`${TELNYX_API_URL_WEB}/calls/${pl.call_control_id}/actions/hold`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' }
    }).then(r => r.json()).then(j => console.log('Hold result:', j));

    // Dial human into conference
    console.log('Dialing human into conference:', human);
    await fetch(`${TELNYX_API_URL_WEB}/calls`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        connection_id: pl.connection_id,
        to: human,
        from: phoneNumber,
        enable_early_media: true,
        conference_config: { conference_name: room, start_conference_on_enter: true, end_conference_on_exit: true },
        webhook_url: webhookUrl,
        webhook_url_method: 'POST'
      })
    }).then(r => r.json()).then(j => console.log('Human dial result:', j));

    // Unhold after 15 seconds
    setTimeout(async () => {
      console.log('⏰ 15s elapsed: unholding VAPI leg', pl.call_control_id);
      await fetch(`${TELNYX_API_URL_WEB}/calls/${pl.call_control_id}/actions/unhold`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' }
      }).then(r => r.json()).then(j => console.log('Unhold result:', j));
    }, 15000);
  }

  return res.status(200).json({ received: true });
}

function getRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// -----------------------------
// File: voice-api-handler-vapi.js
// Original IVR handler now imports conference logic
// -----------------------------
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { initiateConference } from './conferenceBridge.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  console.log('🔍 Incoming webhook:', req.method);

  if (req.method === 'GET') return handleDebug(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const event = req.body?.data;
  if (!event) return res.status(200).json({ received: true });

  console.log('📞 Event type:', event.event_type);
  switch (event.event_type) {
    case 'call.initiated': return handleCallInitiated(event, res);
    case 'call.answered': return handleCallAnswered(event, res);
    case 'streaming.started': return handleStreamingStarted(event, res);
    case 'streaming.stopped': return handleStreamingStopped(event, res);
    case 'call.hangup': return handleCallHangup(event, res);
    default:
      console.log('Unhandled event type:', event.event_type);
      return res.status(200).json({ received: true });
  }
}

// ... existing handleCallInitiated, handleStreamingStarted, handleStreamingStopped, handleCallHangup, etc.

async function handleCallAnswered(event, res) {
  const ctl = event.payload.call_control_id;
  const leg = event.payload.call_leg_id;
  console.log('📞 Call answered - initiating IVR stream then conference');

  // Start the IVR stream
  await telnyxAPI(`/calls/${ctl}/actions/streaming_start`, 'POST', {
    stream_url: `${process.env.TELNYX_WS_URL}?call_id=${leg}&call_control_id=${ctl}`,
    stream_track: 'inbound_track',
    enable_dialogflow: false
  });

  // ... IVR navigation logic ...

  // Once IVR or human detection indicates readiness to bridge:
  const vapiSip = process.env.VAPI_SIP_ADDRESS;
  const humanNumber = process.env.CLINIC_NUMBER;
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const voiceAppId = process.env.TELNYX_VOICE_API_APPLICATION_ID;
  const apiKey = process.env.TELNYX_API_KEY;
  const webhookUrl = process.env.CONFERENCE_WEBHOOK_URL;

  try {
    const { session_id, room } = await initiateConference(
      vapiSip, humanNumber, fromNumber,
      voiceAppId, apiKey, webhookUrl
    );
    console.log('✅ Conference initiated:', session_id, room);
  } catch (err) {
    console.error('❌ Conference initiation error:', err);
  }

  return res.status(200).json({ received: true });
}

// Note: remove or deprecate transferToVAPI; all new transfers use conferenceBridge
