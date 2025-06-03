import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';
import twilio from 'twilio';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Add validation for Twilio credentials
console.log('=== Environment Check ===');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'NOT SET');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'NOT SET');
console.log('TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER || 'NOT SET');
console.log('VERCEL_URL:', process.env.VERCEL_URL || 'NOT SET');

if (!process.env.TWILIO_ACCOUNT_SID) {
  console.error('ERROR: TWILIO_ACCOUNT_SID is not set');
}
if (!process.env.TWILIO_AUTH_TOKEN) {
  console.error('ERROR: TWILIO_AUTH_TOKEN is not set');
}

// Initialize Twilio client for API calls
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Background noise URL
const BACKGROUND_NOISE_URL = process.env.BACKGROUND_NOISE_URL || 'https://your-cdn.com/office-ambient-loop.mp3';

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  console.log('📞 [CONFERENCE] Incoming call for call_id:', callId);

  // === Step 1: Check for IVR classification ===
  let classification = null;

  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('ivr_detection_state, vapi_participant_sid, conference_created')
      .eq('call_id', callId)
      .single();

    if (error) {
      console.error('❌ Error checking call session classification:', error);
    } else {
      classification = data?.ivr_detection_state;
      console.log('🔍 Classification:', classification);
    }
  } catch (err) {
    console.error('❌ Supabase classification check error:', err);
  }

  // === Step 2: Check or Create Call Session ===
  let conferenceCreated = false;
  let vapiParticipantSid = null;

  try {
    const { data: session, error: sessionErr } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .single();

    if (!session) {
      console.log('🆕 Creating new call session...');
      const { error: insertErr } = await supabase.from('call_sessions').insert([
        { 
          call_id: callId, 
          conference_created: true,
          created_at: new Date().toISOString()
        }
      ]);
      if (insertErr) console.error('❌ Error creating call session:', insertErr);
    } else {
      conferenceCreated = session.conference_created || false;
      vapiParticipantSid = session.vapi_participant_sid;
    }
  } catch (err) {
    console.error('❌ Supabase call_sessions error:', err);
  }

  // === Step 3: Get Next Actionable IVR Event ===
  let ivrAction = null;

  try {
    const { data, error: ivrErr } = await supabase
      .from('ivr_events')
      .select('id, action_type, action_value')
      .eq('call_id', callId)
      .eq('executed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (ivrErr) {
      console.error('❌ Error fetching IVR event:', ivrErr);
    } else {
      ivrAction = data;
      console.log('🎯 Next actionable IVR event:', data);
    }
  } catch (err) {
    console.error('❌ Unexpected ivr_events error:', err);
  }

  // === Step 4: Handle Conference-based TwiML ===
  
  // If not in conference yet, create it
  if (!conferenceCreated) {
    console.log('🏢 Creating conference room...');
    
    const vercelUrl = process.env.VERCEL_URL.startsWith('http') 
      ? process.env.VERCEL_URL 
      : `https://${process.env.VERCEL_URL}`;
    
    const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference beep="false"
                startConferenceOnEnter="true"
                endConferenceOnExit="false"
                statusCallback="${vercelUrl}/api/conference-status"
                statusCallbackEvent="start end join leave mute unmute">
      ${callId}-room
    </Conference>
  </Dial>
</Response>`;

    console.log('🧾 Creating conference:', responseXml);
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(responseXml);
    
    // Trigger bot and VAPI to join conference immediately
    // Don't use setTimeout in serverless functions!
    addBotToConference(callId);
    addVAPIToConference(callId, true); // Start muted
    
    return;
  }

  // === Step 5: Handle IVR Actions via Conference ===
  if (ivrAction && ivrAction.action_type && ivrAction.action_value) {
    console.log('🎬 Executing IVR action via conference:', ivrAction);
    
    if (ivrAction.action_type === 'dtmf') {
      // Play DTMF to the conference
      await playDTMFToConference(callId, ivrAction.action_value);
    } else if (ivrAction.action_type === 'speech') {
      // Announce to conference
      await announceToConference(callId, ivrAction.action_value);
    }

    // Mark as executed
    await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);
  }

  // === Step 6: Handle Human Detection - Unmute VAPI ===
  if ((classification === 'human' || classification === 'ivr_then_human') && vapiParticipantSid) {
    console.log('👤 Human detected! Unmuting VAPI...');
    
    try {
      // Find and unmute VAPI participant
      const participants = await twilioClient.conferences(`${callId}-room`)
        .participants
        .list();
        
      const vapiParticipant = participants.find(p => p.sid === vapiParticipantSid);
      
      if (vapiParticipant && vapiParticipant.muted) {
        await twilioClient.conferences(`${callId}-room`)
          .participants(vapiParticipantSid)
          .update({ muted: false });
          
        console.log('🔊 VAPI unmuted successfully');
      }
    } catch (err) {
      console.error('❌ Error unmuting VAPI:', err);
    }
  }

  // Default response - just wait
  const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3"/>
  <Redirect>/api/deepgram-conference</Redirect>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

// === Helper Functions ===

async function addBotToConference(callId) {
  console.log('🤖 Adding bot to conference...');
  
  const vercelUrl = process.env.VERCEL_URL.startsWith('http') 
    ? process.env.VERCEL_URL 
    : `https://${process.env.VERCEL_URL}`;
  
  try {
    const call = await twilioClient.calls.create({
      url: `${vercelUrl}/api/conference-bot?callId=${callId}`,
      to: process.env.TWILIO_PHONE_NUMBER, // Call your own number
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    
    console.log('✅ Bot call initiated:', call.sid);
  } catch (err) {
    console.error('❌ Error adding bot:', err);
  }
}

async function addVAPIToConference(callId, startMuted = true) {
  console.log('📞 Adding VAPI to conference (muted)...');
  
  const vercelUrl = process.env.VERCEL_URL.startsWith('http') 
    ? process.env.VERCEL_URL 
    : `https://${process.env.VERCEL_URL}`;
  
  try {
    const call = await twilioClient.calls.create({
      url: `${vercelUrl}/api/conference-vapi?callId=${callId}&muted=${startMuted}`,
      to: `sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}`,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    
    // Store VAPI participant info
    await supabase
      .from('call_sessions')
      .update({ 
        vapi_participant_sid: call.sid,
        vapi_joined_at: new Date().toISOString()
      })
      .eq('call_id', callId);
    
    console.log('✅ VAPI call initiated:', call.sid);
  } catch (err) {
    console.error('❌ Error adding VAPI:', err);
  }
}

async function playDTMFToConference(callId, digits) {
  console.log(`🎹 Playing DTMF ${digits} to conference...`);
  
  try {
    // Get conference participants
    const participants = await twilioClient.conferences(`${callId}-room`)
      .participants
      .list();
    
    // Find the original caller (not bot or VAPI)
    const caller = participants.find(p => !p.label?.includes('bot') && !p.label?.includes('vapi'));
    
    if (caller) {
      await twilioClient.conferences(`${callId}-room`)
        .participants(caller.callSid)
        .update({
          playDtmf: digits
        });
    }
  } catch (err) {
    console.error('❌ Error playing DTMF:', err);
  }
}

async function announceToConference(callId, message) {
  console.log(`📢 Announcing to conference: ${message}`);
  
  try {
    await twilioClient.conferences(`${callId}-room`)
      .update({
        announceUrl: `${process.env.VERCEL_URL}/api/conference-announce?message=${encodeURIComponent(message)}`
      });
  } catch (err) {
    console.error('❌ Error announcing:', err);
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};
