// First, update your vapi-conference.js endpoint
// /api/twilio/vapi-conference.js
export default async function handler(req, res) {
  const { conferenceId } = req.query;
  
  console.log('🎤 VAPI joining conference:', conferenceId);
  
  const baseUrl = process.env.WEBHOOK_URL || 
                 process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                 'http://localhost:3000';
  
  // VAPI joins conference with a callback when it joins
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Dial>
        <Conference 
          startConferenceOnEnter="true"
          endConferenceOnExit="false"
          statusCallback="${baseUrl}/api/twilio/conference-participant-status?conferenceId=${conferenceId}"
          statusCallbackEvent="join"
          statusCallbackMethod="POST"
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
