// api/telnyx/dial-status.js
// Handles the result of the dial attempt to VAPI

export default async function handler(req, res) {
  console.log('📞 Dial Status Callback');
  console.log('📞 Method:', req.method);
  console.log('📞 Body:', JSON.stringify(req.body, null, 2));
  
  const {
    CallSid,
    DialCallStatus,
    DialCallDuration,
    DialCallSid,
    RecordingUrl,
    From,
    To
  } = req.body || {};
  
  console.log('📞 Dial Result:', {
    CallSid,
    DialCallStatus,
    DialCallDuration,
    DialCallSid
  });
  
  // Handle different dial outcomes
  let texmlResponse;
  
  switch (DialCallStatus) {
    case 'completed':
      console.log('✅ Call completed successfully');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;
      break;
      
    case 'busy':
      console.log('🔴 VAPI was busy');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">The system is currently busy. Please try again later.</Say>
  <Hangup />
</Response>`;
      break;
      
    case 'no-answer':
      console.log('🔴 VAPI did not answer');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Unable to connect your call. Please try again.</Say>
  <Hangup />
</Response>`;
      break;
      
    case 'failed':
    default:
      console.log('🔴 Call failed:', DialCallStatus);
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We encountered an error. Please call back.</Say>
  <Hangup />
</Response>`;
      break;
  }
  
  console.log('📄 Sending TeXML Response:');
  console.log(texmlResponse);
  
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(texmlResponse);
}

export const config = {
  api: {
    bodyParser: true
  }
};
