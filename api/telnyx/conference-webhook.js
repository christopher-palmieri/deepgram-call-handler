// -----------------------------
// Vercel Webhook Handler: Time-based Unmute for VAPI
// -----------------------------
export const config = { api: { bodyParser: true } };

// Telnyx API base
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export default async function handler(req, res) {
  // Health check
  if (req.method === 'GET') {
    return res.status(200).send('Webhook endpoint is live');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Parse JSON
    let body = req.body || {};
    if (Object.keys(body).length === 0) {
      try {
        const text = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
        body = JSON.parse(text);
      } catch {
        console.warn('Could not parse raw body');
      }
    }

    const evt = (body.data && body.data.event_type) || body.event_type;
    const pl = (body.data && body.data.payload) || body.payload;
    console.log('Webhook hit:', evt, 'payload:', JSON.stringify(pl));

    // ACK non-call events
    if (['status-update', 'end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // On VAPI joining the conference (first leg)
    if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
      console.log('VAPI leg joined:', pl.call_control_id);
      // Schedule unmute after 15 seconds
      setTimeout(async () => {
        console.log('⏰ 15s elapsed: unmuting VAPI leg', pl.call_control_id);
        try {
          const unmuteResp = await fetch(
            `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/unmute`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          const unmuteJson = await unmuteResp.json();
          console.log('Unmute response:', unmuteJson);
        } catch (err) {
          console.error('Unmute error:', err);
        }
      }, 15000);
    }

    // Always ACK immediately
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
