// /api/twilio/conference-participant-status.js
// FIXED VERSION - Proper participant hold implementation

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
  
  // These are the key fields from the conference status callback
  const callSid = parsed.CallSid;
  const conferenceSid = parsed.ConferenceSid;
  const statusCallbackEvent = parsed.StatusCallbackEvent;
  
  console.log('🎯 Conference Event:', statusCallbackEvent);
  console.log('Conference ID:', conferenceId);
  console.log('Conference SID:', conferenceSid);
  console.log('Call SID:', callSid);
  
  // Only process 'participant-join' events
  if (statusCallbackEvent === 'participant-join') {
    // Check if this is VAPI joining
    const { data: session } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('conference_id', conferenceId)
      .eq('vapi_participant_sid', callSid)
      .single();
    
    if (session) {
      console.log('📞 VAPI joined conference, putting on hold...');
      
      try {
        // This is the correct way to put a participant on hold
        const participant = await twilioClient
          .conferences(conferenceSid)
          .participants(callSid)
          .update({
            hold: true,
            holdUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical'
          });
        
        console.log('✅ VAPI put on hold successfully:', participant.hold);
        
        // Update database
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: true,
            conference_sid: conferenceSid, // Store the conference SID for later use
            vapi_joined_at: new Date().toISOString()
          })
          .eq('conference_id', conferenceId);
          
      } catch (error) {
        console.error('❌ Error putting VAPI on hold:', error);
        console.error('Error details:', error.message);
      }
    } else {
      console.log('👤 Non-VAPI participant joined conference');
    }
  }
  
  res.status(200).send('');
}

export const config = {
  api: {
    bodyParser: false
  }
};
