// /api/twilio/preclassify-twiml.js
import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Parse POST body from Twilio
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const twilioData = querystring.parse(body);
  const callSid = twilioData.CallSid;
  
  // Get phone number from query params
  const { phoneNumber } = req.query;
  
  console.log('📞 Pre-classification call answered:', callSid);
  console.log('📱 Phone:', phoneNumber);
  
  // Create or update call session
  await supabase
    .from('call_sessions')
    .insert({
      call_id: callSid,
      stream_started: true,
      created_at: new Date().toISOString()
    });
  
  // TwiML: Stream to WebSocket AND dial VAPI via SIP
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callSid}" />
        </Stream>
      </Start>
      <Dial>
        <Sip>
          ${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callSid}
        </Sip>
      </Dial>
    </Response>`;
  
  console.log('🎯 TwiML Response:', twiml);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
