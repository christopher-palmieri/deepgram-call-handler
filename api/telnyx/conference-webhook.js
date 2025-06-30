// -----------------------------
// Vercel Webhook Handler: Join Human to Conference
// -----------------------------
import fetch from 'node-fetch';
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const body = req.body;
    const evt = (body.data && body.data.event_type) || body.event_type;
    const pl = (body.data && body.data.payload) || body.payload;

    console.log('Webhook hit:', evt, 'payload:', JSON.stringify(pl));

    // ACK Telnyx status updates & end-of-call-report
    if (evt === 'status-update' || evt === 'end-of-call-report') {
      return res.status(200).json({ received: true });
    }

    // Conference participant joined: VAPI
    if (evt === 'conference.participant.joined' && pl.sip_uri && pl.sip_uri.includes('vapi.ai')) {
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
          connection_id: process.env.TELNYX_VOICE_API_APPLICATION_ID,
          to: state.human,
          from: process.env.TELNYX_NUMBER,
          enable_early_media: true,
          conference_config: {
            conference_name: room,
            start_conference_on_enter: true,
            end_conference_on_exit: true
          },
          webhook_url: `${process.env.WEBHOOK_URL}/conference-webhook`,
          webhook_url_method: 'POST'
        })
      });
      const humanResult = await humanResp.json();
      console.log('Human dial response:', humanResult);
    }

    // ACK everything
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
