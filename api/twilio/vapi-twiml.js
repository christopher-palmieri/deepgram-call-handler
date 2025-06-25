import querystring from 'querystring';

export default async function handler(req, res) {
  // Streaming-only TwiML for VAPI bridge test
  // No DTMF or Speak logic
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const parsed = querystring.parse(body);
  const callSid = parsed.CallSid;
  console.log('📞 Streaming test for CallSid:', callSid);

  res.setHeader('Content-Type', 'text/xml');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
      <Parameter name="streamSid" value="${callSid || ''}" />
    </Stream>
  </Start>
  <!-- Keep the call open for audio streaming -->
  <Pause length="3600" />
</Response>`;

  console.log('🧾 Serving streaming-only TwiML:', twiml);
  res.status(200).send(twiml);
}

export const config = {
  api: { bodyParser: false }
};
