import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { action } = req.query;
  const authHeader = req.headers.authorization;

  try {
    switch (action) {
      case 'user':
        if (!authHeader) {
          return res.status(401).json({ error: 'No authorization header' });
        }
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error) throw error;
        return res.status(200).json({ user });

      case 'signin':
        const { email, password } = req.body;
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        return res.status(200).json(signInData);

      case 'signout':
        if (!authHeader) {
          return res.status(401).json({ error: 'No authorization header' });
        }
        const signOutToken = authHeader.replace('Bearer ', '');
        const { error: signOutError } = await supabase.auth.admin.signOut(signOutToken);
        if (signOutError) throw signOutError;
        return res.status(200).json({ success: true });

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(400).json({ error: error.message });
  }
}