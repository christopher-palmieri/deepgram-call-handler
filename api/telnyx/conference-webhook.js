import fetch from 'node-fetch';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const body = req.body;
    const evt = (body.data && body.data.event_type) || body.event_type;
    const payload = (body.data && body.data.payload) || body.payload;

    // ACK Telnyx status updates & end-of-call-report
    if (evt === 'status-update' || evt === 'end-of-call-report') {
      return res.status(200).json({ received: true });
    }

    // On VAPI participant joined to conference
    if (evt === 'conference.participant.joined' && payload.sip_uri && payload.sip_uri.includes('vapi.ai')) {
      const state = JSON.parse(atob(payload.client_state));
      const room = `conf-${state.session_id}`;
      const human = state.human;

      // Dial human into same conference
      await fetch(`https://api.telnyx.com/v2/calls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connection_id: process.env.TELNYX_VOICE_API_APPLICATION_ID,
          to: human,                           // E.164 phone number
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

      return res.status(200).json({ received: true });
    }

    // Acknowledge other conference events
    if (evt && evt.startsWith('conference.')) {
      return res.status(200).json({ received: true });
    }

    // Fallback ACK
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
