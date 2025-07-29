import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const authToken = req.headers.authorization;
  if (authToken !== `Bearer ${process.env.VAPI_SECRET_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { pendingcallid, summary, success } = req.body;

    if (!pendingcallid || summary === undefined || success === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('pending_calls')
      .update({
        call_status: success ? 'completed' : 'failed',
        trigger_response: {
          summary,
          success
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', pendingcallid)
      .select();

    if (error) {
      console.error('❌ Supabase update error:', error);
      return res.status(500).json({ error: 'Failed to update pending call' });
    }

    console.log('✅ Post-call update successful:', data);
    return res.status(200).json({ status: 'ok', updated: true, data });
  } catch (err) {
    console.error('❌ Handler error:', err);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
