// api/telnyx/conference-webhook-bridge.js
// Handles all conference.* events from Telnyx to manage VAPI & human legs

import fetch from 'node-fetch';

export const config = {
  api: { bodyParser: true }
};

const TELNYX_API_URL = 'https://api.telnyx.com/v2';
const API_KEY = process.env.TELNYX_API_KEY;
const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('Conference webhook is live');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Parse the incoming webhook payload
  let body = req.body;
  // Support raw body parsing if needed
  if (!body.data) {
    try {
      const text = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = JSON.parse(text);
    } catch(_) {
      console.warn('Could not parse raw body');
    }
  }

  const eventType = body.data?.event_type || body.event_type;
  const pl = body.data?.payload || body.payload;

  console.log('Webhook hit:', eventType, 'payload:', pl);

  // Decode client_state to retrieve session_id & human number
  let state = {};
  if (pl.client_state) {
    try {
      state = JSON.parse(Buffer.from(pl.client_state, 'base64').toString());
    } catch (err) {
      console.warn('Failed to parse client_state:', err);
    }
  }

  // Determine the VAPI call control ID (creator of the conference)
  const vapiControlId = pl.creator_call_control_id;
  const conferenceId = pl.conference_id;

  switch (eventType) {
    // When VAPI joins the conference, hold it and dial the human in
    case 'conference.participant.joined': {
      // Only act when the VAPI leg first joins
      if (pl.call_control_id === vapiControlId) {
        console.log('VAPI joined conference:', conferenceId);

        // 1) Hold VAPI leg
        await fetch(`${TELNYX_API_URL}/calls/${vapiControlId}/actions/hold`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('Held VAPI leg:', vapiControlId);

        // 2) Dial human into same conference
        const human = state.human;
        if (human) {
          const resp = await fetch(`${TELNYX_API_URL}/calls`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              connection_id: pl.connection_id,
              to: human,
              from: FROM_NUMBER,
              enable_early_media: true,
              conference_config: {
                conference_name: conferenceId,
                start_conference_on_enter: true,
                end_conference_on_exit: true
              },
              webhook_url: process.env.CONFERENCE_WEBHOOK_URL,
              webhook_url_method: 'POST'
            })
          });
          const data = await resp.json();
          console.log('Dialed human into conference:', data);
        } else {
          console.warn('No human number found in client_state');
        }
      }
      break;
    }

    // When floor changes (often indicates human took floor), unhold VAPI
    case 'conference.floor.changed': {
      console.log('Conference floor changed:', pl);
      // If the floor leg is not VAPI, assume human has floor => unhold VAPI
      if (pl.call_control_id !== vapiControlId) {
        await fetch(`${TELNYX_API_URL}/calls/${vapiControlId}/actions/unhold`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('Unheld VAPI leg:', vapiControlId);
      }
      break;
    }

    // Other events we can log or ignore
    case 'conference.participant.left':
    case 'conference.ended':
    default:
      console.log('No action for event:', eventType);
  }

  return res.status(200).json({ received: true });
}
