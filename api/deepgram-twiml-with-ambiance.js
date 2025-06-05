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

  // Check for IVR classification
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
    console.error('❌ Classification check error:', err);
  }

  // If human detected, transfer to VAPI
  if (classification === 'human' || classification === 'ivr_then_human') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip>
  </Dial>
</Response>`;

    console.log('🧾 Serving SIP Bridge TwiML');
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // Check if we've already set up streams
  const { data: session } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', callId)
    .single();

  // Set up dual streams on first request
  if (!session?.streams_initialized) {
    console.log('🚀 Initializing streams...');
    
    // TODO: Update this URL after deploying ambiance service to Railway
    const AMBIANCE_URL = 'wss://twilio-ws-server-ambiance.up.railway.app';
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream name="deepgram-stream" 
            url="wss://twilio-ws-server-production-81ba.up.railway.app">
      <Parameter name="streamSid" value="${callId}" />
      <Parameter name="audioTrack" value="inbound_track" />
    </Stream>
  </Start>
  
  <Start>
    <Stream name="ambiance-stream" 
            url="${AMBIANCE_URL}">
      <Parameter name="callId" value="${callId}" />
      <Parameter name="audioTrack" value="outbound_track" />
    </Stream>
  </Start>
  
  <Pause length="3" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    // Mark streams as initialized
    await supabase
      .from('call_sessions')
      .upsert({ 
        call_id: callId,
        streams_initialized: true,
        stream_started: true,
        created_at: new Date().toISOString()
      });

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // Check for IVR events
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
      console.log('🎯 Next actionable IVR event:', data);
    }
  } catch (err) {
    // No pending actions
  }

  // Handle DTMF with ambiance control
  if (ivrAction?.action_type === 'dtmf') {
    // TODO: Update this URL after deploying ambiance service to Railway
    const AMBIANCE_URL = 'wss://ambiance-controller-production.up.railway.app';
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stop>
    <Stream name="ambiance-stream" />
  </Stop>
  
  <Play digits="${ivrAction.action_value}" />
  
  <Start>
    <Stream name="ambiance-stream" 
            url="${AMBIANCE_URL}">
      <Parameter name="callId" value="${callId}" />
      <Parameter name="audioTrack" value="outbound_track" />
    </Stream>
  </Start>
  
  <Pause length="2" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // Handle speech
  if (ivrAction?.action_type === 'speech') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${ivrAction.action_value}</Say>
  <Pause length="1" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }
  
  // Default keepalive
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
