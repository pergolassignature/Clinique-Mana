// supabase/functions/docuseal-webhook/index.ts
// Handles DocuSeal webhook notifications when documents are signed

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOCUSEAL_API_URL = 'https://api.docuseal.com'
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DocuSealWebhookPayload {
  event_type: 'form.viewed' | 'form.started' | 'form.completed' | 'form.declined'
  timestamp: string
  data: {
    id: number              // Submitter ID
    email: string
    name: string
    status: string
    completed_at: string | null
    documents: Array<{
      name: string
      url: string
    }>
    submission: {           // Submission details nested here
      id: number            // The actual submission ID
      status: string
      combined_document_url: string | null
      audit_log_url: string
    }
  }
}

/**
 * Download PDF from DocuSeal URL
 */
async function downloadPdf(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error('Failed to download PDF:', response.status)
      return null
    }
    return await response.arrayBuffer()
  } catch (error) {
    console.error('Error downloading PDF:', error)
    return null
  }
}

interface DocuSealSubmission {
  id: number
  status: 'pending' | 'completed' | 'expired' | 'declined'
  completed_at: string | null
  created_at: string
  source: string
  audit_log_url: string
  combined_document_url: string | null
  documents: Array<{ name: string; url: string }>
  submitters: Array<{
    id: number
    email: string
    name: string
    role: string
    status: string
    completed_at: string | null
    opened_at: string | null
    sent_at: string | null
    ip: string | null
    ua: string | null
  }>
}

/**
 * Fetch full submission details from DocuSeal API
 * This includes the combined document URL with ALL signatures
 */
async function fetchSubmission(submissionId: number): Promise<DocuSealSubmission | null> {
  if (!DOCUSEAL_API_KEY) {
    console.error('DOCUSEAL_API_KEY not configured')
    return null
  }

  try {
    const response = await fetch(`${DOCUSEAL_API_URL}/submissions/${submissionId}`, {
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
      },
    })

    if (!response.ok) {
      console.error('Failed to fetch submission:', response.status)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error('Error fetching submission:', error)
    return null
  }
}

/**
 * Extract audit log from submission data
 */
