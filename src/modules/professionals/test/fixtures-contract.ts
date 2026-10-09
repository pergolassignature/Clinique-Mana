import { parseRpc } from '../api/parse'
import { contractPayload, templatePayload, versionPayload, type ContractRequest, type ContractTemplate, type ProfessionalContract, type TemplateVersion } from '../api/contracts'

/**
 * The service contract's payloads as the database returns them (snake_case JSON), shaped on
 * `get_professional_contract` (20261009120511), `list_document_templates` and the rows of
 * `document_template_versions` (20261008073909). Test-only: no production file imports this one.
 */

export const REQUEST_ID = '00000000-0000-4000-8000-00000000c501'
export const SIGNED_FILE = '00000000-0000-4000-8000-00000000f501'
export const TEMPLATE_ID = '00000000-0000-4000-8000-00000000d501'
export const DRAFT_ID = '00000000-0000-4000-8000-00000000d511'
export const PUBLISHED_ID = '00000000-0000-4000-8000-00000000d512'

type Json = Record<string, unknown>

/** A request sent on Oct 8 (14:00 UTC), expiring on Oct 15; the professional, then the clinic. */
export function requestJson(over: Json = {}): Json {
  return {
    id: REQUEST_ID,
    status: 'sent',
    last_error: null,
    template_version: 2,
    created_at: '2026-10-08T13:59:00+00:00',
    send_started_at: null,
    last_send_at: '2026-10-08T13:59:30+00:00',
    sent_at: '2026-10-08T14:00:00+00:00',
    viewed_at: null,
    completed_at: null,
    rejected_at: null,
    cancelled_at: null,
    expired_at: null,
    expires_at: '2026-10-15T14:00:00+00:00',
    can_read: true,
    signed_file_id: null,
    rejection_reason: null,
    signers: [
      { role: 'professional', name: 'Marie Tremblay', status: 'pending', signing_order: 1, viewed_at: null, signed_at: null, rejected_at: null },
      { role: 'clinic', name: 'Dominique Exemple', status: 'pending', signing_order: 2, viewed_at: null, signed_at: null, rejected_at: null },
    ],
    ...over,
  }
}

/** The card's payload: « Contrat de service » version 2 published, a clinic signer, `request`. */
export function contractJson(request: Json | null = requestJson(), over: Json = {}): Json {
  return {
    template: { id: TEMPLATE_ID, published_version_id: PUBLISHED_ID, published_version: 2, published_at: '2026-10-01T12:00:00+00:00', draft_version_id: null },
    clinic_signer: true,
    request,
    ...over,
  }
}

/** The signed state: both signed on Oct 9, the PDF stored. */
export const SIGNED_REQUEST = requestJson({
  status: 'signed',
  viewed_at: '2026-10-09T13:00:00+00:00',
  completed_at: '2026-10-09T15:00:00+00:00',
  signed_file_id: SIGNED_FILE,
  signers: [
    { role: 'professional', name: 'Marie Tremblay', status: 'signed', signing_order: 1, viewed_at: '2026-10-09T13:00:00+00:00', signed_at: '2026-10-09T13:05:00+00:00', rejected_at: null },
    { role: 'clinic', name: 'Dominique Exemple', status: 'signed', signing_order: 2, viewed_at: '2026-10-09T14:55:00+00:00', signed_at: '2026-10-09T15:00:00+00:00', rejected_at: null },
  ],
})

/** The card's payload parsed as the API does. */
export const parsedContract = (json: Json): ProfessionalContract => parseRpc(contractPayload, json)

/** A parsed request, for the pure helpers. */
export function parsedRequest(over: Partial<ContractRequest> = {}): ContractRequest {
  return {
    id: REQUEST_ID,
    status: 'sent',
    lastError: null,
    templateVersion: 2,
    createdAt: '2026-10-08T13:59:00+00:00',
    sendStartedAt: null,
    lastSendAt: '2026-10-08T13:59:30+00:00',
    sentAt: '2026-10-08T14:00:00+00:00',
    viewedAt: null,
    completedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    expiredAt: null,
    expiresAt: '2026-10-15T14:00:00+00:00',
    canRead: true,
    signedFileId: null,
    rejectionReason: null,
    signers: [],
    ...over,
  }
}

// --- « Paramètres → Contrats » -------------------------------------------------------------------

export function templateJson(over: Json = {}): Json {
  return {
    id: TEMPLATE_ID,
    key: 'professionals.service_contract',
    module_key: 'professionals',
    title: 'Contrat de service',
    description: 'Convention de prestation de services',
    is_active: true,
    can_edit: true,
    view_permission: 'professionals.view',
    edit_permission: 'professionals.settings',
    published_version_id: null,
    published_version: null,
    published_at: null,
    draft_version_id: DRAFT_ID,
    ...over,
  }
}

const VARIABLES = [
  { path: 'professional.full_name', label: 'Nom du professionnel', sample: 'Camille Exemple', required: true, kind: 'text' },
  { path: 'clinic.name', label: 'Nom de la clinique', sample: 'Clinique Exemple', required: true, kind: 'text' },
  { path: 'pricing.annexe_a', label: 'Tableau de l’Annexe A', sample: '(le tableau)', required: true, kind: 'text' },
]

/** The seeded draft's shape: the validation line first, a heading, a paragraph, Annexe A, the signature page. */
export function bodyJson({ banner = true, annexe = true, initials = true } = {}): Json {
  return {
    title: 'Contrat de service',
    header: { text: 'Contrat de service', ...(initials && { initialsFor: ['professional'] }) },
    footer: { text: 'Convention de prestation de services' },
    blocks: [
      ...(banner ? [{ type: 'paragraph', runs: [{ text: 'Texte à faire valider par la direction avant publication', bold: true }] }] : []),
      { type: 'heading', level: 1, text: 'Convention' },
      { type: 'paragraph', runs: [{ text: 'Entre ' }, { text: '{{clinic.name}}', bold: true }, { text: ' et {{professional.full_name}}.' }] },
      { type: 'heading', level: 2, text: 'Annexe A' },
      ...(annexe ? [{ type: 'paragraph', runs: [{ text: '{{pricing.annexe_a}}' }] }] : []),
      { type: 'signaturePage', signers: [{ role: 'professional', label: 'Le Professionnel' }, { role: 'clinic', label: 'La Clinique' }] },
    ],
  }
}

export function versionJson(over: Json = {}, body: Json = bodyJson()): Json {
  return {
    id: DRAFT_ID,
    version: 1,
    status: 'draft',
    body,
    variables: VARIABLES,
    signers: [
      { role: 'professional', label: 'Le Professionnel', order: 1, required: true },
      { role: 'clinic', label: 'La Clinique', order: 2, required: false },
    ],
    email_subject: 'Votre contrat de service à signer',
    email_message: 'Bonjour {{professional.full_name}},',
    created_at: '2026-10-08T12:00:00+00:00',
    updated_at: '2026-10-08T12:00:00+00:00',
    published_at: null,
    archived_at: null,
    ...over,
  }
}

export const parsedTemplate = (json: Json = templateJson()): ContractTemplate => parseRpc(templatePayload, json)
export const parsedVersion = (json: Json = versionJson()): TemplateVersion => parseRpc(versionPayload, json)
