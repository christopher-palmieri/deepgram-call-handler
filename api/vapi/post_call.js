import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await req.json();

  const {
    pendingcallid,
    evaluation,
    summary,
    structuredData,
    vapiCallId
  } = body;

  // Log for debugging
  console.log('📨 Post-call payload received:', body);

  if (!pendingcallid) {
    return res.status(400).json({ error: 'Missing pendingcallid' });
  }

  // Update the pending_calls record with new data
  const { error } = await supabase
    .from('pending_calls')
    .update({
      call_status: 'completed',
      trigger_response: {
        evaluation,
        summary,
        structuredData,
        vapiCallId
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', pendingcallid);

  if (error) {
    console.error('❌ Failed to update Supabase:', error);
    return res.status(500).json({ error: 'Database update failed' });
  }

  return res.status(200).json({ message: 'Call outcome recorded' });
}
