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

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  const callStatus = parsed.CallStatus;
  
  console.log('📞 TwiML webhook:', callId, 'status:', callStatus);

  // Handle call completion
  if (callStatus === 'completed') {
    await cleanupCall(callId);
    return res.status(200).send('<Response></Response>');
  }

  // Get or create session
  let session = await getOrCreateCallSession(callId);

  // === Check if already classified as human ===
  if (session.ivr_detection_state === 'human' || session.ivr_detection_state === 'ivr_then_human') {
    console.log('✅ Human already detected');
    
    // This shouldn't happen if the logger is working correctly, but as a safety net:
    if (session.vapi_participant_sid && session.vapi_on_hold) {
      await bridgeVAPICall(session.vapi_participant_sid, callId);
    }
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Stop><Stream /></Stop>
        <Dial>
          <Queue>bridge-queue-${callId}</Queue>
        </Dial>
      </Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  }

  // === Pre-dial VAPI if not done ===
  if (!session.vapi_participant_sid) {
    console.log('🚀 Pre-dialing VAPI into hold queue...');
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
      
      session.vapi_participant_sid = vapiCallSid;
      session.vapi_on_hold = true;
    }
  }

  // === Start or continue WebSocket stream ===
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

  // === Execute any pending IVR actions ===
  const ivrAction = await getNextIVRAction(callId);
  
  if (ivrAction) {
    console.log('🎮 Executing IVR action:', ivrAction);
    
    responseXml += `<Stop><Stream /></Stop>`;

    if (ivrAction.action_type === 'dtmf') {
      responseXml += `<Play digits="${ivrAction.action_value}" />`;
    } else if (ivrAction.action_type === 'speech') {
      responseXml += `<Say>${ivrAction.action_value}</Say>`;
    }

    responseXml += `<Pause length="1" />`;
    
    // Restart stream after action
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

  // === Continue with pause and redirect ===
  responseXml += `<Pause length="30" />`;
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
    console.log('⚠️ No session found, this should have been created by edge function');
    // Return minimal session object
    return { call_id: callId };
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
    // First check the call status
    const vapiCall = await twilioClient.calls(vapiCallSid).fetch();
    console.log(`📞 VAPI call status: ${vapiCall.status}`);
    
    if (vapiCall.status !== 'in-progress') {
      console.log(`⚠️ VAPI call not in-progress: ${vapiCall.status}`);
      return;
    }
    
    // Only update if still in progress
    await twilioClient.calls(vapiCallSid).update({
      twiml: `<Response>
        <Dial>
          <Queue>bridge-queue-${originalCallId}</Queue>
        </Dial>
      </Response>`
    });
    
    // ... rest of the function
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
  console.log('🧹 Cleaning up call:', callId);
  
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
