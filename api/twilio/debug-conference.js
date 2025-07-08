// /api/twilio/debug-conference.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { conference_id, call_sid } = req.query;
  
  let query = supabase.from('call_sessions').select('*');
  
  if (conference_id) {
    query = query.eq('conference_id', conference_id);
  }
  
  if (call_sid) {
    query = query.or(`call_id.eq.${call_sid},vapi_participant_sid.eq.${call_sid}`);
  }
  
  const { data, error } = await query;
  
  return res.status(200).json({
    query_params: { conference_id, call_sid },
    sessions_found: data?.length || 0,
    sessions: data,
    error: error
  });
}
