// Supabase Edge Function: unarchive-call
// Purpose: Unarchive a pending_call by setting is_active to true
// Deployed at: https://YOUR_PROJECT.supabase.co/functions/v1/unarchive-call
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Missing authorization header'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Verify the user is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Parse request body
    const { callId } = await req.json();
    if (!callId) {
      return new Response(JSON.stringify({
        error: 'Missing callId parameter'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Unarchiving call ${callId}`);
    // Update the call to set is_active to true
    const { data, error } = await supabase.from('pending_calls').update({
      is_active: true,
      updated_at: new Date().toISOString()
    }).eq('id', callId).select('id, employee_name, clinic_name, workflow_state, is_active').single();
    if (error) {
      console.error('Error unarchiving call:', error);
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!data) {
      return new Response(JSON.stringify({
        error: 'Call not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Successfully unarchived call ${callId}:`, data);
    return new Response(JSON.stringify({
      success: true,
      message: `Call unarchived successfully for ${data.employee_name} - ${data.clinic_name}`,
      data: {
        id: data.id,
        employee_name: data.employee_name,
        clinic_name: data.clinic_name,
        workflow_state: data.workflow_state,
        is_active: data.is_active
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
