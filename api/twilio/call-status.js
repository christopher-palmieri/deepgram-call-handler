// api/call-status.js
import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid;
  const callStatus = parsed.CallStatus;
  
  console.log(`📞 Call status update: ${callId} - ${callStatus}`);

  // When call completes, reset the session
  if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
    try {
      // Option 1: Reset flags for reuse
      await supabase
        .from('call_sessions')
        .update({ 
          streams_initialized: false,
          stream_started: false,
          conference_created: false,
          vapi_participant_sid: null,
          vapi_joined_at: null,
          call_ended_at: new Date().toISOString(),
          call_status: callStatus
        })
        .eq('call_id', callId);
      
      console.log(`✅ Reset session for completed call: ${callId}`);
      
      // Option 2: Or delete the session entirely (cleaner for high volume)
      // await supabase
      //   .from('call_sessions')
      //   .delete()
      //   .eq('call_id', callId);
      
    } catch (err) {
      console.error('❌ Error updating call status:', err);
    }
  }

  // Always respond with 200 OK
  res.status(200).send('OK');
}

export const config = {
  api: {
    bodyParser: false
  }
};
