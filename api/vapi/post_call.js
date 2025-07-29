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

    // HARDCODE the pendingcallid for now to verify downstream logic
    const id = '0e9f4fc4-619a-40c2-b40a-05e8da6dbe8c';

    const summary = parsed.summary;
    const successEvaluation = parsed.successEvaluation;
    const structured =
      parsed?.structuredData ||
      parsed?.assistantOverrides?.structuredData ||
      parsed?.variableValues?.structuredData;

    if (!id) {
      return res.status(400).json({ error: 'Missing pendingcallid' });
    }

    const updates = {};
    if (summary) updates.summary = summary;
    if (successEvaluation) updates.success_evaluation = successEvaluation;
    if (structured) {
      updates.structured_data = typeof structured === 'object'
        ? structured
        : JSON.parse(structured);
    }

    const { data, error } = await supabase
      .from('pending_calls')
      .update(updates)
      .eq('id', id)
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
