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
    const message = parsed?.message;
    
    // ✅ FIXED: pendingcallid is in call.assistantOverrides.variableValues
    const pendingCallId = message?.call?.assistantOverrides?.variableValues?.pendingcallid;
    
    // Also check if it might be in the top-level assistantOverrides (for different message types)
    const alternativeId = message?.assistantOverrides?.variableValues?.pendingcallid;
    
    // Use whichever one exists
    const id = pendingCallId || alternativeId;
    
    // Extract analysis data
    const summary = message?.analysis?.summary;
    const successEvaluation = message?.analysis?.successEvaluation;
    const structured = message?.analysis?.structuredData;
    
    console.log('🔍 Looking for pendingcallid in:');
    console.log('  - call.assistantOverrides.variableValues:', pendingCallId);
    console.log('  - assistantOverrides.variableValues:', alternativeId);
    console.log('  - Final ID:', id);
    
    if (!id) {
      console.error('❌ Missing pendingcallid. Full message structure:', JSON.stringify(message, null, 2));
      return res.status(400).json({ 
        error: 'Missing pendingcallid',
        hint: 'Check console logs for message structure',
        messageType: message?.type 
      });
    }
    
    const updates = {};
    
    if (summary) updates.summary = summary;
    if (successEvaluation) updates.success_evaluation = successEvaluation;
    if (structured) {
      updates.structured_data = typeof structured === 'object'
        ? structured
        : JSON.parse(structured);
    }
    
    // Add more fields from the call data if needed
    if (message?.cost) updates.cost = message.cost;
    if (message?.durationSeconds) updates.duration_seconds = message.durationSeconds;
    if (message?.transcript) updates.transcript = message.transcript;
    if (message?.endedReason) updates.ended_reason = message.endedReason;
    
    console.log('📦 Update payload:', updates);
    
    const { data, error, status, statusText } = await supabase
      .from('pending_calls')
      .update(updates)
      .eq('id', id)
      .select();
    
    console.log('📊 Supabase result:', { status, statusText, data, error });
    
    if (error) {
      console.error('❌ Error updating Supabase:', error);
      return res.status(500).json({ error: 'Database update failed', details: error });
    }
    
    return res.status(200).json({ 
      status: 'ok', 
      updated: true, 
      data,
      messageType: message?.type,
      callId: message?.call?.id
    });
    
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};
