// Supabase Edge Function: delete-call
// Purpose: Delete a pending_call record permanently
// Deployed at: https://YOUR_PROJECT.supabase.co/functions/v1/delete-call

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the user is authenticated
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { callId } = await req.json()

    if (!callId) {
      return new Response(
        JSON.stringify({ error: 'Missing callId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Deleting call ${callId}`)

    // First, get the call details before deleting
    const { data: callData, error: fetchError } = await supabase
      .from('pending_calls')
      .select('id, employee_name, clinic_name, workflow_state')
      .eq('id', callId)
      .single()

    if (fetchError || !callData) {
      console.error('Error fetching call:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Call not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete the call
    const { error: deleteError } = await supabase
      .from('pending_calls')
      .delete()
      .eq('id', callId)

    if (deleteError) {
      console.error('Error deleting call:', deleteError)
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Successfully deleted call ${callId}:`, callData)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Call deleted successfully for ${callData.employee_name} - ${callData.clinic_name}`,
        data: {
          id: callData.id,
          employee_name: callData.employee_name,
          clinic_name: callData.clinic_name,
          workflow_state: callData.workflow_state
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
