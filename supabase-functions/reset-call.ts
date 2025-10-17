// Supabase Edge Function: reset-call
// Purpose: Reset a pending_call to retry from the beginning
// Deployed at: https://YOUR_PROJECT.supabase.co/functions/v1/reset-call

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
    const { callId, keepClassification = true } = await req.json()

    if (!callId) {
      return new Response(
        JSON.stringify({ error: 'Missing callId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Resetting call ${callId} (keepClassification: ${keepClassification})`)

    // Build update object based on whether to keep classification
    const updateData: any = {
      // Clear call execution data
      call_status: 'pending',
      summary: null,
      success_evaluation: null,
      structured_data: null,

      // Reset workflow
      workflow_state: 'new',
      next_action_at: new Date().toISOString(),
      is_active: true,  // Ensure it's active

      // Clear call data
      vapi_call_id: null,

      // Clear tracking
      last_attempt_at: null,
      last_error: null,
      retry_count: 0,
      max_retries: 3,

      // Clear trigger data
      triggered: false,
      trigger_attempted_at: null,
      trigger_response: null,

      // Reset metadata
      workflow_metadata: {},

      // Update timestamp
      updated_at: new Date().toISOString()
    }

    // Optionally clear classification data
    if (!keepClassification) {
      updateData.classification_id = null
      updateData.classification_type = null
      updateData.classification_checked_at = null
      updateData.classification_lookup_at = null
    }

    // Update the call
    const { data, error } = await supabase
      .from('pending_calls')
      .update(updateData)
      .eq('id', callId)
      .select('id, workflow_state, call_status, classification_id, employee_name, clinic_name')
      .single()

    if (error) {
      console.error('Error resetting call:', error)
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'Call not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Successfully reset call ${callId}:`, data)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Call reset successfully for ${data.employee_name} - ${data.clinic_name}`,
        data: {
          id: data.id,
          workflow_state: data.workflow_state,
          call_status: data.call_status,
          classification_id: data.classification_id,
          employee_name: data.employee_name,
          clinic_name: data.clinic_name
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
