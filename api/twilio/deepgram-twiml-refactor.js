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
  
  console.log('📞 Webhook:', callId, 'status:', callStatus);

  // Handle call completion
  if (callStatus === 'completed') {
    await cleanupCall(callId);
    return res.status(200).send('<Response></Response>');
  }

  // Get session (don't create - edge function should have done this)
  const { data: session } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', callId)
    .single();

  if (!session) {
    console.error('❌ No session found for', callId);
    return res.status(200).send('<Response><Hangup/></Response>');
  }

  // === FAST PATH: Already classified as human ===
  if ((session.ivr_detection_state === 'human' || session.ivr_detection_state === 'ivr_then_human')) {
    console.log('✅ Human already detected, handling VAPI');
    
    // If VAPI is pre-dialed and on hold, bridge it
    if (session.vapi_participant_sid && session.vapi_on_hold) {
      await bridgeVAPICall(session.vapi_participant_sid, callId);
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Stop><Stream /></Stop>
          <Say>Connecting you now.</Say>
          <Dial>
            <Queue>bridge-queue-${callId}</Queue>
          </Dial>
        </Response>`;
      
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(twiml);
    }
    
    // Otherwise, direct dial VAPI
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Stop><Stream /></Stop>
        <Dial>
          <Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip>
        </Dial>
      </Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  }

  // === Pre-dial VAPI if not done by edge function ===
  if (!session.vapi_participant_sid) {
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

  // === Start WebSocket stream once ===
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

  // === Execute pending IVR actions ===
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

  // === Continue with short pause and redirect ===
  responseXml += `<Pause length="1" />`;
  responseXml += `<Redirect>/api/twilio/deepgram-twiml-refactor</Redirect></Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

// === Helper Functions ===

async function predialVAPI(callId) {
  try {
    const baseUrl = process.env.WEBHOOK_URL || 'https://v0-new-project-qykgboija9j.vercel.app';
    
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
    await twilioClient.calls(vapiCallSid).update({
      twiml: `<Response>
        <Dial>
          <Queue>bridge-queue-${originalCallId}</Queue>
        </Dial>
      </Response>`
    });
    
    await supabase
      .from('call_sessions')
      .update({ 
        vapi_on_hold: false,
        vapi_bridged_at: new Date().toISOString()
      })
      .eq('call_id', originalCallId);
    
    console.log('✅ VAPI bridged');
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

// === REAL-TIME MONITORING ===
// Create a separate monitoring service that watches for classification changes
// This can be a Vercel cron job or edge function that runs every second
export async function monitorClassifications() {
  // Get all active calls waiting for classification
  const { data: pendingCalls } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_status', 'active')
    .is('ivr_detection_state', null)
    .eq('vapi_on_hold', true);
  
  for (const call of pendingCalls || []) {
    // Check if now classified
    const { data: updated } = await supabase
      .from('call_sessions')
      .select('ivr_detection_state')
      .eq('call_id', call.call_id)
      .single();
    
    if (updated?.ivr_detection_state === 'human' || updated?.ivr_detection_state === 'ivr_then_human') {
      console.log('🎯 Human detected via monitor for', call.call_id);
      await bridgeVAPICall(call.vapi_participant_sid, call.call_id);
    }
  }
}
