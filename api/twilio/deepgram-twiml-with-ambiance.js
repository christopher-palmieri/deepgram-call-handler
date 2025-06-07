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
  const callId = parsed.CallSid || 'unknown';
  console.log('📞 Incoming call for call_id:', callId);

  // Check if we have a valid call ID
  if (callId === 'unknown') {
    console.error('❌ No CallSid found');
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send('<Response><Hangup/></Response>');
    return;
  }

  // === Step 1: Get or Create Session ===
  let session = null;
  let isNewCall = false;
  
  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .single();
    
    if (!error && data) {
      session = data;
      
      // ALWAYS check if this is truly the first request of a NEW call
      // by looking at whether we've received the first webhook from Twilio
      const isFirstWebhook = !parsed.CallStatus || parsed.CallStatus === 'ringing' || parsed.CallStatus === 'in-progress';
      const hasNoStreamStartTime = !session.first_stream_request_at;
      
      if (isFirstWebhook && hasNoStreamStartTime) {
        console.log('🔄 First webhook for existing session - resetting streams');
        // This is the first actual request for this call
        await supabase
          .from('call_sessions')
          .update({ 
            streams_initialized: false,
            stream_started: false,
            first_stream_request_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('call_id', callId);
        
        session.streams_initialized = false;
      }
      
      console.log('📋 Found existing session:', {
        streams_initialized: session.streams_initialized,
        ivr_detection_state: session.ivr_detection_state,
        first_request: hasNoStreamStartTime
      });
    } else {
      isNewCall = true;
      console.log('🆕 New call detected');
    }
  } catch (err) {
    console.log('📋 No existing session found');
    isNewCall = true;
  }

  // === Step 2: Check for Human Classification ===
  if (session?.ivr_detection_state === 'human' || session?.ivr_detection_state === 'ivr_then_human') {
    console.log('👤 Human detected - transferring to VAPI');
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

  // === Step 3: Initialize Streams (First Time or New Call) ===
  if (isNewCall || !session || !session.streams_initialized) {
    console.log('🚀 First request - initializing streams...');
    
    const AMBIANCE_URL = process.env.AMBIANCE_URL || 'wss://twilio-ws-server-ambiance.up.railway.app';
    
    // Create or update session
    try {
      if (isNewCall || !session) {
        console.log('📝 Creating new call session');
        const { error: insertErr } = await supabase
          .from('call_sessions')
          .insert({ 
            call_id: callId,
            streams_initialized: true,
            stream_started: true,
            created_at: new Date().toISOString()
          });
        
        if (insertErr) {
          console.error('❌ Error creating session:', insertErr);
        } else {
          console.log('✅ Session created successfully');
        }
      } else {
        console.log('📝 Updating existing session');
        const { error: updateErr } = await supabase
          .from('call_sessions')
          .update({ 
            streams_initialized: true,
            stream_started: true,
            updated_at: new Date().toISOString()
          })
          .eq('call_id', callId);
        
        if (updateErr) {
          console.error('❌ Error updating session:', updateErr);
        } else {
          console.log('✅ Session updated successfully');
        }
      }
    } catch (err) {
      console.error('❌ Session operation error:', err);
    }

    // Send TwiML to start BOTH streams with correct track specification
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream name="deepgram-stream" 
            url="wss://twilio-ws-server-production-81ba.up.railway.app"
            track="inbound_track">
      <Parameter name="streamSid" value="${callId}" />
    </Stream>
  </Start>
  
  <Start>
    <Stream name="ambiance-stream" 
            url="${AMBIANCE_URL}"
            track="outbound_track">
      <Parameter name="streamSid" value="${callId}" />
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Start>
  
  <Pause length="3" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    console.log('📤 Sending stream initialization TwiML');
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // === Step 4: Check for IVR Actions ===
  console.log('🔍 Checking for IVR actions...');
  
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
      console.log('🎯 Found pending IVR action:', ivrAction);
    }
  } catch (err) {
    // No pending actions - this is normal
  }

  // === Step 5: Handle DTMF Actions ===
  if (ivrAction && ivrAction.action_type === 'dtmf') {
    console.log(`🎹 Executing DTMF: ${ivrAction.action_value}`);
    
    const AMBIANCE_URL = process.env.AMBIANCE_URL || 'wss://twilio-ws-server-ambiance.up.railway.app';
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stop>
    <Stream name="ambiance-stream" />
  </Stop>
  
  <Play digits="${ivrAction.action_value}" />
  
  <Start>
    <Stream name="ambiance-stream" 
            url="${AMBIANCE_URL}"
            track="outbound_track">
      <Parameter name="streamSid" value="${callId}" />
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Start>
  
  <Pause length="2" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    // Mark as executed IMMEDIATELY to prevent double execution
    try {
      await supabase
        .from('ivr_events')
        .update({ 
          executed: true,
          executed_at: new Date().toISOString()
        })
        .eq('id', ivrAction.id);
      
      console.log('✅ IVR action marked as executed');
    } catch (err) {
      console.error('❌ Error marking action as executed:', err);
    }

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // === Step 6: Handle Speech Actions ===
  if (ivrAction && ivrAction.action_type === 'speech') {
    console.log(`🗣️ Executing speech: ${ivrAction.action_value}`);
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${ivrAction.action_value}</Say>
  <Pause length="1" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    // Mark as executed
    try {
      await supabase
        .from('ivr_events')
        .update({ 
          executed: true,
          executed_at: new Date().toISOString()
        })
        .eq('id', ivrAction.id);
    } catch (err) {
      console.error('❌ Error marking action as executed:', err);
    }

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }
  
  // === Step 7: Default - Keep Call Alive ===
  console.log('⏳ No actions needed - keeping call alive');
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
