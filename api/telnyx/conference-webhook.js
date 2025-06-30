// -----------------------------
// Vercel Webhook Handler: Join Human to Conference
// -----------------------------
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  // Ensure a valid 'from' number
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';

  // Health check for browser
  if (req.method === 'GET') {
    return res.status(200).send('Webhook endpoint is live');
  }

  // Only POST events
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Safely parse JSON body or raw text
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
    if (evt === 'status-update' || evt === 'end-of-call-report') {
      return res.status(200).json({ received: true });
    }

    // On VAPI joining the conference
    if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
      const state = JSON.parse(atob(pl.client_state));
      const room = `conf-${state.session_id}`;
      console.log('VAPI joined conference:', room);

      // Dial human into same conference
      const humanResp = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connection_id: pl.connection_id,
          to: state.human,
          from: FROM_NUMBER,
          enable_early_media: true,
          conference_config: {
            conference_name: room,
            start_conference_on_enter: true,
            end_conference_on_exit: true
          },
          webhook_url: 'https://v0-new-project-qykgboija9j.vercel.app/api/telnyx/conference-webhook',
          webhook_url_method: 'POST'
        })
      });
      const humanResult = await humanResp.json();
      console.log('Human dial response:', humanResult);
    }

    // Always ACK
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
