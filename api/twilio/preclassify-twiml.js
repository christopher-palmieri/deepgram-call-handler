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
  
  // Get session ID from query parameter
  const { sessionId } = req.query;
  
  console.log('📞 Pre-classification call answered:', callSid);
  console.log('🆔 Session ID:', sessionId);
  
  let phoneNumber = null;
  
  // Look up the session to get the phone number
  if (sessionId) {
    const { data: session, error } = await supabase
      .from('call_sessions')
      .select('clinic_phone')
      .eq('id', sessionId)
      .single();
      
    if (session && session.clinic_phone) {
      phoneNumber = session.clinic_phone;
      console.log('📱 Phone number from session:', phoneNumber);
      
      // Update the session with the real CallSid
      await supabase
        .from('call_sessions')
        .update({
          call_id: callSid,
          call_status: 'active'
        })
        .eq('id', sessionId);
    } else {
      console.error('❌ Could not find session or phone number');
    }
  }
  
  // If no session/phone found, create a basic session
  if (!phoneNumber) {
    console.log('⚠️  No phone number found, creating basic session');
    await supabase
      .from('call_sessions')
      .insert({
        call_id: callSid,
        stream_started: true,
        created_at: new Date().toISOString()
      });
  }
  
  // TwiML: Stream to WebSocket AND dial VAPI via SIP
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callSid}" />
          <Parameter name="phoneNumber" value="${phoneNumber || ''}" />
        </Stream>
      </Start>
      <Dial>
        <Sip>
          ${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callSid}
        </Sip>
      </Dial>
    </Response>`;
  
  console.log('🎯 TwiML Response with phone:', phoneNumber || 'none');
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
