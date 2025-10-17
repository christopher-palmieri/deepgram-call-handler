// Edge function to save or update call classifications
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    // Create Supabase client with user's auth token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Verify the user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body = await req.json()
    const {
      phone_number,
      clinic_name,
      classification_type,
      classification_confidence,
      ivr_actions,
      classification_id
    } = body

    // Validate required fields
    if (!phone_number) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!classification_type || !['human', 'ivr_only', 'ivr_then_human'].includes(classification_type)) {
      return new Response(
        JSON.stringify({ error: 'Valid classification type is required (human, ivr_only, ivr_then_human)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate IVR actions if classification type requires them
    if ((classification_type === 'ivr_only' || classification_type === 'ivr_then_human') && (!ivr_actions || ivr_actions.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'IVR actions are required for ivr_only and ivr_then_human classifications' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use service role client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

    const now = new Date().toISOString()
    const classificationData: any = {
      phone_number,
      clinic_name: clinic_name || null,
      classification_type,
      classification_confidence: classification_confidence || 0.95,
      ivr_actions: ivr_actions || null,
      classification_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      is_active: true,
      updated_at: now,
    }

    let result

    if (classification_id) {
      // Update existing classification
      const { data, error } = await supabaseAdmin
        .from('call_classifications')
        .update(classificationData)
        .eq('id', classification_id)
        .select()
        .single()

      if (error) throw error
      result = data

      console.log(`Updated classification ${classification_id} for ${phone_number}`)
    } else {
      // Create new classification
      classificationData.created_at = now
      classificationData.last_verified_at = now
      classificationData.verification_count = 1

      const { data, error } = await supabaseAdmin
        .from('call_classifications')
        .insert(classificationData)
        .select()
        .single()

      if (error) throw error
      result = data

      console.log(`Created new classification for ${phone_number}`)

      // Update any pending calls with this phone number to use the new classification
      const { error: updateError } = await supabaseAdmin
        .from('pending_calls')
        .update({
          classification_id: result.id,
          classification_type: classification_type,
          classification_lookup_at: now,
          updated_at: now
        })
        .eq('phone', phone_number)
        .is('classification_id', null)

      if (updateError) {
        console.error('Error updating pending calls:', updateError)
      } else {
        console.log(`Updated pending calls with phone ${phone_number} to use new classification`)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: classification_id ? 'Classification updated successfully' : 'Classification created successfully',
        data: result
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in save-classification function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
