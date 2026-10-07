import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const googleClientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
    const googleRedirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')

    if (!googleClientId || !googleRedirectUri) {
      throw new Error('Google OAuth not configured')
    }

    // Use service role key to verify professional exists
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Get professional ID from request body
    let professionalId: string | null = null

    try {
      const body = await req.json()
      professionalId = body.professionalId || null
    } catch {
      // No body or invalid JSON
    }

    if (!professionalId) {
      return new Response(
        JSON.stringify({ error: 'Professional ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the professional exists
    const { data: professional, error: profError } = await supabaseAdmin
      .from('professionals')
      .select('id')
      .eq('id', professionalId)
      .single()

    if (profError || !professional) {
      return new Response(
        JSON.stringify({ error: 'Professional not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate state parameter for CSRF protection
    // Contains: professionalId, nonce, timestamp
    const statePayload = {
      professionalId: professional.id,
      nonce: crypto.randomUUID(),
      timestamp: Date.now(),
    }
    const state = btoa(JSON.stringify(statePayload))

    // Build Google OAuth authorization URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', googleClientId)
    authUrl.searchParams.set('redirect_uri', googleRedirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly email profile')
    authUrl.searchParams.set('access_type', 'offline') // Required for refresh token
    authUrl.searchParams.set('prompt', 'consent') // Force consent to ensure refresh token
    authUrl.searchParams.set('state', state)

    return new Response(
      JSON.stringify({
        authUrl: authUrl.toString(),
        state,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating auth URL:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
