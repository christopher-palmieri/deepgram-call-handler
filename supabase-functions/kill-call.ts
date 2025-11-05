// Supabase Edge Function: kill-call
// Purpose: Terminate a live Twilio call by updating its status to 'completed'
// Deployed at: https://YOUR_PROJECT.supabase.co/functions/v1/kill-call

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
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')!

    if (!twilioAccountSid || !twilioAuthToken) {
      return new Response(
        JSON.stringify({ error: 'Missing Twilio credentials in environment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
    const { callSid } = await req.json()

    if (!callSid) {
      return new Response(
        JSON.stringify({ error: 'Missing callSid parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🔪 Killing call ${callSid}`)

    // Twilio API endpoint to update call status
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls/${callSid}.json`

    // Create Basic Auth header for Twilio
    const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`)

    // Make request to Twilio to terminate the call
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        Status: 'completed'
      })
    })

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text()
      console.error('Twilio API error:', errorText)

      // Handle specific Twilio errors
      if (twilioResponse.status === 404) {
        return new Response(
          JSON.stringify({ error: 'Call not found in Twilio' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ error: 'Failed to terminate call via Twilio API', details: errorText }),
        { status: twilioResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const twilioData = await twilioResponse.json()
    console.log(`✅ Successfully killed call ${callSid}. New status:`, twilioData.status)

    // Optional: Update call_sessions in database to reflect the termination
    const { data: sessionData, error: sessionError } = await supabase
      .from('call_sessions')
      .update({
        call_status: 'terminated'
      })
      .eq('call_id', callSid)
      .select('id, pending_call_id')

    if (sessionError) {
      console.warn('Could not update call_sessions:', sessionError)
    } else if (sessionData && sessionData.length > 0) {
      console.log(`Updated call_sessions for ${callSid}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Call ${callSid} terminated successfully`,
        data: {
          callSid: twilioData.sid,
          status: twilioData.status,
          duration: twilioData.duration,
          endTime: twilioData.end_time
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
