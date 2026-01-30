import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Convert Uint8Array to hex string for BYTEA storage
function bytesToHex(bytes: Uint8Array): string {
  return '\\x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// AES-256-GCM encryption for OAuth tokens
// Returns hex string ready for PostgreSQL BYTEA storage
async function encryptToken(token: string, keyBase64: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(token)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + encrypted.byteLength)
  result.set(iv)
  result.set(new Uint8Array(encrypted), iv.length)

  // Return as hex string for BYTEA storage
  return bytesToHex(result)
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code, state } = await req.json()

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: 'Missing code or state parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Decode and validate state parameter
    let statePayload: { professionalId: string; nonce: string; timestamp: number }
    try {
      // Log raw state for debugging
      console.log('Raw state received:', state)
      console.log('State length:', state?.length)

      // Try decoding - TanStack Router should have already URL-decoded the params
      // but we'll try both just in case
      let base64State = state

      // If it still looks URL-encoded, decode it
      if (state.includes('%')) {
        base64State = decodeURIComponent(state)
        console.log('After URL decode:', base64State)
      }

      // Decode base64
      const jsonStr = atob(base64State)
      console.log('After base64 decode:', jsonStr)

      statePayload = JSON.parse(jsonStr)
      console.log('Parsed state payload:', statePayload)
    } catch (e) {
      console.error('Failed to decode state. Error:', e.message)
      console.error('Raw state was:', state)
      return new Response(
        JSON.stringify({ error: `State decode failed: ${e.message}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check state timestamp (5 minute expiry for CSRF protection)
    const stateAge = Date.now() - statePayload.timestamp
    if (stateAge > 5 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: 'State expired. Please try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get environment variables
    const googleClientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!
    const googleClientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!
    const googleRedirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')!
    const tokenEncryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token exchange failed:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to exchange authorization code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const tokens = await tokenResponse.json()

    if (!tokens.access_token || !tokens.refresh_token) {
      return new Response(
        JSON.stringify({ error: 'Missing tokens in response. Please try connecting again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userInfoResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch Google account info' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userInfo = await userInfoResponse.json()

    // Encrypt tokens
    const accessTokenEncrypted = await encryptToken(tokens.access_token, tokenEncryptionKey)
    const refreshTokenEncrypted = await encryptToken(tokens.refresh_token, tokenEncryptionKey)

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    // Store connection in database using service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Upsert connection (replace existing if any - one calendar per professional)
    const { data: connection, error: dbError } = await supabaseAdmin
      .from('professional_calendar_connections')
      .upsert(
        {
          professional_id: statePayload.professionalId,
          provider: 'google',
          provider_email: userInfo.email,
          provider_account_id: userInfo.id,
          calendar_id: 'primary',
          access_token_encrypted: accessTokenEncrypted,
          refresh_token_encrypted: refreshTokenEncrypted,
          token_expires_at: expiresAt.toISOString(),
          scopes: (tokens.scope || '').split(' '),
          status: 'active',
          last_error: null,
          error_count: 0,
        },
        {
          onConflict: 'professional_id',
        }
      )
      .select('id')
      .single()

    if (dbError) {
      console.error('Database error:', dbError)
      return new Response(
        JSON.stringify({ error: 'Failed to store calendar connection' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log audit event
    await supabaseAdmin.from('professional_audit_log').insert({
      professional_id: statePayload.professionalId,
      action: 'calendar_connected',
      new_value: {
        provider: 'google',
        email: userInfo.email,
        connection_id: connection.id,
      },
    })

    return new Response(
      JSON.stringify({
        success: true,
        provider: 'google',
        email: userInfo.email,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Callback error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
