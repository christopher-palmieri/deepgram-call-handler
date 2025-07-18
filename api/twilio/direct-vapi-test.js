// /api/twilio/direct-vapi-test.js
export default async function handler(req, res) {
  console.log('📞 Direct VAPI test - connecting with headers...');
  
  // Try multiple header formats
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Testing VAPI connection with variables. Connecting now.</Say>
      <Dial>
        <Sip>sip:brandon-call-for-kits@sip.vapi.ai?x-customername=Indiana%20Jones</Sip>
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
