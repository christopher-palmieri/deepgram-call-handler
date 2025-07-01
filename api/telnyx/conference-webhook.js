// -----------------------------
// Vercel Webhook Handler: Explicit Mute, Join Human & Timed Unmute
// -----------------------------
export const config = { api: { bodyParser: true } };

// Base Telnyx API URL
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export default async function handler(req, res) {
  // Validate 'from' for human leg
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';

  // Health check
  if (req.method === 'GET') return res.status(200).send('Webhook endpoint is live');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // Parse request body
    let body = req.body || {};
    if (!Object.keys(body).length) {
      try {
        const raw = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
        body = JSON.parse(raw);
      } catch {
        console.warn('Failed to parse raw body');
      }
    }

    const evt = (body.data && body.data.event_type) || body.event_type;
    const pl = (body.data && body.data.payload) || body.payload;
    console.log('Webhook hit:', evt, JSON.stringify(pl));

    // Ignore Telnyx status updates
    if (['status-update', 'end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // When VAPI joins (first participant)
    if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
      const { session_id, human } = JSON.parse(atob(pl.client_state));
      const room = `conf-${session_id}`;
      console.log('VAPI leg joined conference:', room);

      // 1) Explicitly mute VAPI leg via API action
      console.log('Muting VAPI leg:', pl.call_control_id);
      try {
        const muteResp = await fetch(
          `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/mute`,
          { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type':'application/json' } }
        );
        const muteJson = await muteResp.json();
        console.log('Mute response:', muteJson);
      } catch (err) {
        console.error('Mute error:', err);
      }

      // 2) Dial human into the conference
      (async () => {
        const dialResp = await fetch(
          `${TELNYX_API_URL}/calls`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
              'Content-Type':'application/json'
            },
            body: JSON.stringify({
              connection_id: pl.connection_id,
              to: human,
              from: FROM_NUMBER,
              enable_early_media: true,
              conference_config: { conference_name: room, start_conference_on_enter: true, end_conference_on_exit: true },
              webhook_url: 'https://v0-new-project-qykgboija9j.vercel.app/api/telnyx/conference-webhook',
              webhook_url_method: 'POST'
            })
          }
        );
        const dialJson = await dialResp.json();
        console.log('Human dial response:', dialJson);
      })();

      // 3) Schedule unmute after 15 seconds
      setTimeout(async () => {
        console.log('⏰ 15s elapsed: unmuting VAPI leg', pl.call_control_id);
        try {
          const unmuteResp = await fetch(
            `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/unmute`,
            { method:'POST', headers:{ 'Authorization':`Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type':'application/json' } }
          );
          const unmuteJson = await unmuteResp.json();
          console.log('Unmute response:', unmuteJson);
        } catch (err) {
          console.error('Unmute error:', err);
        }
      }, 15000);
    }

    // ACK all other events
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
