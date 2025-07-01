// api/telnyx/conference-webhook-bridge.js

import fetch from 'node-fetch';

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export const config = { api: { bodyParser: true } };

// Low‐level Telnyx caller: returns parsed JSON or throws on error
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
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detail = data?.errors?.[0]?.detail || `HTTP ${resp.status}`;
    throw new Error(detail);
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('conference-webhook-bridge is live');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const event = req.body?.data;
  if (!event) {
    return res.status(200).json({ received: true });
  }

  const { event_type, payload: pl } = event;
  console.log(`🔔 ${event_type} payload:`, pl);

  // Only handle the moment our VAPI leg joins the room
  if (
    event_type === 'conference.participant.joined' &&
    pl.call_control_id === pl.creator_call_control_id
  ) {
    if (!pl.client_state) {
      console.error('❌ conference join with no client_state');
      return res.status(400).json({ error: 'Missing client_state' });
    }

    // Decode the base64-encoded state
    let state;
    try {
      state = JSON.parse(
        Buffer.from(pl.client_state, 'base64').toString('utf8')
      );
    } catch (err) {
      console.error('❌ Invalid client_state JSON/base64:', err);
      return res.status(400).json({ error: 'Invalid client_state' });
    }

    const { room, human } = state;
    if (!room || !human) {
      console.error('❌ client_state missing room or human:', state);
      return res.status(400).json({ error: 'Missing room or human in client_state' });
    }

    console.log(`🧩 VAPI joined room "${room}", now dialing clinic ${human}`);

    // Build and send the human-leg dial
    const humanPayload = {
      connection_id: process.env.TELNYX_VOICE_API_APPLICATION_ID,
      to:            human,
      from:          process.env.TELNYX_PHONE_NUMBER,
      conference_config: {
        conference_name:           room,
        start_conference_on_enter: true,
        end_conference_on_exit:    true
      }
    };

    try {
      const humanResp = await fetch(`${TELNYX_API_URL}/calls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify(humanPayload)
      });
      const humanResult = await humanResp.json().catch(() => ({}));

      console.log(
        'Human dial HTTP', humanResp.status,
        'body:', JSON.stringify(humanResult, null, 2)
      );

      if (!humanResp.ok) {
        console.error('❌ Error dialing human into conference:', humanResult.errors || humanResult);
      } else {
        console.log('✅ Human dialed into conference:', humanResult.data.call_control_id);
      }
    } catch (err) {
      console.error('❌ Exception dialing human into conference:', err);
    }
  }

  // Always ACK to Telnyx
  return res.status(200).json({ received: true });
}
