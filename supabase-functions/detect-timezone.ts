// Supabase Edge Function: detect-timezone
// Purpose: Detect timezone from clinic address using Google Maps Geocoding + Time Zone APIs
// Deployed at: https://YOUR_PROJECT.supabase.co/functions/v1/detect-timezone

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

    // Get Google Maps API key from environment
    const googleMapsApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!googleMapsApiKey) {
      return new Response(
        JSON.stringify({ error: 'Google Maps API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
    const body = await req.json()
    const { address, addresses } = body

    // Support single address or batch
    const addressList = addresses || (address ? [address] : [])

    if (addressList.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing address or addresses parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing ${addressList.length} addresses`)

    // Process addresses
    const results = []

    for (const addr of addressList) {
      try {
        if (!addr || addr.trim() === '') {
          results.push({
            address: addr,
            timezone: null,
            error: 'Empty address'
          })
          continue
        }

        console.log(`Geocoding address: ${addr}`)

        // Step 1: Geocode address to get coordinates
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${googleMapsApiKey}`
        const geocodeResponse = await fetch(geocodeUrl)
        const geocodeData = await geocodeResponse.json()

        if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
          console.error(`Geocoding failed for ${addr}:`, geocodeData.status)
          results.push({
            address: addr,
            timezone: null,
            error: `Geocoding failed: ${geocodeData.status}`
          })
          continue
        }

        const location = geocodeData.results[0].geometry.location
        const lat = location.lat
        const lng = location.lng

        console.log(`Coordinates for ${addr}: ${lat}, ${lng}`)

        // Step 2: Get timezone from coordinates
        const timestamp = Math.floor(Date.now() / 1000) // Current Unix timestamp
        const timezoneUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${googleMapsApiKey}`
        const timezoneResponse = await fetch(timezoneUrl)
        const timezoneData = await timezoneResponse.json()

        if (timezoneData.status !== 'OK') {
          console.error(`Timezone lookup failed for ${addr}:`, timezoneData.status)
          results.push({
            address: addr,
            timezone: null,
            error: `Timezone lookup failed: ${timezoneData.status}`
          })
          continue
        }

        const timezone = timezoneData.timeZoneId // e.g., "America/New_York"

        console.log(`Timezone for ${addr}: ${timezone}`)

        results.push({
          address: addr,
          timezone: timezone,
          lat: lat,
          lng: lng,
          error: null
        })

      } catch (error) {
        console.error(`Error processing address ${addr}:`, error)
        results.push({
          address: addr,
          timezone: null,
          error: error.message
        })
      }
    }

    // Return results
    return new Response(
      JSON.stringify({
        success: true,
        results: results,
        summary: {
          total: addressList.length,
          successful: results.filter(r => r.timezone !== null).length,
          failed: results.filter(r => r.timezone === null).length
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
