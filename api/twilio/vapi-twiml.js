import querystring from 'querystring';

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callSid = parsed.CallSid;
  console.log('📞 Streaming test for CallSid:', callSid);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to the assistant</Say>
  <Start>
    <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app?streamSid=${callSid || ''}">
      <Parameter name="track" value="both"/>
      <Parameter name="encoding" value="linear16"/>
      <Parameter name="sampleRate" value="8000"/>
      <Parameter name="channels" value="1"/>
    </Stream>
  </Start>
  <Pause length="3600"/>
</Response>`;

  console.log('🧾 Serving streaming-only TwiML:', twiml);
  res.setHeader('Content-Type', 'text/xml');
  res.setHeader('Content-Length', Buffer.byteLength(twiml));
  res.status(200).send(twiml);
}

export const config = {
  api: { bodyParser: false }
};
