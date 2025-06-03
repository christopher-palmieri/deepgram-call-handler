// /api/manager-conference-join.js
export default async function handler(req, res) {
  const { callId } = req.query;
  
  console.log(`👔 Manager joining conference for call ${callId}`);
  
  // Manager joins unmuted and can speak
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to the call...</Say>
  <Dial>
    <Conference beep="true"
                muted="false"
                startConferenceOnEnter="false"
                endConferenceOnExit="false"
                coach="${callId}">
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
