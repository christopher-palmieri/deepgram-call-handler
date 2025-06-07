// api/telnyx/deepgram-texml.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Telnyx sends JSON in the body
  const body = req.body;
  
  // Extract call details from Telnyx webhook
  const callId = body.call_control_id || body.call_session_id || 'unknown';
  const eventType = body.event_type || body.event;
  
  console.log(`📞 Telnyx webhook - Event: ${eventType}, Call: ${callId}`);
  console.log('📦 Full webhook body:', JSON.stringify(body, null, 2));
  
  // Handle different Telnyx events
  if (eventType === 'call.initiated' || eventType === 'call.answered' || !eventType) {
    return handleIncomingCall(callId, res);
  }
  
  // Default response for other events
  res.status(200).json({ status: 'ok' });
}

async function handleIncomingCall(callId, res) {
  console.log('📞 Incoming call for call_id:', callId);

  // === Step 1: Check for IVR classification ===
  let classification = null;

  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('ivr_detection_state')
      .eq('call_id', callId)
      .single();

    if (!error && data) {
      classification = data.ivr_detection_state;
      console.log('🔍 Classification:', classification);
    }
  } catch (err) {
    console.log('📋 No classification found yet');
  }

  // === Step 2: Handle Human Detection ===
  if (classification === 'human' || classification === 'ivr_then_human') {
    console.log('👤 Human detected - transferring to VAPI');
    
    const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:${process.env.VAPI_SIP_ADDRESS}</Sip>
  </Dial>
</Response>`;

    res.setHeader('Content-Type', 'application/xml');
    res.status(200).send(texml);
    return;
  }

  // === Step 3: Check or Create Call Session ===
  let streamAlreadyStarted = false;

  try {
    const { data: session, error: sessionErr } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .single();

    if (!session) {
      console.log('🆕 Creating new call session...');
      const { error: insertErr } = await supabase.from('call_sessions').insert([
        { call_id: callId, stream_started: true }
      ]);
      if (insertErr) console.error('❌ Error creating call session:', insertErr);
    } else {
      streamAlreadyStarted = session.stream_started;
      if (!streamAlreadyStarted) {
        console.log('🔁 Marking stream_started = true...');
        const { error: updateErr } = await supabase
          .from('call_sessions')
          .update({ stream_started: true })
          .eq('call_id', callId);
        if (updateErr) console.error('❌ Error updating call session:', updateErr);
      }
    }
  } catch (err) {
    console.error('❌ Supabase call_sessions error:', err);
  }

  // === Step 4: Get Next Actionable IVR Event ===
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

    if (!error && data) {
      ivrAction = data;
      console.log('🎯 Next actionable IVR event:', data);
    }
  } catch (err) {
    // No pending actions - this is normal
  }

  // === Step 5: Construct TeXML Response ===
  let responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>`;

  // Initialize stream on first request
  if (!streamAlreadyStarted) {
    const DEEPGRAM_URL = process.env.DEEPGRAM_WS_URL || 'wss://twilio-ws-server-production-81ba.up.railway.app';
    
    responseXml += `
  <Stream url="${DEEPGRAM_URL}" bidirectional="true">
    <Parameter name="streamSid" value="${callId}" />
  </Stream>`;
  }

  // Handle IVR actions
  if (ivrAction && ivrAction.action_type && ivrAction.action_value) {
    // Stop stream for DTMF
    if (ivrAction.action_type === 'dtmf') {
      responseXml += `
  <Stop>
    <Stream />
  </Stop>
  <PlayDTMF>${ivrAction.action_value}</PlayDTMF>`;
      
      // Restart stream after DTMF
      const DEEPGRAM_URL = process.env.DEEPGRAM_WS_URL || 'wss://twilio-ws-server-production-81ba.up.railway.app';
      responseXml += `
  <Stream url="${DEEPGRAM_URL}" bidirectional="true">
    <Parameter name="streamSid" value="${callId}" />
  </Stream>`;
    } else if (ivrAction.action_type === 'speech') {
      responseXml += `
  <Say>${ivrAction.action_value}</Say>`;
    }

    // Mark action as executed
    await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);

    console.log('✅ IVR action marked as executed');
  }

  // Add pause and redirect
  responseXml += `
  <Pause length="3" />
  <Redirect>/api/telnyx/deepgram-texml</Redirect>
</Response>`;

  console.log('🧾 Responding with TeXML:', responseXml);

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(responseXml);
}

export const config = {
  api: {
    bodyParser: true  // Telnyx sends JSON
  }
};
