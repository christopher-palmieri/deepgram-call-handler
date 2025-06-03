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

// Office ambiance audio URL from environment
const BACKGROUND_NOISE_URL = process.env.BACKGROUND_NOISE_URL || 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient';

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  const callerNumber = parsed.From || 'unknown';
  console.log('📞 Enhanced handler - call_id:', callId);
  console.log('📞 Full parsed data:', parsed);

  // === Step 1: Check for IVR classification (keep existing logic) ===
  let classification = null;
  let session = null;

  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('❌ Error checking call session:', error);
    } else if (data) {
      session = data;
      classification = data.ivr_detection_state;
      console.log('🔍 Classification:', classification);
    }
  } catch (err) {
    console.error('❌ Supabase check error:', err);
  }

  // === Step 2: Create session if needed ===
  if (!session) {
    console.log('🆕 Creating new call session...');
    try {
      const { data: newSession, error: insertErr } = await supabase
        .from('call_sessions')
        .insert([{ 
          call_id: callId,
          caller_number: callerNumber,
          created_at: new Date().toISOString(),
          stream_started: true  // Mark stream as started
        }])
        .select()
        .single();
      
      if (insertErr) {
        console.error('❌ Error creating session:', insertErr);
      } else {
        session = newSession;
      }
    } catch (err) {
      console.error('❌ Error creating session:', err);
    }
  }

  // === Step 3: Handle based on state ===
  
  // If already classified as human, go direct to VAPI
  if (classification === 'human' || classification === 'ivr_then_human') {
    console.log('👤 Human detected - redirecting to VAPI');
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip>
  </Dial>
</Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // === Step 4: Enhanced Conference Setup ===
  // Use conference for IVR detection phase with pre-connected VAPI
  if (!session?.conference_created) {
    console.log('🏢 Creating enhanced conference...');
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
      <Parameter name="streamSid" value="${callId}" />
    </Stream>
  </Start>
  <Dial>
    <Conference beep="false"
                startConferenceOnEnter="true"
                endConferenceOnExit="false"
                waitUrl="${BACKGROUND_NOISE_URL}"
                waitMethod="GET">
      ${callId}-room
    </Conference>
  </Dial>
</Response>`;

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);

    // Mark conference as created
    await supabase
      .from('call_sessions')
      .update({ conference_created: true })
      .eq('call_id', callId);

    // Immediately add VAPI (muted) to reduce latency
    setTimeout(() => {
      addVAPIToConference(callId, true); // Start muted
    }, 500);

    return;
  }

  // === Step 5: Handle IVR Actions ===
  let ivrAction = null;
  try {
    const { data, error } = await supabase
      .from('ivr_events')
      .select('id, action_type, action_value')
      .eq('call_id', callId)
      .eq('executed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (!error && data) {
      ivrAction = data;
      console.log('🎯 IVR action found:', ivrAction);
    } else if (error && error.code !== 'PGRST116') {
      console.error('❌ Error fetching IVR event:', error);
    }
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }

  if (ivrAction) {
    // Execute IVR action via conference
    if (ivrAction.action_type === 'dtmf') {
      await playDTMFToConference(callId, ivrAction.action_value);
    } else if (ivrAction.action_type === 'speech') {
      await announceToConference(callId, ivrAction.action_value);
    }

    await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);
  }

  // === Step 6: Check if we should unmute VAPI ===
  if (classification === 'human' || classification === 'ivr_then_human') {
    await unmuteVAPI(callId);
  }

  // Default: keep checking
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Redirect>/api/deepgram-enhanced</Redirect>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

// === Helper Functions ===

async function addVAPIToConference(callId, muted = true) {
  console.log('📞 Pre-connecting VAPI to conference (muted)...');
  
  const vercelUrl = process.env.VERCEL_URL.startsWith('http') 
    ? process.env.VERCEL_URL 
    : `https://${process.env.VERCEL_URL}`;

  try {
    const twimlUrl = `${vercelUrl}/api/vapi-conference-join?callId=${callId}&muted=${muted}`;
    
    const call = await twilioClient.calls.create({
      url: twimlUrl,
      to: `sip:${process.env.VAPI_SIP_ADDRESS}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      sipHeaders: {
        'X-Call-ID': callId
      }
    });

    await supabase
      .from('call_sessions')
      .update({ 
        vapi_participant_sid: call.sid,
        vapi_connected: true
      })
      .eq('call_id', callId);

    console.log('✅ VAPI pre-connected:', call.sid);
  } catch (err) {
    console.error('❌ Error adding VAPI:', err);
  }
}

async function unmuteVAPI(callId) {
  console.log('🔊 Unmuting VAPI...');
  
  try {
    const { data: session } = await supabase
      .from('call_sessions')
      .select('vapi_participant_sid')
      .eq('call_id', callId)
      .single();

    if (session?.vapi_participant_sid) {
      const participant = await twilioClient
        .conferences(`${callId}-room`)
        .participants(session.vapi_participant_sid)
        .update({ muted: false });
        
      console.log('✅ VAPI unmuted');
      
      // Update session
      await supabase
        .from('call_sessions')
        .update({ vapi_active: true })
        .eq('call_id', callId);
    }
  } catch (err) {
    console.error('❌ Error unmuting VAPI:', err);
  }
}

async function playDTMFToConference(callId, digits) {
  console.log(`🎹 Playing DTMF: ${digits}`);
  
  try {
    const participants = await twilioClient
      .conferences(`${callId}-room`)
      .participants
      .list();

    // Find the main caller (not VAPI)
    const caller = participants.find(p => p.callSid === callId);
    
    if (caller) {
      await twilioClient
        .conferences(`${callId}-room`)
        .participants(caller.callSid)
        .update({ playDtmf: digits });
    }
  } catch (err) {
    console.error('❌ Error playing DTMF:', err);
  }
}

async function announceToConference(callId, message) {
  console.log(`📢 Announcing: ${message}`);
  
  const vercelUrl = process.env.VERCEL_URL.startsWith('http') 
    ? process.env.VERCEL_URL 
    : `https://${process.env.VERCEL_URL}`;

  try {
    await twilioClient
      .conferences(`${callId}-room`)
      .update({
        announceUrl: `${vercelUrl}/api/say-message?text=${encodeURIComponent(message)}`
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
