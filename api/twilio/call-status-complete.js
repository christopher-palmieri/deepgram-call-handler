// api/twilio/call-status-complete.js
// Updated to skip retry increment for successful classification calls
import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Debug logging
  console.log('🔍 Request method:', req.method);
  console.log('🔍 Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('🔍 Request URL:', req.url);

  // Read body using event listeners (same pattern as post_call.js)
  const body = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      console.log('📥 Received chunk:', chunk.length, 'bytes');
      data += chunk;
    });
    req.on('end', () => {
      console.log('✅ Body reading complete. Total length:', data.length);
      resolve(data);
    });
    req.on('error', err => {
      console.error('❌ Body reading error:', err);
      reject(err);
    });
  });

  console.log('📦 RAW BODY:', body);
  console.log('📦 BODY LENGTH:', body.length);
  const parsed = querystring.parse(body);

  const callSid = parsed.CallSid;
  const callStatus = parsed.CallStatus;
  const callDuration = parsed.CallDuration || '0';
  const timestamp = parsed.Timestamp;

  console.log('📞 Call Status Update:', {
    callSid,
    callStatus,
    duration: callDuration + 's',
    timestamp
  });
  
  // Only process completed, failed, busy, no-answer, or canceled calls
  if (!['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
    return res.status(200).send('');
  }
  
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
    
    // Check if this call was already processed by VAPI
    if (pendingCall.workflow_state === 'completed' || 
        pendingCall.workflow_state === 'failed') {
      console.log('✅ Call already processed by VAPI');
      return res.status(200).send('');
    }
    
    // ===== NEW LOGIC: CHECK IF THIS WAS A SUCCESSFUL CLASSIFICATION CALL =====
    const isClassificationCall = 
      pendingCall.workflow_state === 'classification_pending' ||
      pendingCall.workflow_state === 'classifying' ||
      session.workflow_metadata?.is_classification_call === true;
      
    const classificationSuccessful = 
      pendingCall.workflow_metadata?.classification_successful === true ||
      session.workflow_metadata?.classification_stored_at != null;
    
    if (isClassificationCall && classificationSuccessful) {
      console.log('✅ Successful classification call detected - SKIPPING retry increment');
      console.log(`   Classification type: ${pendingCall.workflow_metadata?.classification_type || session.ivr_detection_state}`);
      console.log(`   Workflow state: ${pendingCall.workflow_state}`);
      console.log(`   Call duration: ${callDuration}s`);

      // Update call_sessions for audit trail AND mark as completed
      await supabase
        .from('call_sessions')
        .update({
          call_status: 'completed',
          workflow_metadata: {
            ...session.workflow_metadata,
            twilio_final_status: callStatus,
            call_duration_seconds: parseInt(callDuration),
            classification_call_completed: true,
            processed_by: 'twilio_status_webhook',
            retry_increment_skipped: true,
            skip_reason: 'successful_classification'
          },
          updated_at: new Date().toISOString()
        })
        .eq('call_id', callSid);

      console.log('✅ Updated call_sessions to completed (classification successful)');
      return res.status(200).send('');
    }
    // ===== END NEW LOGIC =====
    
    // Determine if this was a failed/incomplete call
    const callDurationInt = parseInt(callDuration);
    const isQuickHangup = callDurationInt < 5; // Less than 5 seconds
    const isDisconnect = ['failed', 'busy', 'no-answer', 'canceled'].includes(callStatus);
    const isIncomplete = callStatus === 'completed' && callDurationInt < 30; // Connected but ended too quickly
    
    // Check if VAPI has processed this call
    const vapiProcessed = pendingCall.summary || pendingCall.success_evaluation;
    
    // Additional safety: Check if retry was already incremented very recently (within 5 seconds)
    const lastAttemptAt = pendingCall.last_attempt_at ? new Date(pendingCall.last_attempt_at) : null;
    const recentlyUpdated = lastAttemptAt && (Date.now() - lastAttemptAt.getTime() < 5000);
    
    if (recentlyUpdated) {
      console.log('⏭️ Call was just updated - skipping to avoid race condition');
      return res.status(200).send('');
    }
    
    if (!vapiProcessed && (isQuickHangup || isDisconnect || isIncomplete)) {
      console.log(`⚠️ Detected incomplete call: ${callStatus}, duration: ${callDuration}s`);
      
      // Increment retry count
      const newRetryCount = (pendingCall.retry_count || 0) + 1;
      const maxRetries = pendingCall.max_retries || 3;
      
      // Determine error message
      let errorMessage = '';
      if (isQuickHangup) {
        errorMessage = `Call ended immediately (${callDuration}s) - possible quick hangup`;
      } else if (isDisconnect) {
        errorMessage = `Call ${callStatus} - unable to connect`;
      } else if (isIncomplete) {
        errorMessage = `Call ended after ${callDuration}s without agent interaction`;
      }
      
      // Check if max retries exceeded
      if (newRetryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) exceeded - marking as FAILED`);
        
        await supabase
          .from('pending_calls')
          .update({
            workflow_state: 'failed',
            retry_count: newRetryCount,
            last_error: errorMessage,
            last_attempt_at: new Date().toISOString(),
            workflow_metadata: {
              ...pendingCall.workflow_metadata,
              failed_at: new Date().toISOString(),
              failure_reason: 'max_retries_exceeded_after_disconnect',
              final_error: errorMessage,
              total_attempts: newRetryCount,
              final_call_status: callStatus,
              final_call_duration: callDuration
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', pendingCall.id);
          
      } else {
        // Schedule retry
        const retryDelayMinutes = newRetryCount === 1 ? 5 : newRetryCount === 2 ? 15 : 30;
        const nextActionAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000);
        
        console.log(`⏰ Scheduling retry #${newRetryCount} in ${retryDelayMinutes} minutes`);
        
        await supabase
          .from('pending_calls')
          .update({
            workflow_state: 'retry_pending',
            retry_count: newRetryCount,
            last_error: errorMessage,
            last_attempt_at: new Date().toISOString(),
            next_action_at: nextActionAt.toISOString(),
            workflow_metadata: {
              ...pendingCall.workflow_metadata,
              last_call_status: callStatus,
              last_call_duration: callDuration,
              disconnect_detected_at: new Date().toISOString(),
              retry_scheduled_for: nextActionAt.toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', pendingCall.id);
      }
      
      // Update call_sessions for audit trail
      await supabase
        .from('call_sessions')
        .update({
          call_status: callStatus,
          workflow_metadata: {
            ...session.workflow_metadata,
            twilio_final_status: callStatus,
            call_duration_seconds: callDurationInt,
            incomplete_call_detected: true,
            detection_reason: isQuickHangup ? 'quick_hangup' : 
                            isDisconnect ? 'connection_failed' : 
                            'incomplete_interaction',
            retry_count_after: newRetryCount,
            processed_by: 'twilio_status_webhook'
          },
          updated_at: new Date().toISOString()
        })
        .eq('call_id', callSid);
        
      console.log(`✅ Processed incomplete call - retry count: ${newRetryCount}/${maxRetries}`);
    }
    
  } catch (err) {
    console.error('❌ Error processing call status:', err);
  }
  
  res.status(200).send('');
}

export const config = {
  api: {
    bodyParser: false
  }
};
