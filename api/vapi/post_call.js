import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authToken = req.headers.authorization;
    if (authToken !== `Bearer ${process.env.VAPI_SECRET_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = await req.json();

    const {
      pendingcallid,
      successEvaluation,
      summary
    } = body;

    if (!pendingcallid) {
      return res.status(400).json({ error: 'Missing pendingcallid' });
    }

    const { error } = await supabase
      .from('pending_calls')
      .update({
        call_success: successEvaluation ?? null,
        call_summary: summary ?? null
      })
      .eq('id', pendingcallid);

    if (error) {
      console.error('❌ Error updating pending_calls:', error);
      return res.status(500).json({ error: 'Failed to update record' });
    }

    console.log(`✅ Call record updated for pendingcallid ${pendingcallid}`);
    return res.status(200).json({ message: 'Call data saved' });
  } catch (err) {
    console.error('❌ Unexpected error in post_call handler:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};
