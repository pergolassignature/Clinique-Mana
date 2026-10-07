// supabase/functions/docuseal-get-submission/index.ts
// Fetches DocuSeal submission status

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOCUSEAL_API_URL = 'https://api.docuseal.com'
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY')

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
    // Verify authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client to verify the user
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get submission ID from body (POST) or query params (GET)
    let submissionId: string | null = null

    if (req.method === 'POST') {
      const body = await req.json()
      submissionId = body.submissionId?.toString() || null
    } else {
      const url = new URL(req.url)
      submissionId = url.searchParams.get('submissionId')
    }

    if (!submissionId) {
      return new Response(
        JSON.stringify({ error: 'Missing submissionId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!DOCUSEAL_API_KEY) {
      console.error('DOCUSEAL_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'DocuSeal API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch submission from DocuSeal
    const docusealResponse = await fetch(`${DOCUSEAL_API_URL}/submissions/${submissionId}`, {
      method: 'GET',
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
      },
    })

    if (!docusealResponse.ok) {
      if (docusealResponse.status === 404) {
        return new Response(
          JSON.stringify({ error: 'Submission not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const errorText = await docusealResponse.text()
      console.error('DocuSeal API error:', docusealResponse.status, errorText)
      return new Response(
        JSON.stringify({ error: `DocuSeal API error: ${errorText}` }),
        { status: docusealResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const submission = await docusealResponse.json()

    return new Response(
      JSON.stringify({ success: true, submission }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error fetching DocuSeal submission:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
