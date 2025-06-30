// -----------------------------
// Vercel Webhook Handler: Dial Human & Time-based Unmute
// -----------------------------
export const config = { api: { bodyParser: true } };
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
    // Parse body safely
    let body = req.body || {};
    if (!Object.keys(body).length) {
      try {
        const text = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data',chunk=>data+=chunk);
          req.on('end',()=>resolve(data));
          req.on('error',reject);
        });
        body = JSON.parse(text);
      } catch {}
    }

    const evt = (body.data && body.data.event_type) || body.event_type;
    const pl = (body.data && body.data.payload) || body.payload;
    console.log('Webhook hit:', evt, JSON.stringify(pl));

    // Ignore non-conference events
    if (['status-update','end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // First join by VAPI: dial human and schedule unmute
    if (evt === 'conference.participant.joined' && pl.call_control_id === pl.creator_call_control_id) {
      const state = JSON.parse(atob(pl.client_state));
      const room = `conf-${state.session_id}`;
      console.log('VAPI leg joined:', pl.call_control_id, 'room:', room);

      // 1) Dial human into the conference
      (async () => {
        const dialResp = await fetch(`${TELNYX_API_URL}/calls`, {
          method:'POST',
          headers:{
            'Authorization':`Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type':'application/json'
          },
          body:JSON.stringify({
            connection_id: pl.connection_id,
            to: state.human,
            from: process.env.TELNYX_PHONE_NUMBER,
            enable_early_media:true,
            conference_config:{ conference_name: room, start_conference_on_enter:true, end_conference_on_exit:true },
            webhook_url:'https://v0-new-project-qykgboija9j.vercel.app/api/telnyx/conference-webhook',
            webhook_url_method:'POST'
          })
        });
        const dialJson = await dialResp.json();
        console.log('Human dial response:', dialJson);
      })();

      // 2) Schedule VAPI unmute at 15s for testing indicator
      setTimeout(async () => {
        console.log('⏰ 15s elapsed: unmuting VAPI leg', pl.call_control_id);
        try{
          const unmuteResp = await fetch(
            `${TELNYX_API_URL}/calls/${pl.call_control_id}/actions/unmute`,
            { method:'POST', headers:{'Authorization':`Bearer ${process.env.TELNYX_API_KEY}`,'Content-Type':'application/json'} }
          );
          const unmuteJson = await unmuteResp.json();
          console.log('Unmute response:', unmuteJson);
        }catch(err){console.error('Unmute error:', err);}
      },15000);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
