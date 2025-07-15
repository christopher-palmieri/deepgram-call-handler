// /api/twilio/direct-vapi-test.js
export default async function handler(req, res) {
  console.log('📞 Direct VAPI test - connecting with headers...');
  
  // Let's try different approaches to see what works
  
  // Option 1: Simple header (uppercase X)
  // const sipUri = 'sip:brandon-call-for-kits@sip.vapi.ai?X-customerName=Indiana';
  
  // Option 2: Multiple headers with proper encoding
  // const sipUri = 'sip:brandon-call-for-kits@sip.vapi.ai?X-Customer-Name=Indiana&amp;X-Clinic-Name=Madison';
  
  // Option 3: Try without X- prefix (some systems use this)
  // const sipUri = 'sip:brandon-call-for-kits@sip.vapi.ai?customerName=Indiana&amp;clinicName=Madison';
  
  // Option 4: URL encoded values
  const customerName = encodeURIComponent('Indiana Jones');
  const clinicName = encodeURIComponent('Madison Health');
  const sipUri = `sip:brandon-call-for-kits@sip.vapi.ai?X-Customer-Name=${customerName}&amp;X-Clinic-Name=${clinicName}`;
  
  console.log('🔍 SIP URI:', sipUri);
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Dial>
        <Sip>${sipUri}</Sip>
      </Dial>
    </Response>`;
  
  console.log('📄 TwiML being sent:', twiml);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
