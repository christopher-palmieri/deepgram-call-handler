// api/vapi/post_call.js - Updated with proper retry handling
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const authToken = req.headers.authorization;
  if (authToken !== `Bearer ${process.env.VAPI_SECRET_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    console.log('🪵 RAW BODY:', body);
    const parsed = JSON.parse(body);

    const pendingCallId = parsed?.message?.call?.assistantOverrides?.variableValues?.pendingcallid || null;
    const sessionId = parsed?.message?.call?.assistantOverrides?.variableValues?.sessionid || null;
    const callSid = parsed?.message?.call?.twilioCallSid || parsed?.message?.call?.callSid || null;

    const summary = parsed?.message?.analysis?.summary;
    const successEvaluation = parsed?.message?.analysis?.successEvaluation;
    const structured = 
      parsed?.message?.analysis?.structuredData ||
      parsed?.message?.call?.assistantOverrides?.structuredData ||
      parsed?.message?.call?.assistantOverrides?.variableValues?.structuredData;

    // Parse structured data if it's a string
    const structuredData = typeof structured === 'object' 
      ? structured 
      : structured ? JSON.parse(structured) : null;

    if (!pendingCallId) {
      return res.status(400).json({ error: 'Missing pendingcallid' });
    }

    // Get current pending call data first
    const { data: currentCall, error: fetchError } = await supabase
      .from('pending_calls')
      .select('*')
      .eq('id', pendingCallId)
      .single();

    if (fetchError || !currentCall) {
      console.error('❌ Error fetching pending call:', fetchError);
      return res.status(404).json({ error: 'Pending call not found' });
    }
    
    // RACE CONDITION PREVENTION: Check if this was already processed
    if (currentCall.workflow_state === 'completed' || currentCall.workflow_state === 'failed') {
      console.log('✅ Call already in terminal state - skipping duplicate processing');
      return res.status(200).json({ 
        status: 'already_processed',
        workflow_state: currentCall.workflow_state
      });
    }
    
    // Check if recently updated (within 3 seconds) to prevent race with CSC webhook
    const lastUpdated = currentCall.updated_at ? new Date(currentCall.updated_at) : null;
    const recentlyUpdated = lastUpdated && (Date.now() - lastUpdated.getTime() < 3000);
    
    if (recentlyUpdated && currentCall.workflow_state === 'retry_pending') {
      console.log('⏭️ Call was just set to retry_pending - likely by CSC webhook');
      return res.status(200).json({ 
        status: 'recently_updated',
        workflow_state: currentCall.workflow_state
      });
    }

    // Determine workflow state based on success evaluation
    let workflowState;
    let nextActionAt = null;
    let retryCount = currentCall.retry_count || 0;
    
    if (successEvaluation === 'Sending Records') {
      workflowState = 'completed';
      // Reset retry count on success
      retryCount = 0;
    } else if (successEvaluation === 'No Show') {
      workflowState = 'completed';
      // Keep retry count for record
    } else if (successEvaluation === 'Unable to connect') {
      // Increment retry count
      retryCount = retryCount + 1;
      
      // CHECK MAX RETRIES
      const maxRetries = currentCall.max_retries || 3;
      
      if (retryCount >= maxRetries) {
        // MAX RETRIES EXCEEDED - MARK AS FAILED
        workflowState = 'failed';
        nextActionAt = null; // No next action for failed calls
        
        console.log(`❌ Call ${pendingCallId} failed after ${retryCount} attempts (max: ${maxRetries})`);
      } else {
        // Still have retries left
        workflowState = 'retry_pending';
        
        // Calculate exponential backoff: 5 min, 15 min, 30 min
        let retryDelayMinutes;
        if (retryCount === 1) {
          retryDelayMinutes = 5;
        } else if (retryCount === 2) {
          retryDelayMinutes = 15;
        } else {
          retryDelayMinutes = 30;
        }
        
        nextActionAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString();
        console.log(`⏰ Retry #${retryCount} scheduled in ${retryDelayMinutes} minutes`);
      }
    } else {
      console.warn('Unknown success evaluation:', successEvaluation);
      // Treat unknown as retry, but increment count
      retryCount = retryCount + 1;
      
      const maxRetries = currentCall.max_retries || 3;
      if (retryCount >= maxRetries) {
        workflowState = 'failed';
        nextActionAt = null;
      } else {
        workflowState = 'retry_pending';
        nextActionAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      }
    }

    // Create comprehensive workflow metadata
    const workflowMetadata = {
      vapi_completed_at: new Date().toISOString(),
      vapi_success_evaluation: successEvaluation,
      vapi_summary: summary,
      vapi_structured_data: structuredData,
      records_being_sent: successEvaluation === 'Sending Records',
      employee_no_show: successEvaluation === 'No Show',
      connection_failed: successEvaluation === 'Unable to connect',
      call_sid: callSid,
      session_id: sessionId,
      attempt_number: retryCount,
      is_final_attempt: workflowState === 'failed',
      failure_reason: workflowState === 'failed' ? 'max_retries_exceeded' : null
    };

    // === UPDATE PENDING_CALLS ===
    const pendingCallUpdates = {
      summary: summary,
      success_evaluation: successEvaluation,
      structured_data: structuredData,
      workflow_state: workflowState,
      next_action_at: nextActionAt,
      workflow_metadata: workflowMetadata,
      retry_count: retryCount,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Update last_error based on the outcome
    if (successEvaluation === 'Unable to connect') {
      pendingCallUpdates.last_error = `Unable to connect - Attempt ${retryCount}`;
    } else if (successEvaluation === 'Sending Records' || successEvaluation === 'No Show') {
      // Clear error on success or no-show
      pendingCallUpdates.last_error = null;
    }

    console.log('📦 Updating pending_calls:', pendingCallId);
    console.log('  Workflow state:', workflowState);
    console.log('  Retry count:', retryCount);
    console.log('  Max retries:', currentCall.max_retries || 3);
    
    const { data: pendingCallData, error: pendingCallError } = await supabase
      .from('pending_calls')
      .update(pendingCallUpdates)
      .eq('id', pendingCallId)
      .select();

    if (pendingCallError) {
      console.error('❌ Error updating pending_calls:', pendingCallError);
    } else {
      console.log('✅ Updated pending_calls');
    }

    // === UPDATE CALL_SESSIONS (existing logic) ===
    let sessionToUpdate = null;
    
    // Try to find by session ID first
    if (sessionId && sessionId !== 'none') {
      const { data: sessionByIdData } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (sessionByIdData) {
        sessionToUpdate = sessionByIdData;
        console.log('📞 Found call session by ID:', sessionId);
      }
    }
    
    // If not found by session ID, try by call SID
    if (!sessionToUpdate && callSid) {
      const { data: sessionBySidData } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('call_id', callSid)
        .single();
      
      if (sessionBySidData) {
        sessionToUpdate = sessionBySidData;
        console.log('📞 Found call session by call SID:', callSid);
      }
    }
    
    // If not found, try by pending_call_id
    if (!sessionToUpdate && pendingCallId) {
      const { data: sessionByPendingData } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('pending_call_id', pendingCallId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (sessionByPendingData) {
        sessionToUpdate = sessionByPendingData;
        console.log('📞 Found call session by pending_call_id:', pendingCallId);
      }
    }
    
    // Update the call session with VAPI results
    if (sessionToUpdate) {
      const existingMetadata = sessionToUpdate.workflow_metadata || {};
      
      const sessionMetadata = {
        ...existingMetadata,
        vapi_completed_at: new Date().toISOString(),
        vapi_success_evaluation: successEvaluation,
        vapi_summary: summary,
        vapi_structured_data: structuredData,
        records_being_sent: successEvaluation === 'Sending Records',
        employee_no_show: successEvaluation === 'No Show',
        connection_failed: successEvaluation === 'Unable to connect',
        pending_call_id: pendingCallId,
        call_outcome: successEvaluation,
        is_successful: successEvaluation === 'Sending Records',
        is_terminal: workflowState === 'completed' || workflowState === 'failed',
        needs_retry: workflowState === 'retry_pending',
        retry_count: retryCount,
        is_final_failure: workflowState === 'failed'
      };
      
      const { error: sessionUpdateError } = await supabase
        .from('call_sessions')
        .update({
          workflow_metadata: sessionMetadata,
          call_status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionToUpdate.id);
      
      if (sessionUpdateError) {
        console.error('❌ Error updating call_sessions:', sessionUpdateError);
      } else {
        console.log('✅ Updated call_sessions with VAPI results');
      }
    } else {
      console.warn('⚠️ No call session found to update with VAPI results');
      
      // Create a minimal session record if none exists
      const { error: createError } = await supabase
        .from('call_sessions')
        .insert({
          call_id: callSid || `vapi-${pendingCallId}`,
          pending_call_id: pendingCallId,
          call_status: 'completed',
          workflow_metadata: {
            vapi_completed_at: new Date().toISOString(),
            vapi_success_evaluation: successEvaluation,
            vapi_summary: summary,
            vapi_structured_data: structuredData,
            records_being_sent: successEvaluation === 'Sending Records',
            employee_no_show: successEvaluation === 'No Show',
            connection_failed: successEvaluation === 'Unable to connect',
            call_outcome: successEvaluation,
            is_successful: successEvaluation === 'Sending Records',
            created_from_post_call: true,
            retry_count: retryCount,
            is_final_failure: workflowState === 'failed'
          },
          created_at: new Date().toISOString()
        });
      
      if (!createError) {
        console.log('✅ Created new call_sessions record for VAPI results');
      }
    }

    // Log workflow state change
    const isSuccess = successEvaluation === 'Sending Records';
    const isTerminal = workflowState === 'completed' || workflowState === 'failed';
    
    if (workflowState === 'failed') {
      console.log(`❌ CALL FAILED - Max retries (${retryCount}) exceeded for pending_call ${pendingCallId}`);
    } else if (isTerminal) {
      console.log(`✅ Call COMPLETED - Status: ${successEvaluation} for pending_call ${pendingCallId}`);
    } else {
      console.log(`⏰ Call NEEDS RETRY - Attempt ${retryCount}/${currentCall.max_retries || 3} for pending_call ${pendingCallId}`);
    }
    
    // If this was a retry that succeeded, log it
    if (isSuccess && retryCount > 0) {
      console.log(`🎉 Retry successful after ${retryCount} attempts - Records being sent!`);
    }

    return res.status(200).json({ 
      status: 'ok', 
      updated: true, 
      workflow_state: workflowState,
      success: successEvaluation,
      retry_count: retryCount,
      is_final: isTerminal,
      session_updated: !!sessionToUpdate,
      data: pendingCallData 
    });
    
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};
