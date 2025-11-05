export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const providedSecret = req.headers.get('x-vapi-shared-secret');

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing ID param' }), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  if (!providedSecret || providedSecret !== process.env.VAPI_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders(),
    });
  }

  const supabaseUrl = 'https://ixbuuvggqzscdsfkzrri.supabase.co/rest/v1/pending_calls';
  const supabaseApiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabaseRes = await fetch(`${supabaseUrl}?id=eq.${id}&select=id,employee_name,exam_id,employee_dob,client_name,appointment_time,type_of_visit,clinic_name,clinic_provider_address,clinic_scheduling_rep,procedures,employee_phone_number,employee_address`, {
  headers: {
    apikey: supabaseApiKey,
    Authorization: `Bearer ${supabaseApiKey}`,
  },
});

  const data = await supabaseRes.json();
  if (!Array.isArray(data) || data.length === 0) {
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: corsHeaders(),
    });
  }

  return new Response(JSON.stringify(data[0]), {
    status: 200,
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}
