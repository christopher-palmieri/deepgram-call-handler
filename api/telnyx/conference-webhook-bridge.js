// api/telnyx/conference-webhook-bridge.js

import fetch from 'node-fetch';

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export const config = { api: { bodyParser: true } };

async function telnyxAPI(endpoint, method = 'POST', body = {}) {
  const resp = await fetch(`${TELNYX_API_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${resp.status}`);
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
  if (!event) return res.status(200).json({ received: true });

  const { event_type, payload: pl } = event;
  console.log(`🔔 ${event_type} payload:`, pl);

  // Only handle VAPI join => dial human
  if (event_type === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
    // Extract human number from client_state
    let human;
    if (pl.client_state) {
      try {
        const state = JSON.parse(Buffer.from(pl.client_state, 'base64').toString());
        human = state.human;
      } catch (e) {
        console.error('❌ Invalid client_state:', e);
      }
    }
    if (!human) {
      console.error('❌ Missing human number in client_state on conference join');
      return res.status(400).json({ error: 'Missing human in client_state' });
    }

    const confId = pl.conference_id;
    console.log(`🧩 VAPI joined conference ${confId}, now dialing human ${human}`);

    try {
      const resp = await telnyxAPI('/calls', 'POST', {
        connection_id: process.env.TELNYX_VOICE_API_APPLICATION_ID,
        to: human,
        from: process.env.TELNYX_PHONE_NUMBER,
        conference_config: {
          conference_id: confId,
          start_conference_on_enter: true,
          end_conference_on_exit: true
        }
      });
      console.log('✅ Human dialed into conference:', resp.data?.call_control_id);
    } catch (err) {
      console.error('❌ Error dialing human into conference:', err.message);
    }
  }

  return res.status(200).json({ received: true });
}
