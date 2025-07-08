// /api/twilio/call-status.js
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
  
  console.log('📞 Call Status:', callSid, callStatus);
  
  // Update call status in database
  await supabase
    .from('call_sessions')
    .update({ 
      call_status: callStatus,
      updated_at: new Date().toISOString()
    })
    .eq('call_id', callSid);
  
  res.status(200).send('');
}

export const config = {
  api: {
    bodyParser: false
  }
};
