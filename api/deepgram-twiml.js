import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Parse x-www-form-urlencoded Twilio webhook body
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  console.log('📞 Incoming call for call_id:', callId);

  // Check or create call session
  const { data: session, error: sessionErr } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', callId)
    .single();

  let streamAlreadyStarted = false;

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

  // Get most recent unexecuted IVR action
  const { data, error } = await supabase
    .from('ivr_events')
    .select('id, action_type, action_value')
    .eq('call_id', callId)
    .eq('executed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('🎯 Next actionable IVR event:', data);

  let responseXml = `<Response>`;

  // Conditionally start stream (only once per call)
  if (!streamAlreadyStarted) {
    responseXml += `
      <Start>
        <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;
  }

  // Handle valid IVR action
  if (data && data.action_type && data.action_value) {
    responseXml += `<Stop><Stream name="mediaStream" /></Stop>`;

    if (data.action_type === 'dtmf') {
      responseXml += `<Play digits="${data.action_value}" />`;
    } else if (data.action_type === 'speech') {
      responseXml += `<Say>${data.action_value}</Say>`;
    }

    responseXml += `<Pause length="1" />`;

    // 🔁 Restart stream for additional IVR options
    responseXml += `
      <Start>
        <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app">
          <Parameter name="streamSid" value="${callId}" />
        </Stream>
      </Start>`;

    const { error: execError } = await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', data.id);

    if (execError) console.error('❌ Error marking action as executed:', execError);
  } else {
    responseXml += `<Pause length="3" />`;
  }

  // Redirect to self to poll for next action
  responseXml += `<Redirect>/api/deepgram-twiml</Redirect></Response>`;

  console.log('🧾 Responding with TwiML:', responseXml);

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(responseXml);
}

// Required by Twilio: disable default body parser
export const config = {
  api: {
    bodyParser: false
  }
};
