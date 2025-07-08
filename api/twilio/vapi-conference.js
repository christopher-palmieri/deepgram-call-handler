// /api/twilio/vapi-conference.js
export default async function handler(req, res) {
  const { conferenceId } = req.query;
  
  console.log('🎤 VAPI joining conference (muted):', conferenceId);
  
  // VAPI joins conference muted and waiting
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Dial>
        <Conference 
          muted="true"
          startConferenceOnEnter="true"
          endConferenceOnExit="false"
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
