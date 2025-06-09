// api/telnyx/deepgram-texml.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper to parse body based on content type
async function parseBody(req) {
  const contentType = req.headers['content-type'] || '';
  
  if (contentType.includes('application/json')) {
    return req.body;
  }
  
  // If body parsing failed, try to read raw body
  if (!req.body && req.method === 'POST') {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          console.error('Failed to parse body:', e);
          resolve({});
        }
      });
    });
  }
  
  return req.body || {};
}

export default async function handler(req, res) {
  console.log('🔍 Incoming request method:', req.method);
  console.log('🔍 Headers:', req.headers);
  
  // Handle GET requests (for testing)
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'healthy',
      endpoint: 'Telnyx TeXML Handler',
      timestamp: new Date().toISOString()
    });
  }
  
  // Parse body
  const body = await parseBody(req);
  console.log('📦 Parsed body:', JSON.stringify(body, null, 2));
  
  // Extract call details from TeXML webhook
  // TeXML uses different field names than regular Telnyx webhooks
  const callId = body.CallSid || body.CallSidLegacy || 'unknown';
  const accountSid = body.AccountSid;
  const from = body.From;
  const to = body.To;
  
  console.log(`📞 TeXML webhook - Call: ${callId}, From: ${from}, To: ${to}`);
  
  // For TeXML, we respond with XML instructions immediately
  return handleTeXMLCall(callId, from, to, res);
}

async function handleCallInitiated(body, res) {
  console.log('📞 Call initiated');
  
  // For call.initiated, we typically just acknowledge
  // The actual answer will come in call.answered event
  res.status(200).json({ status: 'ok' });
}

async function handleCallAnswered(callId, body, res) {
  console.log('📞 Call answered, starting IVR detection for:', callId);

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
  // Note: Telnyx uses fork_stream instead of Start_Stream
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Fork_stream name="deepgram_stream" 
               to="${DEEPGRAM_URL}"
               track="both_tracks">
    <Stream_param name="streamSid" value="${callId}" />
  </Fork_stream>
  <Pause length="3" />
  <Redirect method="POST">${getWebhookUrl()}/api/telnyx/deepgram-texml</Redirect>
</Response>`;

  console.log('📤 Sending TeXML response');
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

  // For DTMF actions
  if (action.action_type === 'dtmf') {
    texml += `
  <Play_dtmf digits="${action.action_value}" />
  <Pause length="1" />`;
  } else if (action.action_type === 'speech') {
    texml += `
  <Speak voice="en-US-Standard-C">${action.action_value}</Speak>
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
  const vapiSipAddress = process.env.VAPI_SIP_ADDRESS;
  const vapiPhoneNumber = process.env.VAPI_PHONE_NUMBER;
  
  // Use SIP if available, otherwise use phone number
  const transferTo = vapiSipAddress ? `sip:${vapiSipAddress}` : vapiPhoneNumber;
  
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Transfer to="${transferTo}" />
</Response>`;

  console.log('📤 Transferring to VAPI:', transferTo);
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
  // Use explicit webhook URL if set
  if (process.env.WEBHOOK_BASE_URL) {
    return process.env.WEBHOOK_BASE_URL;
  }
  
  // For production deployments
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  
  // For preview deployments
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    // Handle both with and without protocol
    return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
  }
  
  // Fallback - use your actual production URL
  return 'https://v0-new-project-qykgboija9j.vercel.app';
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};
