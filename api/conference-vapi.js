// /api/conference-vapi.js
export default async function handler(req, res) {
  const { callId, muted = 'true' } = req.query;
  console.log('📞 VAPI joining conference for:', callId, 'Muted:', muted);

  // Join conference (muted initially)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference beep="false"
                muted="${muted}"
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
