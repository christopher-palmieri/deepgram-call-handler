// /api/twilio/clinic-conference.js
export default async function handler(req, res) {
  const { conferenceId } = req.query;
  
  console.log('📞 Clinic joining conference with WebSocket:', conferenceId);
  
  // Clinic joins conference WITH WebSocket stream for classification
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${conferenceId}" />
          <Parameter name="token" value="${process.env.WS_AUTH_TOKEN}" />
        </Stream>
      </Start>
      <Dial>
        <Conference 
          startConferenceOnEnter="true"
          endConferenceOnExit="true"
          beep="false">
          ${conferenceId}
        </Conference>
      </Dial>
    </Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: true
  }
};
