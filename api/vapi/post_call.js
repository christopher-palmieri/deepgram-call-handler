// api/vapi/post_call.js - Updated with workflow state management
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

    const id = parsed?.message?.call?.assistantOverrides?.variableValues?.pendingcallid || null;

    const summary = parsed?.message?.analysis?.summary;
    const successEvaluation = parsed?.message?.analysis?.successEvaluation;
    const structured =
      parsed?.message?.analysis?.structuredData ||
      parsed?.message?.call?.assistantOverrides?.structuredData ||
      parsed?.message?.call?.assistantOverrides?.variableValues?.structuredData;

    if (!id) {
      return res.status(400).json({ error: 'Missing pendingcallid' });
    }

    // Build the updates object
    const updates = {};
    if (summary) updates.summary = summary;
    if (successEvaluation !== undefined) updates.success_evaluation = successEvaluation;
    if (structured) {
      updates.structured_data = typeof structured === 'object'
        ? structured
        : JSON.parse(structured);
    }

    // NEW: Update workflow state based on your specific success evaluation values
    // Success values: "Sending Records"
    // Retry values: "Unable to connect"
    // Complete but unsuccessful: "No Show"
    
    let workflowState;
    let nextActionAt = null;
    
    if (successEvaluation === 'Sending Records') {
      // Successful - clinic is sending records
      workflowState = 'completed';
    } else if (successEvaluation === 'No Show') {
      // Call completed but employee didn't show - no retry needed
      workflowState = 'completed';
    } else if (successEvaluation === 'Unable to connect') {
      // Failed to reach anyone - retry later
      workflowState = 'retry_pending';
      nextActionAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min retry
    } else {
      // Unknown status - log it but mark as retry
      console.warn('Unknown success evaluation:', successEvaluation);
      workflowState = 'retry_pending';
      nextActionAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }

    // Add workflow metadata
    const workflowMetadata = {
      vapi_completed_at: new Date().toISOString(),
      vapi_success_evaluation: successEvaluation,
      vapi_summary: summary,
      records_being_sent: successEvaluation === 'Sending Records',
      employee_no_show: successEvaluation === 'No Show',
      connection_failed: successEvaluation === 'Unable to connect'
    };

    // Combine all updates
    updates.workflow_state = workflowState;
    updates.next_action_at = nextActionAt;
    updates.workflow_metadata = workflowMetadata;
    
    // Clear error if successful or no-show (both are terminal states)
    if (successEvaluation === 'Sending Records' || successEvaluation === 'No Show') {
      updates.last_error = null;
      updates.retry_count = 0;
    }

    console.log('🔍 ID used:', id);
    console.log('📦 Update payload:', updates);

    const { data, error, status, statusText } = await supabase
      .from('pending_calls')
      .update(updates)
      .eq('id', id)
      .select();

    console.log('📊 Supabase result:', { status, statusText, data, error });

    if (error) {
      console.error('❌ Error updating Supabase:', error);
      return res.status(500).json({ error: 'Database update failed' });
    }

    // Log workflow state change
    const isSuccess = successEvaluation === 'Sending Records';
    const isTerminal = successEvaluation === 'Sending Records' || successEvaluation === 'No Show';
    
    console.log(`✅ Call ${isTerminal ? 'COMPLETED' : 'NEEDS RETRY'} - Status: ${successEvaluation} for pending_call ${id}`);
    
    // If this was a retry that succeeded, log it
    if (isSuccess && data?.[0]?.retry_count > 0) {
      console.log(`🎉 Retry successful after ${data[0].retry_count} attempts - Records being sent!`);
    }

    return res.status(200).json({ 
      status: 'ok', 
      updated: true, 
      workflow_state: workflowState,
      success: successEvaluation,
      data 
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
