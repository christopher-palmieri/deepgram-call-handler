// /api/twilio/deepgram-twiml-refactor.js
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

// Real-time subscription to IVR classification changes
let classificationSubscription = null;

// Initialize real-time listener for classification updates
function initializeRealtimeListener() {
  if (classificationSubscription) return;
  
  classificationSubscription = supabase
    .channel('ivr_classification_updates')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_sessions',
        filter: 'ivr_detection_state=neq.null'
      },
      async (payload) => {
        const session = payload.new;
        console.log('🎯 Real-time classification detected:', session.call_id, session.ivr_detection_state);
        
        // If human detected and VAPI is on hold, trigger immediate bridge
        if ((session.ivr_detection_state === 'human' || session.ivr_detection_state === 'ivr_then_human') 
            && session.vapi_participant_sid 
            && session.vapi_on_hold) {
          
          console.log('⚡ FAST BRIDGE: Human detected, bridging VAPI immediately');
          await bridgeVAPICall(session.vapi_participant_sid, session.call_id);
        }
      }
    )
    .subscribe();
}

// Initialize on module load
initializeRealtimeListener();

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  const callStatus = parsed.CallStatus;
  
  console.log('📞 Webhook:', callId, 'status:', callStatus);

  // Handle call completion
  if (callStatus === 'completed') {
    await cleanupCall(callId);
    return res.status(200).send('<Response></Response>');
  }

  // === Fast Path: Check if already classified ===
  const session = await getOrCreateCallSession(callId);
  
  // If already classified as human and VAPI ready, bridge immediately
  if ((session.ivr_detection_state === 'human' || session.ivr_detection_state === 'ivr_then_human') 
      && session.vapi_participant_sid 
      && !session.vapi_on_hold) {
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial>
          <Queue>bridge-queue-${callId}</Queue>
        </Dial>
      </Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  }

  // === Pre-dial VAPI if not done ===
  if (!session.vapi_participant_sid && !session.ivr_detection_state) {
    console.log('🚀 Pre-dialing VAPI...');
    const vapiCallSid = await predialVAPI(callId);
    
    if (vapiCallSid) {
      await supabase
        .from('call_sessions')
        .update({ 
          vapi_participant_sid: vapiCallSid,
          vapi_on_hold: true,
          vapi_joined_at: new Date().toISOString()
        })
        .eq('call_id', callId);
    }
  }

  // === Start WebSocket stream for classification ===
  let responseXml = `<Response>`;
  
  if (!session.stream_started) {
    responseXml += `
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;
    
    await supabase
      .from('call_sessions')
      .update({ stream_started: true })
      .eq('call_id', callId);
  }

  // === Execute IVR actions if needed ===
  const ivrAction = await getNextIVRAction(callId);
  
  if (ivrAction) {
    console.log('🎮 Executing IVR action:', ivrAction);
    
    // Stop stream briefly
    responseXml += `<Stop><Stream /></Stop>`;

    if (ivrAction.action_type === 'dtmf') {
      responseXml += `<Play digits="${ivrAction.action_value}" />`;
    } else if (ivrAction.action_type === 'speech') {
      responseXml += `<Say>${ivrAction.action_value}</Say>`;
    }

    responseXml += `<Pause length="1" />`;

    // Restart stream
    responseXml += `
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;

    await supabase
      .from('ivr_events')
      .update({ executed: true, executed_at: new Date().toISOString() })
      .eq('id', ivrAction.id);
  }

  // === Fast polling - 1 second ===
  responseXml += `<Pause length="1" />`;
  responseXml += `<Redirect>/api/twilio/deepgram-twiml-refactor</Redirect></Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

// === Helper Functions ===

async function getOrCreateCallSession(callId) {
  const { data: session } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', callId)
    .single();

  if (!session) {
    const { data: newSession } = await supabase
      .from('call_sessions')
      .insert([{ 
        call_id: callId, 
        stream_started: false,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    return newSession || { call_id: callId };
  }
  
  return session;
}

async function predialVAPI(callId) {
  try {
    const baseUrl = process.env.WEBHOOK_URL || 
                   process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                   'http://localhost:3000';
    
    const call = await twilioClient.calls.create({
      url: `${baseUrl}/api/twilio/vapi-hold?callId=${callId}`,
      to: `sip:${process.env.VAPI_SIP_ADDRESS}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      statusCallback: `${baseUrl}/api/twilio/vapi-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout: 60,
      record: false
    });
    
    console.log('✅ VAPI pre-dialed:', call.sid);
    return call.sid;
  } catch (error) {
    console.error('❌ Error pre-dialing VAPI:', error);
    return null;
  }
}

async function bridgeVAPICall(vapiCallSid, originalCallId) {
  try {
    // Update the VAPI call to leave hold and connect
    await twilioClient.calls(vapiCallSid).update({
      twiml: `<Response>
        <Dial>
          <Queue>bridge-queue-${originalCallId}</Queue>
        </Dial>
      </Response>`
    });
    
    // Update database
    await supabase
      .from('call_sessions')
      .update({ 
        vapi_on_hold: false,
        vapi_bridged_at: new Date().toISOString()
      })
      .eq('call_id', originalCallId);
    
    console.log('✅ VAPI bridged instantly');
  } catch (error) {
    console.error('❌ Error bridging VAPI:', error);
  }
}

async function getNextIVRAction(callId) {
  const { data } = await supabase
    .from('ivr_events')
    .select('id, action_type, action_value')
    .eq('call_id', callId)
    .eq('executed', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  
  return data;
}

async function cleanupCall(callId) {
  const { data: session } = await supabase
    .from('call_sessions')
    .select('vapi_participant_sid')
    .eq('call_id', callId)
    .single();
  
  if (session?.vapi_participant_sid) {
    try {
      await twilioClient.calls(session.vapi_participant_sid).update({
        status: 'completed'
      });
    } catch (error) {
      console.log('VAPI call already completed');
    }
  }
  
  await supabase
    .from('call_sessions')
    .update({ 
      call_status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('call_id', callId);
}

export const config = {
  api: {
    bodyParser: false
  }
};

// === CRITICAL: WebSocket Server Enhancement ===
// Your server_deepgram.js needs these modules from Telnyx:
// 1. IVRProcessor from modules/processors/ivr-processor.js
// 2. fastClassify from modules/classifiers/fast-classifier.js
// 3. Real-time database updates when classification happens

// === /api/twilio/vapi-hold.js ===
export async function vapiHoldHandler(req, res) {
  const { callId } = req.query;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="1"/>
      <Enqueue>vapi-hold-${callId}</Enqueue>
    </Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

// === /api/twilio/vapi-status.js ===
export async function vapiStatusHandler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callSid = parsed.CallSid;
  const callStatus = parsed.CallStatus;
  
  console.log('📊 VAPI Status:', callSid, callStatus);
  
  if (callStatus === 'completed' || callStatus === 'failed') {
    await supabase
      .from('call_sessions')
      .update({ 
        vapi_call_status: callStatus
      })
      .eq('vapi_participant_sid', callSid);
  }
  
  res.status(200).send('');
}
