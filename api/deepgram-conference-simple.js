import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BACKGROUND_NOISE_URL = process.env.BACKGROUND_NOISE_URL || 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient';

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  
  console.log('📞 Conference handler - call_id:', callId);
  console.log('📞 Call status:', parsed.CallStatus);

  // Don't process if we don't have a valid CallSid
  if (callId === 'unknown' || !callId) {
    console.error('❌ Missing CallSid');
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error: Missing call information</Say><Hangup/></Response>');
    return;
  }

  // Always join the conference with streaming
  const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
      <Parameter name="streamSid" value="${callId}" />
    </Stream>
  </Start>
  <Dial>
    <Conference beep="false"
                startConferenceOnEnter="true"
                endConferenceOnExit="true">
      ${callId}-room
    </Conference>
  </Dial>
</Response>`;

  console.log('📤 Sending conference + stream TwiML');
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);

  // Create session if it doesn't exist (non-blocking)
  supabase
    .from('call_sessions')
    .select('call_id')
    .eq('call_id', callId)
    .single()
    .then(({ data: existing, error }) => {
      if (!existing && !error) {
        console.log('🆕 Creating call session...');
        return supabase
          .from('call_sessions')
          .insert([{
            call_id: callId,
            created_at: new Date().toISOString(),
            stream_started: true,
            conference_created: true
          }]);
      }
    })
    .catch(err => {
      console.error('Session handling error:', err);
    });
}

export const config = {
  api: {
    bodyParser: false
  }
};
