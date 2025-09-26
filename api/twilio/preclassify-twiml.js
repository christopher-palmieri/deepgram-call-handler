// /api/twilio/preclassify-twiml.js
import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateIvrNavigationTwiml(ivrActions) {
  let twiml = '';
  let lastTimingMs = 0;
  const sortedActions = [...ivrActions].sort((a, b) => a.timing_ms - b.timing_ms);
  
  for (const action of sortedActions) {
    const pauseMs = action.timing_ms - lastTimingMs;
    const pauseSeconds = Math.ceil(pauseMs / 1000);
    
    if (pauseSeconds > 0) {
      twiml += `<Pause length="${pauseSeconds}" />`;
    }
    
    if (action.action_type === 'dtmf') {
      twiml += `<Play digits="${action.action_value}" />`;
    } else if (action.action_type === 'speech') {
      twiml += `<Say>${action.action_value}</Say>`;
    } else if (action.action_type === 'transfer') {
      // For transfer, we just need the pause to time VAPI connection
      console.log(`[TRANSFER] Will connect VAPI after ${pauseSeconds}s pause`);
      // The pause has already been added above
    }
    
    lastTimingMs = action.timing_ms;
  }
  
  twiml += '<Pause length="1" />';
  return twiml;
}

function buildSipUriWithHeaders(baseUri, headers) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(headers)) {
    params.append(`X-${key}`, value);
  }
  const queryString = params.toString().replace(/&/g, '&amp;');
  return `${baseUri}?${queryString}`;
}

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const twilioData = querystring.parse(body);
  const callSid = twilioData.CallSid;
  const phoneNumber = twilioData.To;
  const fromNumber = twilioData.From;
  console.log('📞 Call answered:', callSid);
  console.log('📱 Called number (To):', phoneNumber);
  console.log('📱 From number:', fromNumber);

  const { sessionId, pendingCallId, hasClassification } = req.query;
  console.log('🆔 Session ID:', sessionId);
  console.log('📋 Pending Call ID:', pendingCallId);
  console.log('📊 Has classification:', hasClassification);

  let classification = null;
  let pendingCallData = null;

  if (pendingCallId) {
    const { data, error } = await supabase
      .from('pending_calls')
      .select('employee_name, employee_dob, appointment_time')
      .eq('id', pendingCallId)
      .single();
    if (data) {
      pendingCallData = data;
      console.log('🧾 Pending call data:', pendingCallData);
    } else {
      console.warn('⚠️ Could not fetch pending call data:', error);
    }
  }

  if (sessionId) {
    const { data: session } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (session) {
      if (session.classification_id) {
        const { data: classData } = await supabase
          .from('call_classifications')
          .select('*')
          .eq('id', session.classification_id)
          .single();
        if (classData) {
          classification = classData;
          console.log('📊 Classification found:', classification.classification_type);
        }
      }
    }
    await supabase
      .from('call_sessions')
      .update({ call_id: callSid, call_status: 'active' })
      .eq('id', sessionId);
  }

  const baseSipUri = process.env.VAPI_SIP_ADDRESS;

  // Construct the webhook URL for recording status
  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL ||
                    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
                    'http://localhost:3000');
  const recordingStatusUrl = `${webhookBaseUrl}/api/twilio/recording-status`;
  const customHeaders = {
    'pendingcallid': pendingCallId || 'none',
    'sessionid': sessionId || 'none'
  };

  if (pendingCallData) {
    if (pendingCallData.employee_name) {
      customHeaders['employee_name'] = pendingCallData.employee_name;
    }
    if (pendingCallData.employee_dob) {
      const readableDob = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(new Date(pendingCallData.employee_dob));
      customHeaders['employee_dob'] = readableDob;
    }
    if (pendingCallData.appointment_time) {
      const readableAppt = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(new Date(pendingCallData.appointment_time));
      customHeaders['appointment_time'] = readableAppt;
    }
  }

  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

  if (classification) {
    console.log('🎯 Using cached classification:', classification.classification_type);
    customHeaders['classification'] = classification.classification_type;
    
    if (classification.classification_type === 'human') {
      console.log('👤 Human classification - direct VAPI connection');
      const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
      twiml += `<Dial record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST"><Sip>${sipUri}</Sip></Dial>`;
      
    } else if (classification.classification_type === 'ivr_only') {
      console.log('🤖 IVR classification - executing stored actions');
      if (classification.ivr_actions && classification.ivr_actions.length > 0) {
        twiml += generateIvrNavigationTwiml(classification.ivr_actions);
      }
      const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
      twiml += `<Dial record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST"><Sip>${sipUri}</Sip></Dial>`;
      
    } else if (classification.classification_type === 'ivr_then_human') {
      console.log('🤖➡️👤 IVR then human - using transfer timing');
      
      if (classification.ivr_actions && classification.ivr_actions.length > 0) {
        const transferAction = classification.ivr_actions.find(a => a.action_type === 'transfer');
        if (transferAction) {
          console.log(`📞 Will connect VAPI after ${transferAction.timing_ms}ms`);
        }
        twiml += generateIvrNavigationTwiml(classification.ivr_actions);
      } else {
        // Fallback: 15 second default pause
        console.log('📞 No transfer timing found, using 15s default');
        twiml += '<Pause length="15" />';
      }

      const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
      twiml += `<Dial record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST"><Sip>${sipUri}</Sip></Dial>`;
    }
  } else {
    console.log('❓ No classification - using dual stream approach');
    customHeaders['classification'] = 'unknown';
    const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
    twiml += `
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callSid}" />
          <Parameter name="phoneNumber" value="${phoneNumber}" />
        </Stream>
      </Start>
      <Dial record="record-from-answer-dual" recordingStatusCallback="${recordingStatusUrl}" recordingStatusCallbackMethod="POST"><Sip>${sipUri}</Sip></Dial>`;
  }

  twiml += '</Response>';
  console.log('📄 TwiML Response:', twiml);
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};
