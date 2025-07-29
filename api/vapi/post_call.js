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
    const { pendingcallid, summary, evaluation, structured_data } = req.body;

    if (!pendingcallid) {
      return res.status(400).json({ error: 'Missing pendingcallid' });
    }

    const updates = {
      updated_at: new Date().toISOString()
    };

    if (summary !== undefined) updates.summary = summary;
    if (evaluation !== undefined) updates.evaluation = evaluation;
    if (structured_data !== undefined) updates.structured_data = structured_data;

    const { data, error } = await supabase
      .from('pending_calls')
      .update(updates)
      .eq('id', pendingcallid)
      .select();

    if (error) {
      console.error('❌ Supabase update error:', error);
      return res.status(500).json({ error: 'Failed to update pending call' });
    }

    return res.status(200).json({ status: 'ok', updated: true, data });
  } catch (err) {
    console.error('❌ Handler error:', err);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
