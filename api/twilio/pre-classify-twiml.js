// /api/twilio/pre-classify-twiml.js
export default async function handler(req, res) {
  const { sessionId, clinicName } = req.query;
  
  console.log('🔍 Pre-classification call started');
  console.log('Session ID:', sessionId);
  console.log('Clinic Name:', clinicName);
  
  // Start WebSocket stream immediately for classification
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${sessionId}" />
          <Parameter name="isPreClassification" value="true" />
        </Stream>
      </Start>
      <Pause length="15"/>
      <Hangup/>
    </Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: true
  }
};
