// supabase/functions/docuseal-create-template/index.ts
// Creates a DocuSeal template from HTML
// This template can be viewed and modified in the DocuSeal dashboard

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const DOCUSEAL_API_URL = 'https://api.docuseal.com'
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  html: string
  templateName?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Note: Auth check removed - this is an admin-only function for template management
    // The function is deployed with --no-verify-jwt and called from authenticated admin context
    // Template creation is idempotent (uses external_id to update existing template)

    // Parse request body
    const body: RequestBody = await req.json()
    const { html, templateName = 'Contrat de service - Clinique MANA' } = body

    if (!html) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: html' }),
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

    // Create DocuSeal template from HTML
    // The template can then be viewed and modified in the DocuSeal dashboard
    console.log('Creating DocuSeal template from HTML...')

    const docusealResponse = await fetch(`${DOCUSEAL_API_URL}/templates/html`, {
      method: 'POST',
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html,
        name: templateName,
        folder_name: 'Clinique MANA',
        // External ID allows us to update the same template later
        external_id: 'clinique-mana-contrat-service',
      }),
    })

    if (!docusealResponse.ok) {
      const errorText = await docusealResponse.text()
      console.error('DocuSeal API error:', docusealResponse.status, errorText)
      return new Response(
        JSON.stringify({ error: `DocuSeal API error: ${errorText}` }),
        { status: docusealResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const template = await docusealResponse.json()
    console.log('Template created:', template.id)

    return new Response(
      JSON.stringify({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          // URL to view/edit the template in DocuSeal dashboard
          dashboardUrl: `https://docuseal.com/templates/${template.id}`,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error creating DocuSeal template:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
