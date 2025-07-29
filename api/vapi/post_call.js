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

    const parsed = JSON.parse(body);
    const { pendingcallid, summary, success_evaluation, structured_data } = parsed;

    if (!pendingcallid) {
      return res.status(400).json({ error: 'Missing pendingcallid' });
    }

    const updates = {};
    if (summary) updates.summary = summary;
    if (success_evaluation) updates.success_evaluation = success_evaluation;
    if (structured_data) {
      updates.structured_data = typeof structured_data === 'object'
        ? structured_data
        : JSON.parse(structured_data);
    }

    const { data, error } = await supabase
      .from('pending_calls')
      .update(updates)
      .eq('id', pendingcallid)
      .select();

    if (error) {
      console.error('❌ Error updating Supabase:', error);
      return res.status(500).json({ error: 'Database update failed' });
    }

    return res.status(200).json({ status: 'ok', updated: true, data });
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
