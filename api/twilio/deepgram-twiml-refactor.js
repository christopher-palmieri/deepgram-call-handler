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
  
  console.log('📞 Incoming webhook for call_id:', callId, 'status:', callStatus);

  // Handle call completion
  if (callStatus === 'completed') {
    await cleanupCall(callId);
    return res.status(200).send('<Response></Response>');
  }

  // === Step 1: Get/Create Call Session ===
  let session = await getOrCreateCallSession(callId);

  // === Step 2: Check if VAPI needs to be pre-dialed ===
  // Skip if already pre-dialed by edge function or if classification exists
  if (!session.vapi_participant_sid && !session.ivr_detection_state) {
    console.log('🚀 VAPI not pre-dialed by edge function, dialing now...');
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
  } else if (session.vapi_participant_sid && session.vapi_on_hold) {
    console.log('✅ VAPI already pre-dialed by edge function:', session.vapi_participant_sid);
  }

  // === Step 3: Check IVR Classification ===
  const classification = session.ivr_detection_state;
  
  if (classification === 'human' || classification === 'ivr_then_human') {
    console.log('🎯 Human detected! Bridging to VAPI...');
    
    // If VAPI is on hold, dequeue it
    if (session.vapi_participant_sid && session.vapi_on_hold) {
      // Update VAPI call to leave queue and dial back
      await bridgeVAPICall(session.vapi_participant_sid, callId);
      
      // Update session
      await supabase
        .from('call_sessions')
        .update({ vapi_on_hold: false })
        .eq('call_id', callId);
      
      // Connect this call to the queue where VAPI will dial in
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
    
    // Fallback: Direct SIP dial if no pre-dialed VAPI
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial>
          <Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip>
        </Dial>
      </Response>`;

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  }

  // === Step 4: Continue IVR Classification ===
  let streamAlreadyStarted = session.stream_started;
  
  // Get next IVR action
  const ivrAction = await getNextIVRAction(callId);

  // Construct TwiML
  let responseXml = `<Response>`;

  // Start WebSocket stream if needed
  if (!streamAlreadyStarted) {
    responseXml += `
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL || 'wss://twilio-ws-server-production-81ba.up.railway.app'}">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;
    
    // Mark stream as started
    await supabase
      .from('call_sessions')
      .update({ stream_started: true })
      .eq('call_id', callId);
  }

  // Execute IVR action if available
  if (ivrAction) {
    console.log('🎮 Executing IVR action:', ivrAction);
    
    // Stop stream briefly for action
    responseXml += `<Stop><Stream name="mediaStream" /></Stop>`;

    if (ivrAction.action_type === 'dtmf') {
      responseXml += `<Play digits="${ivrAction.action_value}" />`;
    } else if (ivrAction.action_type === 'speech') {
      responseXml += `<Say>${ivrAction.action_value}</Say>`;
    }

    responseXml += `<Pause length="1" />`;

    // Restart stream
    responseXml += `
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL || 'wss://twilio-ws-server-production-81ba.up.railway.app'}">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;

    // Mark action as executed
    await supabase
      .from('ivr_events')
      .update({ executed: true, executed_at: new Date().toISOString() })
      .eq('id', ivrAction.id);
  } else {
    // No action, just pause
    responseXml += `<Pause length="2" />`;
  }

  // Continue polling
  responseXml += `<Redirect>/api/twilio/deepgram-twiml-refactor</Redirect></Response>`;

  console.log('📋 TwiML Response:', responseXml);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

// === Helper Functions ===

async function getOrCreateCallSession(callId) {
  const { data: session, error } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', callId)
    .single();

  if (!session) {
    console.log('🆕 Creating new call session...');
    const { data: newSession, error: insertErr } = await supabase
      .from('call_sessions')
      .insert([{ 
        call_id: callId, 
        stream_started: false,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (insertErr) {
      console.error('❌ Error creating session:', insertErr);
      return { call_id: callId };
    }
    return newSession;
  }
  
  return session;
}

async function predialVAPI(callId) {
  try {
    // Extract base URL from current environment
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
    
    console.log('✅ VAPI pre-dialed from webhook:', call.sid);
    return call.sid;
  } catch (error) {
    console.error('❌ Error pre-dialing VAPI:', error);
    return null;
  }
}

async function bridgeVAPICall(vapiCallSid, originalCallId) {
  try {
    // Update the VAPI call to leave hold and dial into bridge queue
    await twilioClient.calls(vapiCallSid).update({
      twiml: `<Response>
        <Dial>
          <Queue>bridge-queue-${originalCallId}</Queue>
        </Dial>
      </Response>`
    });
    
    console.log('✅ VAPI call updated to bridge');
  } catch (error) {
    console.error('❌ Error bridging VAPI:', error);
  }
}

async function getNextIVRAction(callId) {
  const { data, error } = await supabase
    .from('ivr_events')
    .select('id, action_type, action_value')
    .eq('call_id', callId)
    .eq('executed', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }
  
  return data;
}

async function cleanupCall(callId) {
  console.log('🧹 Cleaning up call:', callId);
  
  // Get session to find VAPI call
  const { data: session } = await supabase
    .from('call_sessions')
    .select('vapi_participant_sid')
    .eq('call_id', callId)
    .single();
  
  // Hang up VAPI if still active
  if (session?.vapi_participant_sid) {
    try {
      await twilioClient.calls(session.vapi_participant_sid).update({
        status: 'completed'
      });
    } catch (error) {
      console.log('VAPI call already completed');
    }
  }
  
  // Update session status
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
  
  console.log('📞 VAPI Hold endpoint called for:', callId);
  
  // VAPI enters a hold queue - silent waiting
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="1"/>
      <Enqueue>vapi-hold-${callId}</Enqueue>
    </Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

// === /api/twilio/hold-music.js === (Optional - can be removed if not needed)
// This endpoint is not currently referenced but could be used later
export async function holdMusicHandler(req, res) {
  // Simple silence for now
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="30"/>
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
  
  // Update VAPI call status in database if needed
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

// === Database Schema Updates ===
/*
Your existing columns that we'll use:
- vapi_participant_sid: text (instead of vapi_call_sid)
- vapi_on_hold: boolean
- vapi_joined_at: timestamptz (instead of vapi_pre_dialed_at)

Additional column if you don't have it:
- vapi_call_status: text

Example SQL if needed:
ALTER TABLE call_sessions 
ADD COLUMN vapi_call_status text;
*/

// === Environment Variables Needed ===
/*
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
DEEPGRAM_WS_URL=wss://your-ws-server.railway.app
WEBHOOK_URL=https://v0-new-project-qykgboija9j.vercel.app
VAPI_SIP_ADDRESS=your-vapi@sip.vapi.ai
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
*/
