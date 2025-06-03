import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Office background noise MP3 URLs (you'll need to host these)
// Use a subtle, loopable office ambience sound
const BACKGROUND_NOISE_URL = process.env.BACKGROUND_NOISE_URL || 'https://your-cdn.com/office-ambient-loop.mp3';

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  console.log('📞 Incoming call for call_id:', callId);
  console.log('🎵 BACKGROUND NOISE URL:', BACKGROUND_NOISE_URL);
  console.log('✅ Using updated code with background noise - v2');

  // === Step 1: Check for IVR classification ===
  let classification = null;

  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('ivr_detection_state')
      .eq('call_id', callId)
      .maybeSingle(); // Changed from .single() to .maybeSingle()

    if (data) {
      classification = data.ivr_detection_state;
      console.log('🔍 Classification:', classification);
    }
  } catch (err) {
    console.error('❌ Supabase classification check error:', err);
  }

  if (classification === 'human' || classification === 'ivr_then_human') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial>
          <Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip>
        </Dial>
      </Response>`;

    console.log('🧾 Serving SIP Bridge TwiML:', twiml);
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // === Step 2: Check or Create Call Session ===
  let streamAlreadyStarted = false;
  let backgroundNoiseStarted = false;

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
          stream_started: true,
          background_noise_started: true 
        }
      ]);
      if (insertErr) console.error('❌ Error creating call session:', insertErr);
    } else {
      streamAlreadyStarted = session.stream_started;
      backgroundNoiseStarted = session.background_noise_started || false;
      
      if (!streamAlreadyStarted) {
        console.log('🔁 Marking stream_started = true...');
        const { error: updateErr } = await supabase
          .from('call_sessions')
          .update({ 
            stream_started: true,
            background_noise_started: true 
          })
          .eq('call_id', callId);
        if (updateErr) console.error('❌ Error updating call session:', updateErr);
      }
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
      .maybeSingle(); // Changed from .single() to .maybeSingle()

    if (data) {
      ivrAction = data;
      console.log('🎯 Next actionable IVR event:', data);
    }
  } catch (err) {
    console.error('❌ Unexpected ivr_events error:', err);
  }

  // === NEW: Check if we should transfer after IVR action ===
  let shouldTransferToVapi = false;
  
  if (classification === 'ivr_only' && ivrAction) {
    const frontDeskDTMF = ['0', '1', '2', '3'];
    const frontDeskKeywords = ['front desk', 'receptionist', 'operator', 'representative', 'patient care'];
    
    if (ivrAction.action_type === 'dtmf' && frontDeskDTMF.includes(ivrAction.action_value)) {
      shouldTransferToVapi = true;
      console.log(`🔢 [IVR_ONLY] DTMF ${ivrAction.action_value} will transfer to VAPI`);
    }
    
    if (ivrAction.action_type === 'speech') {
      const speechLower = (ivrAction.action_value || '').toLowerCase();
      if (frontDeskKeywords.some(keyword => speechLower.includes(keyword))) {
        shouldTransferToVapi = true;
        console.log(`🗣️ [IVR_ONLY] Speech "${ivrAction.action_value}" will transfer to VAPI`);
      }
    }
  }

  // === Step 4: Construct TwiML ===
  let responseXml = `<?xml version="1.0" encoding="UTF-8"?><Response>`;

  // Start the stream only if it hasn't been started yet
  if (!streamAlreadyStarted) {
    responseXml += `
      <Start>
        <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;
  }

  // Always play background noise (it will continue looping throughout the call)
  console.log('🔊 Playing background office noise...');
  responseXml += `<Play loop="0">${BACKGROUND_NOISE_URL}</Play>`;

  if (ivrAction && ivrAction.action_type && ivrAction.action_value) {
    // Stop the background noise before playing DTMF
    responseXml += `<Stop><Play /></Stop>`;
    
    if (ivrAction.action_type === 'dtmf') {
      responseXml += `<Play digits="${ivrAction.action_value}" />`;
    } else if (ivrAction.action_type === 'speech') {
      responseXml += `<Say>${ivrAction.action_value}</Say>`;
    }

    // Mark as executed
    const { error: execError } = await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);

    if (execError) console.error('❌ Error marking IVR event as executed:', execError);

    if (shouldTransferToVapi) {
      console.log('🚀 [IVR_ONLY] Transferring to VAPI after front desk action');
      responseXml += `<Pause length="2" />`;
      responseXml += `<Dial><Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip></Dial>`;
      responseXml += `</Response>`;
    } else {
      // Resume background noise and continue
      responseXml += `<Play loop="0">${BACKGROUND_NOISE_URL}</Play>`;
      responseXml += `<Pause length="3" />`;
      responseXml += `<Redirect>/api/deepgram-twiml</Redirect></Response>`;
    }
  } else {
    // No action, just continue with background noise
    responseXml += `<Pause length="3" />`;
    responseXml += `<Redirect>/api/deepgram-twiml</Redirect></Response>`;
  }

  console.log('🧾 Responding with TwiML:', responseXml);
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
