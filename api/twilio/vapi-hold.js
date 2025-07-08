// /api/twilio/vapi-hold.js
export default async function handler(req, res) {
  const { callId } = req.query;
  
  console.log('📞 VAPI Hold endpoint called for:', callId);
  
  // Put VAPI on hold with just a long pause
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="120"/>
    </Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: true
  }
};
