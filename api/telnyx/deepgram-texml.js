// api/telnyx/deepgram-texml.js
// Combined TeXML handler with debug modes and dial status handling

export default async function handler(req, res) {
  console.log('📞 DeepGram TeXML Handler');
  console.log('📞 Method:', req.method);
  console.log('📞 URL:', req.url);
  console.log('📞 Body:', JSON.stringify(req.body, null, 2));
  
  // Check if this is a dial status callback
  if (req.body?.DialCallStatus) {
    return handleDialStatus(req, res);
  }
  
  // Extract call information from TeXML webhook
  const {
    CallSid,
    AccountSid,
    From,
    To,
    CallStatus,
    ApiVersion,
    Direction,
    ForwardedFrom,
    CallerName
  } = req.body || {};
  
  console.log('📞 Call Details:', {
    CallSid,
    From,
    To,
    Direction,
    CallStatus
  });
  
  // Configuration
  const VAPI_SIP_ADDRESS = process.env.VAPI_SIP_ADDRESS || 'brandon-call-for-kits@sip.vapi.ai';
  const TELNYX_PHONE_NUMBER = process.env.TELNYX_NUMBER_MERCERVILLE || process.env.TELNYX_PHONE_NUMBER || From;
  
  // Debug mode - set via environment variable
  const DEBUG_MODE = process.env.TEXML_DEBUG_MODE || 'production'; // 'test1', 'test2', 'test3', 'production'
  
  console.log('🔍 Debug Mode:', DEBUG_MODE);
  
  let texmlResponse;
  
  switch(DEBUG_MODE) {
    case 'test1':
      // Test 1: Just play a message and hang up
      console.log('🧪 Running Test 1: Basic TeXML test');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This is test 1. If you hear this, TeXML is working correctly. Goodbye!</Say>
  <Hangup />
</Response>`;
      break;
      
    case 'test2':
      // Test 2: Try dialing a regular number
      console.log('🧪 Running Test 2: Dial regular number');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Test 2. Dialing your number now.</Say>
  <Dial callerId="${From}" timeout="20">${To}</Dial>
</Response>`;
      break;
      
    case 'test3':
      // Test 3: Simple SIP dial without headers
      console.log('🧪 Running Test 3: Simple SIP dial');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Test 3. Connecting to VAPI.</Say>
  <Dial timeout="30">
    <Sip>sip:brandon-call-for-kits@sip.vapi.ai</Sip>
  </Dial>
</Response>`;
      break;
      
    case 'test4':
      // Test 4: SIP dial with caller ID
      console.log('🧪 Running Test 4: SIP dial with caller ID');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Test 4. Connecting to VAPI with caller ID.</Say>
  <Dial callerId="${TELNYX_PHONE_NUMBER}" timeout="30">
    <Sip>sip:brandon-call-for-kits@sip.vapi.ai</Sip>
  </Dial>
</Response>`;
      break;
      
    case 'test5':
      // Test 5: SIP dial with error callback
      console.log('🧪 Running Test 5: SIP dial with error callback');
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Test 5. Connecting to VAPI with error tracking.</Say>
  <Dial callerId="${TELNYX_PHONE_NUMBER}" timeout="30" action="https://v0-new-project-qykgboija9j.vercel.app/api/telnyx/deepgram-texml?dialStatus=true">
    <Sip>sip:brandon-call-for-kits@sip.vapi.ai</Sip>
  </Dial>
</Response>`;
      break;
      
    case 'production':
    default:
      // Production: Full VAPI dial with headers and status callback
      console.log('🚀 Production mode: Full VAPI dial');
      
      // Ensure proper SIP URI format
      const sipUri = VAPI_SIP_ADDRESS.startsWith('sip:') 
        ? VAPI_SIP_ADDRESS 
        : `sip:${VAPI_SIP_ADDRESS}`;
      
      texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting you now.</Say>
  <Dial callerId="${TELNYX_PHONE_NUMBER}" timeout="30" action="https://v0-new-project-qykgboija9j.vercel.app/api/telnyx/deepgram-texml?dialStatus=true">
    <Sip>
      <Uri>${sipUri}</Uri>
      <Headers>
        <Header name="X-Call-Sid" value="${CallSid || 'unknown'}" />
        <Header name="X-Original-From" value="${From || 'unknown'}" />
        <Header name="Alert-Info" value="auto-answer" />
      </Headers>
    </Sip>
  </Dial>
</Response>`;
      break;
  }
  
  console.log('📄 Sending TeXML Response:');
  console.log(texmlResponse);
  
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).send(texmlResponse);
}

// Handle dial status callbacks
function handleDialStatus(req, res) {
  console.log('📞 Dial Status Callback Handler');
  
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
  
  console.log('📄 Sending Dial Status TeXML Response:');
  console.log(texmlResponse);
  
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(texmlResponse);
}

export const config = {
  api: {
    bodyParser: true
  }
};