function extractAuditLog(submission: DocuSealSubmission): object {
  return {
    submission_id: submission.id,
    created_at: submission.created_at,
    completed_at: submission.completed_at,
    source: submission.source,
    submitters: submission.submitters.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      status: s.status,
      opened_at: s.opened_at,
      sent_at: s.sent_at,
      completed_at: s.completed_at,
      ip: s.ip,
      ua: s.ua,
    })),
    audit_log_url: submission.audit_log_url,
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // DocuSeal webhooks are POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse webhook payload
    const payload: DocuSealWebhookPayload = await req.json()
    console.log('Received DocuSeal webhook:', JSON.stringify(payload, null, 2))

    // We only care about form.completed events
    if (payload.event_type !== 'form.completed') {
      console.log(`Ignoring event type: ${payload.event_type}`)
      return new Response(
        JSON.stringify({ success: true, message: 'Event ignored' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with service role for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Extract submission ID from the nested submission object
    const submissionId = payload.data.submission?.id
    if (!submissionId) {
      console.error('No submission ID in webhook payload:', JSON.stringify(payload.data).slice(0, 500))
      return new Response(
        JSON.stringify({ error: 'No submission ID in payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Processing submission ID:', submissionId)

    // Fetch full submission details from DocuSeal API
    // This tells us if ALL submitters have completed
    console.log('Fetching submission details from DocuSeal...')
    const submission = await fetchSubmission(submissionId)

    if (!submission) {
      console.error('Failed to fetch submission details:', submissionId)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch submission details' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if ALL submitters have completed
    const allCompleted = submission.submitters.every((s) => s.status === 'completed')
    if (!allCompleted) {
      const completedCount = submission.submitters.filter((s) => s.status === 'completed').length
      console.log(`Not all submitters completed yet: ${completedCount}/${submission.submitters.length}`)
      return new Response(
        JSON.stringify({ success: true, message: 'Waiting for all submitters to complete' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('All submitters completed, processing signed contract...')

    // FIRST: Check document_instances (new template-based system)
    const { data: instance, error: instanceError } = await supabase
      .from('document_instances')
      .select('id, subject_id, subject_type, status')
      .eq('docuseal_submission_id', String(submissionId))
      .single()

    if (instance && !instanceError) {
      // Found in document_instances
      if (instance.status === 'signed') {
        console.log('Document instance already signed:', instance.id)
        return new Response(
          JSON.stringify({ success: true, message: 'Document instance already signed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Use the combined document URL which has ALL signatures
      const signedPdfUrl = submission.combined_document_url || submission.documents?.[0]?.url || null

      // Download and store signed PDF
      let storagePath: string | null = null
      if (signedPdfUrl) {
        console.log('Downloading signed PDF for document instance...')
        const pdfBuffer = await downloadPdf(signedPdfUrl)

        if (pdfBuffer) {
          const fileName = `documents/${instance.subject_id}/${instance.id}_signed.pdf`
          const { error: uploadError } = await supabase.storage
            .from('professional-documents')
            .upload(fileName, pdfBuffer, {
              contentType: 'application/pdf',
              upsert: true,
            })

          if (uploadError) {
            console.error('Error uploading PDF to storage:', uploadError)
          } else {
            storagePath = fileName
            console.log('PDF uploaded to storage:', storagePath)
          }
        }
      }

      // Download and store audit log PDF
      let auditLogStoragePath: string | null = null
      if (submission.audit_log_url) {
        console.log('Downloading audit log PDF...')
        const auditLogBuffer = await downloadPdf(submission.audit_log_url)

        if (auditLogBuffer) {
          const auditLogFileName = `documents/${instance.subject_id}/${instance.id}_audit_log.pdf`
          const { error: auditUploadError } = await supabase.storage
            .from('professional-documents')
            .upload(auditLogFileName, auditLogBuffer, {
              contentType: 'application/pdf',
              upsert: true,
            })

          if (auditUploadError) {
            console.error('Error uploading audit log to storage:', auditUploadError)
          } else {
            auditLogStoragePath = auditLogFileName
            console.log('Audit log uploaded to storage:', auditLogStoragePath)
          }
        }
      }

      // Extract audit log metadata
      const auditLog = extractAuditLog(submission)

      // Find submitter timestamps
      const cliniqueSubmitter = submission.submitters.find((s) => s.role === 'Clinique')
      const professionnelSubmitter = submission.submitters.find((s) => s.role === 'Professionnel')

      // Update document_instance
      const { error: updateError } = await supabase
        .from('document_instances')
        .update({
          status: 'signed',
          signed_at: professionnelSubmitter?.completed_at || submission.completed_at || new Date().toISOString(),
          signed_pdf_storage_path: storagePath,
          audit_log_storage_path: auditLogStoragePath,
          docuseal_audit_log: auditLog,
          clinic_signer_name: cliniqueSubmitter?.name || null,
          clinic_signed_at: cliniqueSubmitter?.completed_at || null,
        })
        .eq('id', instance.id)

      if (updateError) {
        console.error('Error updating document instance:', updateError)
        return new Response(
          JSON.stringify({ error: 'Failed to update document instance' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log('Document instance signed successfully:', instance.id, 'Storage path:', storagePath)
      return new Response(
        JSON.stringify({ success: true, instanceId: instance.id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // FALLBACK: Check service_contracts (legacy system)
    console.log('No document_instance found, checking service_contracts...')

    // Find the contract by DocuSeal submission ID
    const { data: contract, error: findError } = await supabase
      .from('service_contracts')
      .select('id, professional_id, status')
      .eq('docuseal_submission_id', submissionId)
      .single()

    if (findError || !contract) {
      console.error('Contract not found for submission:', submissionId, findError)
      return new Response(
        JSON.stringify({ error: 'Contract not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Don't update if already signed
    if (contract.status === 'signed') {
      console.log('Contract already signed:', contract.id)
      return new Response(
        JSON.stringify({ success: true, message: 'Contract already signed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use the combined document URL which has ALL signatures
    // Fall back to the first document if combined is not available
    const signedPdfUrl = submission.combined_document_url || submission.documents?.[0]?.url || null

    // Download the signed PDF and upload to Supabase Storage
    let storagePath: string | null = null
    if (signedPdfUrl) {
      console.log('Downloading signed PDF from DocuSeal (combined document)...')
      const pdfBuffer = await downloadPdf(signedPdfUrl)

      if (pdfBuffer) {
        // Upload to Supabase Storage
        const fileName = `contracts/${contract.professional_id}/${contract.id}_signed.pdf`
        const { error: uploadError } = await supabase.storage
          .from('professional-documents')
          .upload(fileName, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          })

        if (uploadError) {
          console.error('Error uploading PDF to storage:', uploadError)
        } else {
          storagePath = fileName
          console.log('PDF uploaded to storage:', storagePath)
        }
      }
    }

    // Extract audit log from submission data
    const auditLog = extractAuditLog(submission)

    // Find the clinic submitter's completion timestamp
    const cliniqueSubmitter = submission.submitters.find((s) => s.role === 'Clinique')
    const professionnelSubmitter = submission.submitters.find((s) => s.role === 'Professionnel')

    // Update contract status to signed with local storage path and audit log
    const { error: updateError } = await supabase
      .from('service_contracts')
      .update({
        status: 'signed',
        signed_at: professionnelSubmitter?.completed_at || submission.completed_at || new Date().toISOString(),
        signed_pdf_url: signedPdfUrl,
        signed_pdf_storage_path: storagePath,
        audit_log: auditLog,
        clinic_signed_at: cliniqueSubmitter?.completed_at || new Date().toISOString(),
      })
      .eq('id', contract.id)

    if (updateError) {
      console.error('Error updating contract:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to update contract' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Contract signed successfully:', contract.id, 'Storage path:', storagePath)

    return new Response(
      JSON.stringify({ success: true, contractId: contract.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
