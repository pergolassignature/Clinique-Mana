// supabase/functions/docuseal-create-submission/index.ts
// Creates a DocuSeal submission using the ONE-STEP /submissions/html endpoint.
// This is the recommended approach for one-off submissions from HTML content.
//
// The endpoint creates both the document AND submission in a single API call,
// with embedded field tags parsed directly from the HTML.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOCUSEAL_API_URL = 'https://api.docuseal.com'
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  html: string          // Complete contract HTML with DocuSeal field tags embedded
  submitterEmail: string
  submitterName: string
  expiresAt?: string
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

    // Parse request body
    const body: RequestBody = await req.json()
    const { html, submitterEmail, submitterName, expiresAt } = body

    if (!html || !submitterEmail || !submitterName) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: html, submitterEmail, submitterName' }),
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

    // =========================================================================
    // DIAGNOSTIC: Log field tags found in HTML before sending to DocuSeal
    // =========================================================================
    const fieldTagsInHtml = html.match(/<(text-field|signature-field|date-field|initials-field)[^>]*>/gi) || []
    console.log('=== HTML FIELD TAGS ANALYSIS ===')
    console.log('Total HTML length:', html.length, 'chars')
    console.log('Field tags found in HTML:', fieldTagsInHtml.length)
    fieldTagsInHtml.forEach((tag, i) => {
      console.log(`  Tag ${i}: ${tag.slice(0, 150)}...`)
    })

    // =========================================================================
    // ONE-STEP APPROACH: POST /submissions/html
    // Creates document AND submission in a single API call.
    // The documents array contains the HTML with embedded field tags.
    // =========================================================================
    console.log('Creating DocuSeal submission via /submissions/html...')

    const submissionResponse = await fetch(`${DOCUSEAL_API_URL}/submissions/html`, {
      method: 'POST',
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Contrat de service - ${submitterName}`,
        send_email: true,
        documents: [
          {
            name: 'Contrat de service',
            html: html, // Send full HTML - DocuSeal should parse field tags
            html_header: '<div style="text-align: right; padding: 5px 10px;">'
              + '<initials-field'
              + ' name="initials_professionnel"'
              + ' role="First Party"'
              + ' required="true"'
              + ' style="width: 80px; height: 30px; display: inline-block;">'
              + '</initials-field>'
              + '</div>',
          },
        ],
        submitters: [
          {
            role: 'First Party',
            email: submitterEmail,
            name: submitterName,
          },
        ],
        ...(expiresAt && { expire_at: expiresAt }),
        message: {
          subject: 'Contrat de service - Clinique MANA',
          body: `Bonjour ${submitterName},\n\nVeuillez signer votre contrat de service avec Clinique MANA en cliquant sur le lien ci-dessous:\n\n{{submitter.link}}\n\nCordialement,\nClinique MANA`,
        },
      }),
    })

    if (!submissionResponse.ok) {
      const errorText = await submissionResponse.text()
      console.error('DocuSeal submission error:', submissionResponse.status, errorText)
      return new Response(
        JSON.stringify({ error: `DocuSeal submission error: ${errorText}` }),
        { status: submissionResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const submission = await submissionResponse.json()

    // =========================================================================
    // DIAGNOSTIC LOGGING: See submission details
    // =========================================================================
    console.log('=== SUBMISSION RESPONSE ===')
    console.log('Response type:', typeof submission, 'isArray:', Array.isArray(submission))
    console.log('Full response (first 1500 chars):', JSON.stringify(submission).slice(0, 1500))

    // Extract submitter info for response
    const submitterInfo = Array.isArray(submission)
      ? submission[0]
      : submission.submitters?.[0] || submission

    console.log('Submitter embed_src:', submitterInfo?.embed_src)
    console.log('Submitter status:', submitterInfo?.status)

    return new Response(
      JSON.stringify({ success: true, submission }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error creating DocuSeal submission:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
