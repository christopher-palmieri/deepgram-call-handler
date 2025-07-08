// /api/twilio/conference-participant-status.js
import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';
import twilio from 'twilio';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const { conferenceId } = req.query;
  
  console.log('🎯 Participant joined conference:', conferenceId);
  console.log('Call SID:', parsed.CallSid);
  console.log('Conference SID:', parsed.ConferenceSid);
  
  // Check if this is VAPI joining
  const { data: session } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('conference_id', conferenceId)
    .eq('vapi_participant_sid', parsed.CallSid)
    .single();
  
  if (session) {
    console.log('📞 VAPI joined conference, putting on hold...');
    
    try {
      // Put VAPI on hold using the conference SID and call SID
      const participant = await twilioClient
        .conferences(parsed.ConferenceSid)
        .participants(parsed.CallSid)
        .update({
          hold: true,
          holdUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical'
        });
      
      console.log('✅ VAPI put on hold successfully');
      
      // Update database
      await supabase
        .from('call_sessions')
        .update({ 
          vapi_on_hold: true,
          conference_sid: parsed.ConferenceSid // Store the actual conference SID
        })
        .eq('conference_id', conferenceId);
        
    } catch (error) {
      console.error('❌ Error putting VAPI on hold:', error);
    }
  }
  
  res.status(200).send('');
}

export const config = {
  api: {
    bodyParser: false
  }
};
