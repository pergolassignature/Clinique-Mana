import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
async function decryptToken(encryptedData: string | Uint8Array, keyBase64: string): Promise<string> {
  let encrypted: Uint8Array

  if (typeof encryptedData === 'string') {
    // Supabase returns BYTEA as hex string with \x prefix
    if (encryptedData.startsWith('\\x')) {
      encrypted = hexToBytes(encryptedData)
    } else {
      // Fallback for other formats
      encrypted = hexToBytes(encryptedData)
    }
  } else {
    encrypted = encryptedData
  }

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
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

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

    // Get connection to revoke
    const { data: connection } = await supabaseAdmin
      .from('professional_calendar_connections')
      .select('id, access_token_encrypted, provider_email')
      .eq('professional_id', professionalId)
      .single()

    if (!connection) {
      return new Response(
        JSON.stringify({ success: true, message: 'No connection to disconnect' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Revoke token at Google (best effort - don't fail if this fails)
    try {
      const accessToken = await decryptToken(
        connection.access_token_encrypted,
        tokenEncryptionKey
      )

      await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch (revokeError) {
      console.warn('Token revocation failed (non-critical):', revokeError)
    }

    // Delete busy blocks first (foreign key constraint)
    await supabaseAdmin.from('calendar_busy_blocks').delete().eq('connection_id', connection.id)

    // Delete the connection
    await supabaseAdmin
      .from('professional_calendar_connections')
      .delete()
      .eq('id', connection.id)

    // Log audit event
    await supabaseAdmin.from('professional_audit_log').insert({
      professional_id: professionalId,
      action: 'calendar_disconnected',
      old_value: {
        provider: 'google',
        email: connection.provider_email,
        connection_id: connection.id,
      },
    })

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Disconnect error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
