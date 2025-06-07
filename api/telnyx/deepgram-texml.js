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
  switch (eventType) {
    case 'call.initiated':
    case 'call.answered':
      return handleIncomingCall(callId, res);
    
    case 'call.hangup':
    case 'call.machine.detection.ended':
      return handleCallEnd(callId, res);
    
    default:
      // For continuation of IVR flow
      return handleIVRFlow(callId, res);
  }
}

async function handleIncomingCall(callId, res) {
  console.log('📞 Handling incoming call for call_id:', callId);

  // Create or get call session
  let session = await getOrCreateSession(callId);

  // Check if already classified as human
  if (session?.ivr_detection_state === 'human' || session?.ivr_detection_state === 'ivr_then_human') {
    console.log('👤 Human detected - transferring to VAPI');
    return transferToVAPI(res);
  }

  // Start WebSocket stream to Deepgram service
  if (!session?.stream_started) {
    console.log('🎙️ Starting Deepgram stream');
    return startDeepgramStream(callId, res);
  }

  // Continue with IVR flow
  return handleIVRFlow(callId, res);
}

async function getOrCreateSession(callId) {
  try {
    // Check for existing session
    const { data: existingSession, error: fetchError } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', callId)
      .single();

    if (existingSession) {
      return existingSession;
    }

    // Create new session
    console.log('🆕 Creating new call session');
    const { data: newSession, error: createError } = await supabase
      .from('call_sessions')
      .insert([{
        call_id: callId,
        created_at: new Date().toISOString(),
        stream_started: false,
        ivr_detection_state: null
      }])
      .select()
      .single();

    if (createError) {
      console.error('❌ Error creating session:', createError);
      return null;
    }

    return newSession;
  } catch (err) {
    console.error('❌ Session management error:', err);
    return null;
  }
}

async function startDeepgramStream(callId, res) {
  // Mark stream as started
  await supabase
    .from('call_sessions')
    .update({ stream_started: true })
    .eq('call_id', callId);

  const DEEPGRAM_URL = process.env.DEEPGRAM_WS_URL || 'wss://twilio-ws-server-production-81ba.up.railway.app';

  // TeXML to start WebSocket stream
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start_Stream name="deepgram_stream" 
               url="${DEEPGRAM_URL}"
               track="both"
               bidirectional="true">
    <Parameter name="streamSid" value="${callId}" />
  </Start_Stream>
  <Pause length="3" />
  <Redirect method="POST">${getWebhookUrl()}/api/telnyx/deepgram-texml</Redirect>
</Response>`;

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(texml);
}

async function handleIVRFlow(callId, res) {
  console.log('🔄 Handling IVR flow for:', callId);

  // Check for classification update
  const { data: session } = await supabase
    .from('call_sessions')
    .select('ivr_detection_state')
    .eq('call_id', callId)
    .single();

  if (session?.ivr_detection_state === 'human' || session?.ivr_detection_state === 'ivr_then_human') {
    console.log('👤 Human detected during flow - transferring');
    return transferToVAPI(res);
  }

  // Check for pending IVR actions
  const { data: ivrAction } = await supabase
    .from('ivr_events')
    .select('id, action_type, action_value')
    .eq('call_id', callId)
    .eq('executed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (ivrAction) {
    return executeIVRAction(callId, ivrAction, res);
  }

  // Default: continue listening
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2" />
  <Redirect method="POST">${getWebhookUrl()}/api/telnyx/deepgram-texml</Redirect>
</Response>`;

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(texml);
}

async function executeIVRAction(callId, action, res) {
  console.log('🎯 Executing IVR action:', action);

  let texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>`;

  // Stop stream temporarily for DTMF
  if (action.action_type === 'dtmf') {
    texml += `
  <Stop_Stream name="deepgram_stream" />
  <Pause length="0.5" />
  <Play_dtmf>${action.action_value}</Play_dtmf>
  <Pause length="1" />`;
    
    // Restart stream
    const DEEPGRAM_URL = process.env.DEEPGRAM_WS_URL || 'wss://twilio-ws-server-production-81ba.up.railway.app';
    texml += `
  <Start_Stream name="deepgram_stream" 
               url="${DEEPGRAM_URL}"
               track="both"
               bidirectional="true">
    <Parameter name="streamSid" value="${callId}" />
  </Start_Stream>`;
  } else if (action.action_type === 'speech') {
    texml += `
  <Speak voice="en-US-Wavenet-C">${action.action_value}</Speak>
  <Pause length="1" />`;
  }

  // Mark action as executed
  await supabase
    .from('ivr_events')
    .update({ 
      executed: true,
      executed_at: new Date().toISOString()
    })
    .eq('id', action.id);

  // Continue flow
  texml += `
  <Pause length="2" />
  <Redirect method="POST">${getWebhookUrl()}/api/telnyx/deepgram-texml</Redirect>
</Response>`;

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(texml);
}

function transferToVAPI(res) {
  const vapiAddress = process.env.VAPI_SIP_ADDRESS || process.env.VAPI_PHONE_NUMBER;
  
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Transfer to="${vapiAddress}" 
           transfer_caller_id="enabled"
           webhook_url="${getWebhookUrl()}/api/telnyx/transfer-status"
           webhook_url_method="POST" />
</Response>`;

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(texml);
}

async function handleCallEnd(callId, res) {
  console.log('📴 Call ended:', callId);
  
  // Update session
  await supabase
    .from('call_sessions')
    .update({
      call_ended_at: new Date().toISOString(),
      stream_started: false
    })
    .eq('call_id', callId);

  res.status(200).json({ status: 'ok' });
}

function getWebhookUrl() {
  // Use environment variable or construct from Vercel URL
  if (process.env.WEBHOOK_BASE_URL) {
    return process.env.WEBHOOK_BASE_URL;
  }
  
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
  }
  
  // Fallback
  return 'https://your-domain.vercel.app';
}

export const config = {
  api: {
    bodyParser: true  // Telnyx sends JSON
  }
};
