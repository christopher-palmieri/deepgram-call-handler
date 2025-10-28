export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const config = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
  };

  res.status(200).json(config);
}
