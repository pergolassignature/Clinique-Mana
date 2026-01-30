import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decode as decodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Convert hex string (like \x...) to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  // Remove \x prefix if present
  const cleanHex = hex.startsWith('\\x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16)
  }
  return bytes
}

// AES-256-GCM decryption for OAuth tokens
// Note: Supabase returns BYTEA in different formats depending on context
async function decryptToken(encryptedData: string | Uint8Array, keyBase64: string): Promise<string> {
  console.log('Decrypting token, data type:', typeof encryptedData)
  console.log('Data preview:', typeof encryptedData === 'string' ? encryptedData.substring(0, 50) : 'Uint8Array')

  let encrypted: Uint8Array

  if (typeof encryptedData === 'string') {
    // Supabase returns BYTEA as hex string with \x prefix
    if (encryptedData.startsWith('\\x')) {
      console.log('Decoding from hex format')
      encrypted = hexToBytes(encryptedData)
    } else {
      // Try base64
      console.log('Trying base64 decode')
      try {
        encrypted = decodeBase64(encryptedData)
      } catch {
        // Maybe it's plain hex without \x prefix
        console.log('Base64 failed, trying plain hex')
        encrypted = hexToBytes(encryptedData)
      }
    }
  } else {
    encrypted = encryptedData
  }

  console.log('Encrypted data length:', encrypted.length)

  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )

  const iv = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)
  console.log('IV length:', iv.length, 'Ciphertext length:', ciphertext.length)

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
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

  const result = new Uint8Array(iv.length + encrypted.byteLength)
  result.set(iv)
  result.set(new Uint8Array(encrypted), iv.length)

  // Return as hex string for BYTEA storage
  return bytesToHex(result)
}

// Refresh access token using refresh token
async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token refresh failed: ${errorText}`)
  }

  const data = await response.json()
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { professionalId } = await req.json()

    if (!professionalId) {
      return new Response(
        JSON.stringify({ error: 'Missing professionalId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const tokenEncryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!
    const googleClientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!
    const googleClientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Get the calendar connection
    const { data: connection, error: connError } = await supabaseAdmin
      .from('professional_calendar_connections')
      .select('*')
      .eq('professional_id', professionalId)
      .eq('status', 'active')
      .single()

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: 'No active calendar connection found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Decrypt tokens (Supabase returns BYTEA as base64 strings)
    let accessToken = await decryptToken(
      connection.access_token_encrypted,
      tokenEncryptionKey
    )

    // Check if token needs refresh (expires in < 5 minutes)
    const tokenExpiry = new Date(connection.token_expires_at)
    if (tokenExpiry <= new Date(Date.now() + 5 * 60 * 1000)) {
      try {
        const refreshToken = await decryptToken(
          connection.refresh_token_encrypted,
          tokenEncryptionKey
        )

        const refreshed = await refreshAccessToken(refreshToken, googleClientId, googleClientSecret)
        accessToken = refreshed.accessToken

        // Store new access token
        const newEncrypted = await encryptToken(accessToken, tokenEncryptionKey)
        await supabaseAdmin
          .from('professional_calendar_connections')
          .update({
            access_token_encrypted: newEncrypted,
            token_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
          })
          .eq('id', connection.id)
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError)

        // Mark connection as expired
        await supabaseAdmin
          .from('professional_calendar_connections')
          .update({
            status: 'expired',
            last_error: 'Token refresh failed. Please reconnect.',
            error_count: connection.error_count + 1,
          })
          .eq('id', connection.id)

        return new Response(
          JSON.stringify({ error: 'Calendar connection expired. Please reconnect.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Calculate time range: now to 3 weeks from now
    const timeMin = new Date().toISOString()
    const timeMax = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString()

    // Fetch freebusy from Google Calendar (privacy-safe: only busy periods, no event details)
    const freeBusyResponse = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: 'America/Toronto', // Clinic timezone
        items: [{ id: connection.calendar_id }],
      }),
    })

    if (!freeBusyResponse.ok) {
      const errorText = await freeBusyResponse.text()
      console.error('FreeBusy API error:', errorText)

      await supabaseAdmin
        .from('professional_calendar_connections')
        .update({
          last_error: `API error: ${freeBusyResponse.status}`,
          error_count: connection.error_count + 1,
        })
        .eq('id', connection.id)

      return new Response(
        JSON.stringify({ error: 'Failed to fetch calendar data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const freeBusyData = await freeBusyResponse.json()
    const busyPeriods = freeBusyData.calendars?.[connection.calendar_id]?.busy || []

    // Delete existing busy blocks for this connection (full replace strategy)
    await supabaseAdmin
      .from('calendar_busy_blocks')
      .delete()
      .eq('connection_id', connection.id)

    // Insert new busy blocks
    let insertedCount = 0
    if (busyPeriods.length > 0) {
      const busyBlocks = busyPeriods.map(
        (period: { start: string; end: string }, index: number) => ({
          connection_id: connection.id,
          professional_id: professionalId,
          start_time: period.start,
          end_time: period.end,
          is_all_day: false,
          source: 'google_calendar',
          external_event_id: `${connection.calendar_id}_${period.start}_${index}`,
        })
      )

      const { error: insertError } = await supabaseAdmin
        .from('calendar_busy_blocks')
        .insert(busyBlocks)

      if (insertError) {
        console.error('Insert error:', insertError)
      } else {
        insertedCount = busyBlocks.length
      }
    }

    // Update last sync timestamp
    await supabaseAdmin
      .from('professional_calendar_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
        error_count: 0,
      })
      .eq('id', connection.id)

    return new Response(
      JSON.stringify({
        success: true,
        busyBlocksCount: insertedCount,
        syncedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Sync error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
