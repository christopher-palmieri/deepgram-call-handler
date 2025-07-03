// -----------------------------
// Vercel Webhook Handler: Hold VAPI, Dial Human & Timed Unhold
// -----------------------------
export const config = { api: { bodyParser: true } };
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export default async function handler(req, res) {
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';

  if (req.method === 'GET') {
    return res.status(200).send('Webhook endpoint is live');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Parse request body
    let body = req.body || {};
    if (!Object.keys(body).length) {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      try { body = JSON.parse(raw); } catch {}
    }

    const evt = (body.data && body.data.event_type) || body.event_type;
    const pl = (body.data && body.data.payload) || body.payload;
    console.log('Webhook hit:', evt, JSON.stringify(pl));

    if (['status-update', 'end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // When VAPI joins the conference
    if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
      const { session_id, human } = JSON.parse(atob(pl.client_state));
      const room = `conf-${session_id}`;
      console.log('VAPI joined conference:', room);

      // Hold VAPI leg
      console.log('Holding VAPI leg:', pl.call_control_id);
      const holdResp = await fetch(
        `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/hold`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type':'application/json' } }
      );
      console.log('Hold response:', await holdResp.json());

      // Dial human into conference
      const dialResp = await fetch(
        `${TELNYX_API_URL}/calls`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type':'application/json' },
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
      console.log('Human dial response:', await dialResp.json());

      // Schedule unhold after 15 seconds
      setTimeout(async () => {
        console.log('⏰ 15s elapsed: unholding VAPI leg', pl.call_control_id);
        const unholdResp = await fetch(
          `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/unhold`,
          { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type':'application/json' } }
        );
        console.log('Unhold response:', await unholdResp.json());
      }, 15000);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
