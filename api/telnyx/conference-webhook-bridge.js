// -----------------------------
// File: conference-webhook-bridge.js
// Handles Telnyx conference webhooks: hold/unhold VAPI, dial human
// -----------------------------
import fetch from 'node-fetch';

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export async function conferenceWebhookBridgeHandler(req, res) {
  const apiKey = process.env.TELNYX_API_KEY;
  const phoneNumber = process.env.TELNYX_PHONE_NUMBER;
  const webhookUrl = process.env.CONFERENCE_WEBHOOK_URL;

  if (req.method === 'GET') {
    return res.status(200).send('Conference webhook bridge is live');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body = req.body;
  if (!Object.keys(body).length) {
    body = JSON.parse(await getRawBody(req));
  }

  const evt = body.data.event_type;
  const pl = body.data.payload;
  console.log('Conference event:', evt, pl);

  // Only handle the creator (VAPI) joining
  if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
    const { session_id, human } = JSON.parse(Buffer.from(pl.client_state, 'base64').toString());
    const room = `conf-${session_id}`;

    // 1) Hold (deaf) VAPI leg
    console.log('Holding VAPI leg:', pl.call_control_id);
    const holdResp = await fetch(
      `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/hold`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Hold response:', await holdResp.json());

    // 2) Dial human into the same conference
    console.log('Dialing human into conference:', human);
    const dialResp = await fetch(
      `${TELNYX_API_URL}/calls`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connection_id: pl.connection_id,
          to: human,
          from: phoneNumber,
          enable_early_media: true,
          conference_config: {
            conference_name: room,
            start_conference_on_enter: true,
            end_conference_on_exit: true
          },
          webhook_url: webhookUrl,
          webhook_url_method: 'POST'
        })
      }
    );
    console.log('Human dial response:', await dialResp.json());

    // 3) Unhold VAPI after 15 seconds
    setTimeout(async () => {
      console.log('⏰ 15s elapsed: unholding VAPI leg', pl.call_control_id);
      const unholdResp = await fetch(
        `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/unhold`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('Unhold response:', await unholdResp.json());
    }, 15000);
  }

  // Always ACK
  return res.status(200).json({ received: true });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
