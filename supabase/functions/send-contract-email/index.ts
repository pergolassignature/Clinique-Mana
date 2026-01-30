// supabase/functions/send-contract-email/index.ts
// Edge Function to send contract signing email to professional

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SendContractEmailRequest {
  contractId: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Get request body
    const { contractId } = (await req.json()) as SendContractEmailRequest

    if (!contractId) {
      return new Response(
        JSON.stringify({ error: 'contractId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch contract with professional info
    const { data: contract, error: contractError } = await supabase
      .from('service_contracts')
      .select(`
        *,
        professional:professionals!service_contracts_professional_id_fkey (
          id,
          public_email,
          profile:profiles!professionals_profile_id_fkey (
            display_name,
            email
          )
        )
      `)
      .eq('id', contractId)
      .single()

    if (contractError || !contract) {
      return new Response(
        JSON.stringify({ error: 'Contract not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get professional's email
    const professionalEmail = contract.professional?.public_email || contract.professional?.profile?.email
    const professionalName = contract.professional?.profile?.display_name || 'Professionnel'

    if (!professionalEmail) {
      return new Response(
        JSON.stringify({ error: 'Professional email not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build signing URL
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://cliniquemana.com'
    const signingUrl = `${frontendUrl}/contract/${contract.token}`

    // Get Resend API key
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Clinique MANA <noreply@cliniquemana.com>',
        to: professionalEmail,
        subject: 'Contrat de service - Clinique MANA',
        html: generateEmailHtml(professionalName, signingUrl),
      }),
    })

    if (!emailResponse.ok) {
      const emailError = await emailResponse.text()
      console.error('Resend API error:', emailError)
      return new Response(
        JSON.stringify({ error: 'Failed to send email' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update contract status to 'sent'
    const { error: updateError } = await supabase
      .from('service_contracts')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('id', contractId)

    if (updateError) {
      console.error('Error updating contract status:', updateError)
      // Email was sent, so we don't fail the request
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Email sent to ${professionalEmail}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in send-contract-email:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function generateEmailHtml(professionalName: string, signingUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contrat de service - Clinique MANA</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; color: #7B2D3E; font-weight: 600;">
                CLINIQUE MANA
              </h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #666666;">
                Ressources en santé mentale et bien-être
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 20px; font-size: 20px; color: #333333;">
                Bonjour ${professionalName},
              </h2>
              <p style="margin: 0 0 16px; font-size: 16px; color: #555555; line-height: 1.6;">
                Nous sommes heureux de vous accueillir au sein de l'équipe Clinique MANA !
              </p>
              <p style="margin: 0 0 16px; font-size: 16px; color: #555555; line-height: 1.6;">
                Veuillez prendre connaissance de votre contrat de service et le signer électroniquement en cliquant sur le bouton ci-dessous.
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${signingUrl}" style="display: inline-block; padding: 16px 32px; background-color: #7B2D3E; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      Signer le contrat
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px; font-size: 14px; color: #888888; line-height: 1.6;">
                Ce lien est valide pendant 7 jours. Si vous avez des questions, n'hésitez pas à nous contacter.
              </p>

              <p style="margin: 0 0 8px; font-size: 14px; color: #888888; line-height: 1.6;">
                Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :
              </p>
              <p style="margin: 0 0 16px; font-size: 12px; color: #7B2D3E; word-break: break-all;">
                ${signingUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #eeeeee;">
              <p style="margin: 0; font-size: 14px; color: #888888; text-align: center;">
                Clinique MANA Inc.<br>
                300 – 797 Boul. Lebourgneuf, Québec, G2J 0B5<br>
                418 907-9754 | cliniquemana.com
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}
