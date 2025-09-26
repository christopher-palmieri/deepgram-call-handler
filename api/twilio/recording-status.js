// api/twilio/recording-status.js
// This webhook handles recording status updates from Twilio
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

  // Extract recording information
  const recordingSid = parsed.RecordingSid;
  const recordingUrl = parsed.RecordingUrl;
  const recordingStatus = parsed.RecordingStatus;
  const recordingDuration = parsed.RecordingDuration;
  const callSid = parsed.CallSid;

  console.log('🎙️ Recording Status Update:', {
    recordingSid,
    callSid,
    status: recordingStatus,
    duration: recordingDuration + 's',
    url: recordingUrl
  });

  try {
    // Find the call session
    const { data: session, error: sessionError } = await supabase
      .from('call_sessions')
      .select('*, pending_calls!inner(*)')
      .eq('call_id', callSid)
      .single();

    if (sessionError || !session) {
      console.log('❌ No session found for call:', callSid);
      return res.status(200).send('');
    }

    const pendingCall = session.pending_calls;

    // Update call_sessions with recording information
    const { error: updateError } = await supabase
      .from('call_sessions')
      .update({
        recording_url: recordingUrl,
        workflow_metadata: {
          ...session.workflow_metadata,
          recording: {
            sid: recordingSid,
            url: recordingUrl,
            status: recordingStatus,
            duration: recordingDuration,
            updated_at: new Date().toISOString()
          }
        },
        updated_at: new Date().toISOString()
      })
      .eq('call_id', callSid);

    if (updateError) {
      console.error('❌ Error updating session with recording:', updateError);
    } else {
      console.log('✅ Recording information saved for call:', callSid);

      // Also update pending_calls with recording URL for easy access
      await supabase
        .from('pending_calls')
        .update({
          workflow_metadata: {
            ...pendingCall.workflow_metadata,
            recording_url: recordingUrl,
            recording_sid: recordingSid,
            recording_duration: recordingDuration
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', pendingCall.id);
    }

  } catch (err) {
    console.error('❌ Error processing recording status:', err);
  }

  res.status(200).send('');
}

export const config = {
  api: {
    bodyParser: false
  }
};