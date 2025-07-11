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
  
  // Twilio sends the called number as 'To' and the calling number as 'From'
  const phoneNumber = twilioData.To; // This is the number we called (the clinic)
  const fromNumber = twilioData.From; // This is our Twilio number
  
  console.log('📞 Pre-classification call answered:', callSid);
  console.log('📱 Called number (To):', phoneNumber);
  console.log('📱 From number:', fromNumber);
  console.log('📋 All Twilio data:', twilioData);
  
  // Create or update call session with phone number
  const { error: insertError } = await supabase
    .from('call_sessions')
    .insert({
      call_id: callSid,
      stream_started: true,
      clinic_phone: phoneNumber, // Store the number we called
      created_at: new Date().toISOString()
    });
    
  if (insertError) {
    console.error('❌ Error creating session:', insertError);
  } else {
    console.log('✅ Created session with phone:', phoneNumber);
  }
  
  // TwiML: Stream to WebSocket AND dial VAPI via SIP
  // Pass phone number as a parameter in the WebSocket stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callSid}" />
          <Parameter name="phoneNumber" value="${phoneNumber}" />
        </Stream>
      </Start>
      <Dial>
        <Sip>
          ${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callSid}
        </Sip>
      </Dial>
    </Response>`;
  
  console.log('🎯 TwiML Response with phone:', phoneNumber);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
