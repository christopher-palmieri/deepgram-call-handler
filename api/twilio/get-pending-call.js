// File: /api/get-pending-call.js

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const sharedSecret = req.headers.get('x-vapi-shared-secret');

  // Secure check
  if (sharedSecret !== process.env.VAPI_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders(),
    });
  }

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id param' }), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  // Supabase fetch (edit URL and key accordingly)
  const supabaseRes = await fetch(`https://ixbuuvggqzscdsfkzrri.supabase.co/rest/v1/pending_calls?id=eq.${id}&select=id,employee_name`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
  });

  if (!supabaseRes.ok) {
    return new Response(JSON.stringify({ error: 'Supabase error' }), {
      status: 500,
      headers: corsHeaders(),
    });
  }

  const data = await supabaseRes.json();
  return new Response(JSON.stringify(data[0] || {}), {
    status: 200,
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json',
  };
}
