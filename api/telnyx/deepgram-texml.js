// api/telnyx/deepgram-texml.js
// Simple TeXML endpoint that immediately dials VAPI (no IVR detection)

export default async function handler(req, res) {
  console.log('📞 DeepGram TeXML Handler (Simple VAPI Dial)');
  console.log('📞 Method:', req.method);
  console.log('📞 URL:', req.url);
  console.log('📞 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📞 Body:', JSON.stringify(req.body, null, 2));
  
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
  
  // Your VAPI configuration
  const VAPI_SIP_ADDRESS = process.env.VAPI_SIP_ADDRESS || 'brandon-call-for-kits@sip.vapi.ai';
  const TELNYX_PHONE_NUMBER = process.env.TELNYX_NUMBER_MERCERVILLE || process.env.TELNYX_PHONE_NUMBER || To;
  
  // Ensure proper SIP URI format
  const sipUri = VAPI_SIP_ADDRESS.startsWith('sip:') 
    ? VAPI_SIP_ADDRESS 
    : `sip:${VAPI_SIP_ADDRESS}`;
  
  console.log('🎯 Dialing VAPI at:', sipUri);
  console.log('📞 Using caller ID:', TELNYX_PHONE_NUMBER);
  
  // Simple TeXML that immediately dials VAPI
  const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting you now, please wait.</Say>
  <Dial callerId="${TELNYX_PHONE_NUMBER}" timeout="30" action="https://v0-new-project-qykgboija9j.vercel.app/api/telnyx/dial-status">
    <Sip>
      <Uri>${sipUri}</Uri>
      <Headers>
        <Header name="X-Call-Sid" value="${CallSid || 'unknown'}" />
        <Header name="X-Original-From" value="${From || 'unknown'}" />
        <Header name="X-Original-To" value="${To || 'unknown'}" />
        <Header name="X-Telnyx-Account" value="${AccountSid || 'unknown'}" />
        <Header name="Alert-Info" value="auto-answer" />
        <Header name="Call-Info" value="answer-after=0" />
        <Header name="Answer-Mode" value="Auto" />
        <Header name="P-Auto-Answer" value="normal" />
      </Headers>
    </Sip>
  </Dial>
</Response>`;
  
  console.log('📄 Sending TeXML Response:');
  console.log(texmlResponse);
  
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).send(texmlResponse);
}

export const config = {
  api: {
    bodyParser: true
  }
};
