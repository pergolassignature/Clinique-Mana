import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateProfessionalRequest {
  displayName: string
  email: string
  sendInvite?: boolean
}

interface CreateProfessionalResponse {
  success: boolean
  profileId?: string
  professionalId?: string
  inviteId?: string
  error?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Create a client with the user's token for auth verification
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Verify the user is authenticated
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser()

    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the user's profile to check their role
    const { data: callerProfile, error: roleError } = await supabaseUser
      .from('profiles')
      .select('id, role')
      .eq('user_id', user.id)
      .single()

    if (roleError || !callerProfile) {
      console.error('Profile lookup error:', roleError)
      return new Response(
        JSON.stringify({ success: false, error: 'Could not verify user role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Only admin and staff can create professionals
    if (!['admin', 'staff'].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Permission denied: only admin or staff can create professionals' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { displayName, email, sendInvite = false }: CreateProfessionalRequest = await req.json()

    if (!displayName || !email) {
      return new Response(
        JSON.stringify({ success: false, error: 'displayName and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if email already exists in profiles (use supabaseAdmin for service role operations)
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle()

    if (existingProfile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Ce courriel est déjà utilisé' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if email already exists in auth.users
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const emailExists = existingUsers?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase())
    if (emailExists) {
      return new Response(
        JSON.stringify({ success: false, error: 'Ce courriel est déjà utilisé' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Create auth user with a random password (they'll reset it via invite)
    const tempPassword = crypto.randomUUID() + crypto.randomUUID()
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true, // Auto-confirm email since admin is creating
      user_metadata: {
        display_name: displayName,
      },
    })

    if (authError || !authData.user) {
      console.error('Auth user creation error:', authError)
      return new Response(
        JSON.stringify({ success: false, error: authError?.message || 'Failed to create auth user' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = authData.user.id

    // 2. Create profile record
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        user_id: userId,
        display_name: displayName,
        email: email.toLowerCase(),
        role: 'provider',
        status: 'active',
      })
      .select('id')
      .single()

    if (profileError || !profile) {
      console.error('Profile creation error:', profileError)
      // Cleanup: delete the auth user we just created
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return new Response(
        JSON.stringify({ success: false, error: profileError?.message || 'Failed to create profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Create professional record
    const { data: professional, error: professionalError } = await supabaseAdmin
      .from('professionals')
      .insert({
        profile_id: profile.id,
        status: 'pending',
      })
      .select('id')
      .single()

    if (professionalError || !professional) {
      console.error('Professional creation error:', professionalError)
      // Cleanup: delete profile and auth user
      await supabaseAdmin.from('profiles').delete().eq('id', profile.id)
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return new Response(
        JSON.stringify({ success: false, error: professionalError?.message || 'Failed to create professional' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Optionally create onboarding invite
    let inviteId: string | undefined
    if (sendInvite) {
      // Generate a secure token
      const tokenBytes = new Uint8Array(32)
      crypto.getRandomValues(tokenBytes)
      const token = Array.from(tokenBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const { data: invite, error: inviteError } = await supabaseAdmin
        .from('professional_onboarding_invites')
        .insert({
          professional_id: professional.id,
          email: email.toLowerCase(),
          token,
          status: 'pending',
          sent_by: callerProfile.id,
          sent_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        })
        .select('id')
        .single()

      if (inviteError) {
        console.error('Invite creation error:', inviteError)
        // Don't fail the whole operation, just log it
      } else if (invite) {
        inviteId = invite.id
      }
    }

    const response: CreateProfessionalResponse = {
      success: true,
      profileId: profile.id,
      professionalId: professional.id,
      inviteId,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
