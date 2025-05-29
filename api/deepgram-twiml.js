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

  // === Step 1: Check for IVR classification ===
  let classification = null;

  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('ivr_detection_state')
      .eq('call_id', callId)
      .single();

    if (error) {
      console.error('❌ Error checking call session classification:', error);
    } else {
      classification = data?.ivr_detection_state;
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

  // === Step 3: Get Next Actionable IVR Event ===
  let ivrAction = null;

  try {
    console.log('🔎 Checking for IVR events...');
    
    const { data, error: ivrErr } = await supabase
      .from('ivr_events')
      .select('id, action_type, action_value, transcript')
      .eq('call_id', callId)
      .eq('executed', false)
      .not('action_type', 'is', null)
      .not('action_type', 'eq', 'wait')
      .not('action_type', 'eq', 'unknown')
      .order('created_at', { ascending: false })
      .limit(1);

    if (ivrErr) {
      console.error('❌ Error fetching IVR event:', ivrErr);
    } else if (data && data.length > 0) {
      ivrAction = data[0];
      console.log('🎯 Next actionable IVR event:', ivrAction);
    } else {
      console.log('⏳ No actionable IVR events found');
    }
  } catch (err) {
    console.error('❌ Unexpected ivr_events error:', err);
  }

  // === Step 4: Check if we should transfer to VAPI ===
  let shouldTransferToVapi = false;
  
  if (ivrAction) {
    // Check if this action indicates we've reached the front desk
    const frontDeskIndicators = [
      // DTMF actions that typically reach front desk
      { type: 'dtmf', values: ['0', '1', '2'] }, // Common front desk options
      
      // Speech actions indicating front desk
      { type: 'speech', keywords: ['front desk', 'receptionist', 'operator', 'representative', 'scheduling', 'appointment'] }
    ];
    
    // Check DTMF
    if (ivrAction.action_type === 'dtmf') {
      shouldTransferToVapi = frontDeskIndicators
        .filter(ind => ind.type === 'dtmf')
        .some(ind => ind.values.includes(ivrAction.action_value));
        
      console.log(`🔢 DTMF ${ivrAction.action_value} - Transfer to VAPI: ${shouldTransferToVapi}`);
    }
    
    // Check Speech
    if (ivrAction.action_type === 'speech') {
      const speechLower = ivrAction.action_value?.toLowerCase() || '';
      shouldTransferToVapi = frontDeskIndicators
        .filter(ind => ind.type === 'speech')
        .some(ind => ind.keywords.some(keyword => speechLower.includes(keyword)));
        
      console.log(`🗣️ Speech "${ivrAction.action_value}" - Transfer to VAPI: ${shouldTransferToVapi}`);
    }
  }

  // === Step 5: Construct TwiML ===
  let responseXml = `<Response>`;

  if (!streamAlreadyStarted) {
    responseXml += `
      <Start>
        <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;
  }

  if (ivrAction && ivrAction.action_type && ivrAction.action_value) {
    console.log(`🎬 Executing action: ${ivrAction.action_type} - ${ivrAction.action_value}`);
    
    // Stop the stream temporarily
    responseXml += `<Stop><Stream name="mediaStream" /></Stop>`;

    if (ivrAction.action_type === 'dtmf') {
      responseXml += `<Play digits="w${ivrAction.action_value}" />`;
    } else if (ivrAction.action_type === 'speech') {
      responseXml += `<Say>${ivrAction.action_value}</Say>`;
    }

    // Mark as executed
    const { error: execError } = await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);

    if (execError) console.error('❌ Error marking IVR event as executed:', execError);

    // If we should transfer to VAPI, update the classification and redirect
    if (shouldTransferToVapi) {
      console.log('🚀 Front desk reached! Updating classification to ivr_then_human...');
      
      // Update the call session classification
      const { error: updateError } = await supabase
        .from('call_sessions')
        .update({ 
          ivr_detection_state: 'ivr_then_human',
          ivr_classified_at: new Date().toISOString()
        })
        .eq('call_id', callId);
        
      if (updateError) {
        console.error('❌ Error updating classification:', updateError);
      } else {
        console.log('✅ Classification updated to ivr_then_human');
      }
      
      // Add a pause before transfer
      responseXml += `<Pause length="2" />`;
      
      // Transfer to VAPI
      responseXml += `
        <Dial>
          <Sip>sip:${process.env.VAPI_SIP_ADDRESS}?X-Call-ID=${callId}</Sip>
        </Dial>
      </Response>`;
      
    } else {
      // Continue with IVR navigation
      responseXml += `<Pause length="1" />`;
      
      // Restart stream to continue listening
      responseXml += `
        <Start>
          <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
            <Parameter name="streamSid" value="${callId}" />
          </Stream>
        </Start>`;
      
      responseXml += `<Pause length="3" />`;
      responseXml += `<Redirect>/api/deepgram-twiml</Redirect></Response>`;
    }
  } else {
    // No action to execute, continue listening
    responseXml += `<Pause length="3" />`;
    responseXml += `<Redirect>/api/deepgram-twiml</Redirect></Response>`;
  }

  console.log('🧾 TwiML response:', responseXml);

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
