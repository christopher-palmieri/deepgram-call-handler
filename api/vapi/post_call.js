// api/vapi/post_call.js - Updated with call_sessions logging
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

    // Determine workflow state based on success evaluation
    let workflowState;
    let nextActionAt = null;
    
    if (successEvaluation === 'Sending Records') {
      workflowState = 'completed';
    } else if (successEvaluation === 'No Show') {
      workflowState = 'completed';
    } else if (successEvaluation === 'Unable to connect') {
      workflowState = 'retry_pending';
      nextActionAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min retry
    } else {
      console.warn('Unknown success evaluation:', successEvaluation);
      workflowState = 'retry_pending';
      nextActionAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
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
      session_id: sessionId
    };

    // === UPDATE PENDING_CALLS (existing logic) ===
    const pendingCallUpdates = {
      summary: summary,
      success_evaluation: successEvaluation,
      structured_data: structuredData,
      workflow_state: workflowState,
      next_action_at: nextActionAt,
      workflow_metadata: workflowMetadata
    };
    
    // Clear error if successful or no-show
    if (successEvaluation === 'Sending Records' || successEvaluation === 'No Show') {
      pendingCallUpdates.last_error = null;
      pendingCallUpdates.retry_count = 0;
    }

    console.log('📦 Updating pending_calls:', pendingCallId);
    
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

    // === NEW: UPDATE CALL_SESSIONS ===
    // Find the call session for this call
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
      // Merge with existing workflow_metadata if it exists
      const existingMetadata = sessionToUpdate.workflow_metadata || {};
      
      const sessionMetadata = {
        ...existingMetadata,  // Preserve existing metadata (like classification info)
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
        is_terminal: successEvaluation === 'Sending Records' || successEvaluation === 'No Show',
        needs_retry: successEvaluation === 'Unable to connect'
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
      
      // Optionally create a minimal session record if none exists
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
            created_from_post_call: true
          },
          created_at: new Date().toISOString()
        });
      
      if (!createError) {
        console.log('✅ Created new call_sessions record for VAPI results');
      }
    }

    // Log workflow state change
    const isSuccess = successEvaluation === 'Sending Records';
    const isTerminal = successEvaluation === 'Sending Records' || successEvaluation === 'No Show';
    
    console.log(`✅ Call ${isTerminal ? 'COMPLETED' : 'NEEDS RETRY'} - Status: ${successEvaluation} for pending_call ${pendingCallId}`);
    
    // If this was a retry that succeeded, log it
    if (isSuccess && pendingCallData?.[0]?.retry_count > 0) {
      console.log(`🎉 Retry successful after ${pendingCallData[0].retry_count} attempts - Records being sent!`);
    }

    return res.status(200).json({ 
      status: 'ok', 
      updated: true, 
      workflow_state: workflowState,
      success: successEvaluation,
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
