// pages/api/twilio/vapi-twiml.js
// Vercel endpoint: returns TwiML to start Twilio Media Stream -> Railway VAPI bridge

export default async function handler(req, res) {
  // Parse incoming Twilio webhook (no bodyParser)
  res.setHeader('Content-Type', 'text/xml');

  // Streaming TwiML: send both directions to your Railway websocket endpoint
  const host = req.headers.host;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://${host}/stream" track="both">
      <Encoding>linear16</Encoding>
      <SampleRate>8000</SampleRate>
      <Channels>1</Channels>
    </Stream>
  </Start>
  <Say>Connecting you to the assistant.</Say>
</Response>`;

  console.log('🧾 Serving VAPI TwiML Streaming:', twiml);
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
