// /api/twilio/direct-vapi-test-reversed.js
export default async function handler(req, res) {
  console.log('📞 Reversed VAPI test - VAPI answering first...');
  
  // Get all parameters from the URL query string
  const { customerName, clinicName, clinicPhone, testMode } = req.query;
  
  console.log('📋 Parameters received:');
  console.log('  Customer Name:', customerName);
  console.log('  Clinic Name:', clinicName);
  console.log('  Clinic Phone:', clinicPhone);
  console.log('  Test Mode:', testMode);
  
  // VAPI now has all the parameters it needs via HTTP!
  // Now we tell Twilio to dial out to the clinic/your phone
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Connecting VAPI to ${clinicName || 'the clinic'}...</Say>
      <Pause length="1" />
      <Dial>
        <Number>${clinicPhone}</Number>
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
