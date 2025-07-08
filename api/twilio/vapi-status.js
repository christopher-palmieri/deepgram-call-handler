// /api/twilio/vapi-status.js
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
  const callSid = parsed.CallSid;
  const callStatus = parsed.CallStatus;
  
  console.log('📊 VAPI Status:', callSid, callStatus);
  
  // Update VAPI call status in database
  if (callStatus === 'completed' || callStatus === 'failed') {
    await supabase
      .from('call_sessions')
      .update({ 
        vapi_call_status: callStatus
      })
      .eq('vapi_participant_sid', callSid);
  }
  
  res.status(200).send('');
}

export const config = {
  api: {
    bodyParser: false
  }
};
