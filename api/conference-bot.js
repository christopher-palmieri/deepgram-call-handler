// /api/conference-bot.js
export default async function handler(req, res) {
  const { callId } = req.query;
  console.log('🤖 Bot joining conference for:', callId);

  // Join conference and start WebSocket stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
      <Parameter name="streamSid" value="${callId}" />
    </Stream>
  </Start>
  <Dial>
    <Conference beep="false"
                muted="false"
                startConferenceOnEnter="false"
                endConferenceOnExit="false">
      ${callId}-room
    </Conference>
  </Dial>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
