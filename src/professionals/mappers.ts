import type {
  ProfessionalWithRelations,
  ProfessionalDocument,
  DocumentType,
  OnboardingInvite,
  QuestionnaireSubmission,
  Specialty,
  AuditAction,
} from './types'

// =============================================================================
// REQUIRED DOCUMENTS CONFIGURATION
// Maps to existing document_type enum values in the database
// =============================================================================

export interface RequiredDocumentConfig {
  type: DocumentType
  labelFr: string
  descriptionFr: string
  isRequired: boolean
  hasExpiry: boolean
  expiryMonths?: number
  autoRenew?: boolean
  withdrawalNoticeMonths?: number
}

export const REQUIRED_DOCUMENTS: RequiredDocumentConfig[] = [
  {
    type: 'photo',
    labelFr: 'Photo professionnelle',
    descriptionFr: 'Photo de qualité pour le profil public',
    isRequired: true,
    hasExpiry: false,
  },
  {
    type: 'insurance',
    labelFr: 'Preuve d\'assurance',
    descriptionFr: 'Certificat d\'assurance responsabilité professionnelle',
    isRequired: true,
    hasExpiry: true,
    expiryMonths: 12,
  },
  {
    type: 'license',
    labelFr: 'Consentement droit à l\'image',
    descriptionFr: 'Autorisation d\'utilisation de l\'image (12 mois, renouvellement automatique, préavis de retrait 3 mois)',
    isRequired: true,
    hasExpiry: true,
    expiryMonths: 12,
    autoRenew: true,
    withdrawalNoticeMonths: 3,
  },
  {
    type: 'cv',
    labelFr: 'Contrat de service',
    descriptionFr: 'Contrat de collaboration avec la Clinique MANA',
    isRequired: true,
    hasExpiry: false,
  },
]

// =============================================================================
// ONBOARDING STATE MACHINE
// Derives UI state from existing DB fields
// =============================================================================

export type OnboardingStep = 'formulaire' | 'documents' | 'activation'
export type OnboardingStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

// Explicit status labels for invitation (derived from invite.status + timestamps)
export type InviteDisplayStatus = 'brouillon' | 'envoyee' | 'consultee' | 'completee' | 'expiree' | 'revoquee'

// Explicit status labels for questionnaire (derived from submission.status)
export type QuestionnaireDisplayStatus = 'non_soumis' | 'soumis' | 'en_revision' | 'approuve'

// Combined "Formulaire" status (unified invite + questionnaire state)
// Precedence: approved > reviewed > submitted > opened > sent > expired/revoked > brouillon
export type FormulaireDisplayStatus =
  | 'a_envoyer'      // No invite exists
  | 'envoye'         // Invite sent, waiting for professional
  | 'consulte'       // Professional opened the link
  | 'soumis'         // Questionnaire submitted
  | 'en_revision'    // Questionnaire under review
  | 'approuve'       // Questionnaire approved
  | 'expire'         // Invite expired
  | 'revoque'        // Invite revoked

export const FORMULAIRE_STATUS_LABELS: Record<FormulaireDisplayStatus, string> = {
  a_envoyer: 'À envoyer',
  envoye: 'Envoyé',
  consulte: 'Consulté',
  soumis: 'Soumis',
  en_revision: 'En révision',
  approuve: 'Approuvé',
  expire: 'Expiré',
  revoque: 'Révoqué',
}

export const INVITE_STATUS_LABELS: Record<InviteDisplayStatus, string> = {
  brouillon: 'Brouillon',
  envoyee: 'Envoyée au professionnel',
  consultee: 'Consultée',
  completee: 'Complétée',
  expiree: 'Expirée',
  revoquee: 'Révoquée',
}

export const QUESTIONNAIRE_STATUS_LABELS: Record<QuestionnaireDisplayStatus, string> = {
  non_soumis: 'Non soumis',
  soumis: 'Soumis',
  en_revision: 'En révision',
  approuve: 'Approuvé',
}

export interface OnboardingStepState {
  step: OnboardingStep
  status: OnboardingStepStatus
  labelFr: string
  descriptionFr: string
  completedAt?: string
  canProceed: boolean
  blockedReason?: string
  // Explicit display status for UI chips
  displayStatus?: string
  displayStatusKey?: FormulaireDisplayStatus | InviteDisplayStatus | QuestionnaireDisplayStatus
}

export interface OnboardingState {
  steps: OnboardingStepState[]
  currentStep: OnboardingStep
  completionPercentage: number
  isComplete: boolean
  canActivate: boolean
  activationBlockers: string[]
}

/**
 * Derives the display status for an invitation based on DB fields.
 * Precedence: revoked > expired > completed > opened > sent > brouillon
 */
export function deriveInviteDisplayStatus(invite: OnboardingInvite | null | undefined): InviteDisplayStatus {
  if (!invite) return 'brouillon'

  // Check status first
  if (invite.status === 'revoked') return 'revoquee'
  if (invite.status === 'completed') return 'completee'
  if (invite.status === 'opened') return 'consultee'

  // Check expiry (pending but past expires_at)
  if (invite.status === 'pending' && invite.expires_at) {
    const now = new Date()
    const expiresAt = new Date(invite.expires_at)
    if (expiresAt < now) return 'expiree'
  }

  // Also handle explicit expired status
  if (invite.status === 'expired') return 'expiree'

  // Pending with sent_at means sent
  if (invite.status === 'pending' && invite.sent_at) return 'envoyee'

  // Pending without sent_at means draft/brouillon
  return 'brouillon'
}

/**
 * Derives the display status for a questionnaire submission based on DB fields.
 */
export function deriveQuestionnaireDisplayStatus(
  submission: QuestionnaireSubmission | null | undefined
): QuestionnaireDisplayStatus {
  if (!submission) return 'non_soumis'

  switch (submission.status) {
    case 'approved':
      return 'approuve'
    case 'reviewed':
      return 'en_revision'
    case 'submitted':
      return 'soumis'
    case 'draft':
    default:
      return 'non_soumis'
  }
}

/**
 * Derives the combined "Formulaire" display status from invite + submission.
 * Precedence: approved > reviewed > submitted > opened > sent > expired/revoked > a_envoyer
 */
export function deriveFormulaireDisplayStatus(
  invite: OnboardingInvite | null | undefined,
  submission: QuestionnaireSubmission | null | undefined
): FormulaireDisplayStatus {
  // 1. Check submission status first (highest precedence when exists)
  if (submission) {
    if (submission.status === 'approved') return 'approuve'
    if (submission.status === 'reviewed') return 'en_revision'
    if (submission.status === 'submitted') return 'soumis'
    // Draft submissions don't advance the status
  }

  // 2. No meaningful submission, check invite status
  if (!invite) return 'a_envoyer'

  // 3. Check invite terminal states (revoked/expired)
  if (invite.status === 'revoked') return 'revoque'
  if (invite.status === 'expired') return 'expire'

  // Check expiry for pending invites
  if (invite.status === 'pending' && invite.expires_at) {
    const now = new Date()
    const expiresAt = new Date(invite.expires_at)
    if (expiresAt < now) return 'expire'
  }

  // 4. Check invite progress states
  if (invite.status === 'completed' || invite.status === 'opened') return 'consulte'
  if (invite.status === 'pending' && invite.sent_at) return 'envoye'

  // 5. Default: invite exists but not sent
  return 'a_envoyer'
}

export function mapOnboardingState(professional: ProfessionalWithRelations): OnboardingState {
  const invite = professional.latest_invite
  const submission = professional.latest_submission
  const documents = professional.documents || []

  // Calculate required docs status (pass submission for electronic consent check)
  const requiredDocsStatus = mapRequiredDocumentsState(documents, submission)
  const missingRequiredDocs = requiredDocsStatus.filter(d => d.status === 'missing' || d.status === 'expired')
  const hasAllRequiredDocs = missingRequiredDocs.length === 0

  // Derive combined formulaire display status
  const formulaireDisplayKey = deriveFormulaireDisplayStatus(invite, submission)

  // Determine step statuses
  const formulaireStatus = getFormulaireStepStatus(formulaireDisplayKey)
  const documentsStatus = getDocumentsStepStatus(documents, submission)
  const activationStatus = getActivationStepStatus(professional, formulaireDisplayKey, hasAllRequiredDocs)

  // Description for formulaire based on combined display status
  const formulaireDescriptions: Record<FormulaireDisplayStatus, string> = {
    a_envoyer: 'Créer et envoyer le formulaire au professionnel',
    envoye: 'En attente que le professionnel consulte le lien',
    consulte: 'Le professionnel a consulté le formulaire',
    soumis: 'Questionnaire soumis — en attente de révision',
    en_revision: 'Questionnaire en cours de révision',
    approuve: 'Questionnaire approuvé et appliqué au profil',
    expire: 'Le lien a expiré — créer un nouveau lien',
    revoque: 'Le lien a été révoqué — créer un nouveau lien',
  }

  const steps: OnboardingStepState[] = [
    {
      step: 'formulaire',
      status: formulaireStatus,
      labelFr: 'Formulaire',
      descriptionFr: formulaireDescriptions[formulaireDisplayKey],
      completedAt: submission?.status === 'approved' ? submission.reviewed_at || undefined : undefined,
      canProceed: true,
      displayStatus: FORMULAIRE_STATUS_LABELS[formulaireDisplayKey],
      displayStatusKey: formulaireDisplayKey,
    },
    {
      step: 'documents',
      status: documentsStatus,
      labelFr: 'Documents requis',
      descriptionFr: documentsStatus === 'completed'
        ? 'Tous les documents sont vérifiés'
        : `${missingRequiredDocs.length} document(s) manquant(s) ou expiré(s)`,
      canProceed: true,
    },
    {
      step: 'activation',
      status: activationStatus,
      labelFr: 'Activation',
      descriptionFr: activationStatus === 'completed'
        ? 'Professionnel activé'
        : activationStatus === 'pending'
          ? 'Prêt à activer'
          : 'Compléter les étapes précédentes',
      canProceed: formulaireDisplayKey === 'approuve' && hasAllRequiredDocs,
      blockedReason: formulaireDisplayKey !== 'approuve' ? 'Formulaire à compléter'
        : !hasAllRequiredDocs ? 'Documents à téléverser'
        : undefined,
    },
  ]

  // Find current step
  const currentStep = steps.find(s => s.status === 'in_progress')?.step
    || steps.find(s => s.status === 'pending')?.step
    || 'activation'

  // Calculate completion
  const completedSteps = steps.filter(s => s.status === 'completed').length
  const completionPercentage = Math.round((completedSteps / steps.length) * 100)

  // Determine activation blockers (calm wording)
  const activationBlockers: string[] = []
  if (formulaireDisplayKey !== 'approuve') {
    activationBlockers.push('Formulaire à compléter')
  }
  if (!hasAllRequiredDocs) {
    missingRequiredDocs.forEach(d => {
      if (d.status === 'missing') {
        activationBlockers.push(`À téléverser : ${d.config.labelFr}`)
      } else if (d.status === 'expired') {
        activationBlockers.push(`À renouveler : ${d.config.labelFr}`)
      }
    })
  }

  return {
    steps,
    currentStep,
    completionPercentage,
    isComplete: completedSteps === steps.length,
    canActivate: activationBlockers.length === 0 && professional.status !== 'active',
    activationBlockers,
  }
}

/**
 * Determines the onboarding step status for the combined Formulaire step.
 * Uses the derived formulaire display status for accurate state.
 */
function getFormulaireStepStatus(displayKey: FormulaireDisplayStatus): OnboardingStepStatus {
  // Approved = completed
  if (displayKey === 'approuve') return 'completed'

  // Submitted, in review, or consulted = in progress
  if (['soumis', 'en_revision', 'consulte', 'envoye'].includes(displayKey)) return 'in_progress'

  // Expired or revoked go back to pending (need new link)
  if (displayKey === 'expire' || displayKey === 'revoque') return 'pending'

  // a_envoyer = pending
  return 'pending'
}

function getDocumentsStepStatus(
  documents: ProfessionalDocument[],
  submission?: QuestionnaireSubmission | null
): OnboardingStepStatus {
  const requiredDocsStatus = mapRequiredDocumentsState(documents, submission)
  const allComplete = requiredDocsStatus.every(d => d.status === 'verified')
  const someUploaded = requiredDocsStatus.some(d => d.status === 'pending' || d.status === 'verified')

  if (allComplete) return 'completed'
  if (someUploaded) return 'in_progress'
  return 'pending'
}

/**
 * Determines the onboarding step status for the activation step.
 * Uses formulaire display key for accurate completion check.
 */
function getActivationStepStatus(
  professional: ProfessionalWithRelations,
  formulaireDisplayKey: FormulaireDisplayStatus,
  hasAllRequiredDocs: boolean
): OnboardingStepStatus {
  if (professional.status === 'active') return 'completed'
  if (formulaireDisplayKey === 'approuve' && hasAllRequiredDocs) return 'pending'
  return 'blocked'
}

// =============================================================================
// REQUIRED DOCUMENTS STATE
// =============================================================================

export type RequiredDocumentStatus = 'missing' | 'pending' | 'verified' | 'expired'

// Source of consent: 'document' = uploaded file, 'questionnaire' = signed electronically
export type ConsentSource = 'document' | 'questionnaire'

export interface RequiredDocumentState {
  config: RequiredDocumentConfig
  status: RequiredDocumentStatus
  document?: ProfessionalDocument
  expiresAt?: string
  verifiedAt?: string
  // For consent signed via questionnaire (not a file upload)
  consentSource?: ConsentSource
  consentSignerName?: string
  consentSignedAt?: string
}

// Type for the image rights consent stored in questionnaire responses
interface ImageRightsConsent {
  version?: string
  signed?: boolean
  signer_full_name?: string
  signer_email?: string
  signed_at?: string
  renewal_policy?: string
  withdrawal_notice?: string
}

/**
 * Maps required documents state, optionally checking questionnaire submission
 * for electronically signed consent.
 */
export function mapRequiredDocumentsState(
  documents: ProfessionalDocument[],
  submission?: QuestionnaireSubmission | null
): RequiredDocumentState[] {
  return REQUIRED_DOCUMENTS.map(config => {
    // Find documents of this type
    const docsOfType = documents.filter(d => d.document_type === config.type)

    // Get the most recent one
    const latestDoc = docsOfType.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]

    // Special handling for consent (license type): check questionnaire for electronic signature
    if (config.type === 'license' && !latestDoc) {
      const consent = submission?.responses?.image_rights_consent as ImageRightsConsent | undefined
      if (consent?.signed === true && consent.signed_at) {
        // Calculate expiry (12 months from signing)
        const signedAt = new Date(consent.signed_at)
        const expiresAt = new Date(signedAt)
        expiresAt.setMonth(expiresAt.getMonth() + (config.expiryMonths || 12))

        // Check if expired
        const now = new Date()
        if (expiresAt < now) {
          return {
            config,
            status: 'expired',
            expiresAt: expiresAt.toISOString(),
            verifiedAt: consent.signed_at,
            consentSource: 'questionnaire',
            consentSignerName: consent.signer_full_name,
            consentSignedAt: consent.signed_at,
          }
        }

        // Valid electronic consent - treat as verified
        return {
          config,
          status: 'verified',
          expiresAt: expiresAt.toISOString(),
          verifiedAt: consent.signed_at,
          consentSource: 'questionnaire',
          consentSignerName: consent.signer_full_name,
          consentSignedAt: consent.signed_at,
        }
      }
    }

    if (!latestDoc) {
      return { config, status: 'missing' }
    }

    // Check expiry
    if (config.hasExpiry && latestDoc.expires_at) {
      const now = new Date()
      const expiresAt = new Date(latestDoc.expires_at)
      if (expiresAt < now) {
        return {
          config,
          status: 'expired',
          document: latestDoc,
          expiresAt: latestDoc.expires_at,
          verifiedAt: latestDoc.verified_at || undefined,
          consentSource: 'document',
        }
      }
    }

    // Check verification
    if (latestDoc.verified_at) {
      return {
        config,
        status: 'verified',
        document: latestDoc,
        expiresAt: latestDoc.expires_at || undefined,
        verifiedAt: latestDoc.verified_at,
        consentSource: 'document',
      }
    }

    return {
      config,
      status: 'pending',
      document: latestDoc,
      expiresAt: latestDoc.expires_at || undefined,
      consentSource: 'document',
    }
  })
}

// =============================================================================
// PROFESSIONAL VIEW MODEL
// Complete view model for the professional detail page
// =============================================================================

export interface ProfessionalViewModel {
  // Identity
  id: string
  displayName: string
  email: string
  initials: string

  // Professional info
  title?: string
  licenseNumber?: string
  yearsExperience?: number

  // Contact
  publicEmail?: string
  publicPhone?: string

  // Portrait
  bio?: string
  approach?: string

  // Status
  status: 'pending' | 'invited' | 'active' | 'inactive'
  profileStatus: 'active' | 'disabled'

  // Dates
  createdAt: string
  updatedAt: string

  // Computed
  onboarding: OnboardingState
  requiredDocuments: RequiredDocumentState[]
  documentCompleteness: number
  specialtiesByCategory: Record<string, Specialty[]>

  // Submission tracking
  questionnaireSubmittedAt?: string
  questionnaireSubmittedVia?: 'invitation' | 'manual'
  lastModifiedByTeam?: string
}

export function mapProfessionalToViewModel(professional: ProfessionalWithRelations): ProfessionalViewModel {
  const profile = professional.profile
  const documents = professional.documents || []
  const specialties = professional.specialties || []
  const submission = professional.latest_submission

  // Calculate initials
  const displayName = profile?.display_name || 'Inconnu'
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  // Group specialties by category
  const specialtiesByCategory: Record<string, Specialty[]> = {}
  specialties.forEach(ps => {
    if (ps.specialty) {
      const category = ps.specialty.category
      if (!specialtiesByCategory[category]) {
        specialtiesByCategory[category] = []
      }
      specialtiesByCategory[category].push(ps.specialty)
    }
  })

  // Calculate document completeness (pass submission for electronic consent check)
  const requiredDocs = mapRequiredDocumentsState(documents, submission)
  const verifiedCount = requiredDocs.filter(d => d.status === 'verified').length
  const documentCompleteness = Math.round((verifiedCount / requiredDocs.length) * 100)

  // Determine submission source
  const questionnaireSubmittedVia = submission?.invite_id ? 'invitation' : submission ? 'manual' : undefined

  return {
    id: professional.id,
    displayName,
    email: profile?.email || '',
    initials,

    title: submission?.responses?.title,
    licenseNumber: professional.license_number || submission?.responses?.license_number,
    yearsExperience: professional.years_experience || submission?.responses?.years_experience,

    publicEmail: professional.public_email || undefined,
    publicPhone: professional.public_phone || undefined,

    bio: professional.portrait_bio || undefined,
    approach: professional.portrait_approach || undefined,

    status: professional.status,
    profileStatus: profile?.status || 'active',

    createdAt: professional.created_at,
    updatedAt: professional.updated_at,

    onboarding: mapOnboardingState(professional),
    requiredDocuments: requiredDocs,
    documentCompleteness,
    specialtiesByCategory,

    questionnaireSubmittedAt: submission?.submitted_at || undefined,
    questionnaireSubmittedVia,
  }
}

// =============================================================================
// HUMANIZED AUDIT LOG
// =============================================================================

export interface HumanizedAuditEntry {
  id: string
  action: AuditAction
  labelFr: string
  descriptionFr?: string
  iconType: 'success' | 'warning' | 'error' | 'info'
  actorName?: string
  isSystem: boolean
  createdAt: string
  details?: Record<string, unknown>
  hasDetails: boolean
}

const ACTION_LABELS: Record<AuditAction, string> = {
  created: 'Profil créé',
  updated: 'Profil modifié',
  deleted: 'Profil retiré',
  status_changed: 'Statut modifié',
  portrait_updated: 'Portrait mis à jour',
  fiche_generated: 'Fiche générée',
  document_uploaded: 'Document reçu',
  document_verified: 'Document vérifié',
  document_rejected: 'Document à réviser',
  document_expiry_updated: 'Expiration mise à jour',
  document_deleted: 'Document retiré',
  invite_created: 'Invitation créée',
  invite_sent: 'Invitation envoyée',
  invite_opened: 'Invitation consultée',
  invite_completed: 'Invitation complétée',
  invite_expired: 'Invitation expirée',
  invite_revoked: 'Invitation annulée',
  invite_deleted: 'Invitation retirée',
  questionnaire_started: 'Questionnaire commencé',
  questionnaire_submitted: 'Questionnaire soumis',
  questionnaire_reviewed: 'Questionnaire révisé',
  questionnaire_approved: 'Questionnaire approuvé',
  specialty_added: 'Spécialité ajoutée',
  specialty_removed: 'Spécialité retirée',
}

function getIconType(action: AuditAction): HumanizedAuditEntry['iconType'] {
  if (action.includes('deleted') || action.includes('rejected') || action.includes('revoked') || action.includes('expired')) {
    return 'error'
  }
  if (action.includes('verified') || action.includes('approved') || action.includes('completed')) {
    return 'success'
  }
  if (action.includes('created') || action.includes('uploaded') || action.includes('added') || action.includes('sent')) {
    return 'success'
  }
  if (action.includes('opened') || action.includes('started') || action.includes('submitted')) {
    return 'info'
  }
  return 'info'
}

function getActionDescription(action: AuditAction, newValue: Record<string, unknown> | null): string | undefined {
  if (!newValue) return undefined

  // Add context for specific actions
  if (action === 'document_uploaded' && newValue.document_type) {
    const typeLabels: Record<string, string> = {
      photo: 'Photo',
      insurance: 'Assurance',
      license: 'Permis',
      cv: 'CV',
      diploma: 'Diplôme',
      fiche: 'Fiche',
      other: 'Autre',
    }
    return typeLabels[newValue.document_type as string] || undefined
  }

  if (action === 'specialty_added' && newValue.name_fr) {
    return newValue.name_fr as string
  }

  if (action === 'specialty_removed' && newValue.name_fr) {
    return newValue.name_fr as string
  }

  if (action === 'status_changed' && newValue.status) {
    const statusLabels: Record<string, string> = {
      pending: 'En attente',
      invited: 'Invité',
      active: 'Actif',
      inactive: 'Inactif',
    }
    return `→ ${statusLabels[newValue.status as string] || newValue.status}`
  }

  return undefined
}

export function mapAuditLogToHumanized(
  entries: Array<{
    id: string
    action: AuditAction
    actor_id: string | null
    created_at: string
    old_value: Record<string, unknown> | null
    new_value: Record<string, unknown> | null
    actor?: { display_name: string } | null
  }>
): HumanizedAuditEntry[] {
  return entries.map(entry => ({
    id: entry.id,
    action: entry.action,
    labelFr: ACTION_LABELS[entry.action] || entry.action,
    descriptionFr: getActionDescription(entry.action, entry.new_value),
    iconType: getIconType(entry.action),
    actorName: entry.actor?.display_name,
    isSystem: entry.actor_id === null,
    createdAt: entry.created_at,
    details: entry.new_value || undefined,
    hasDetails: entry.new_value !== null && Object.keys(entry.new_value).length > 0,
  }))
}

// =============================================================================
// ENTITY ID FORMATTING
// Display-only short IDs for UUIDs (7 characters)
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Formats an entity ID for display purposes.
 * Converts UUIDs to 7-character short codes.
 * DISPLAY ONLY - does not modify the actual ID.
 */
export function formatEntityId(id: string | null | undefined): string {
  if (!id) return '—'

  // If it looks like a UUID, return first 7 chars (lowercase, no dashes)
  if (UUID_REGEX.test(id)) {
    return id.replace(/-/g, '').slice(0, 7).toLowerCase()
  }

  // For non-UUID IDs, return as-is (truncated if too long)
  if (id.length > 12) {
    return id.slice(0, 7) + '…'
  }

  return id
}

/**
 * Checks if a string is a valid UUID format
 */
export function isUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

// =============================================================================
// CATEGORY LABELS
// =============================================================================

export const SPECIALTY_CATEGORY_LABELS: Record<string, string> = {
  therapy_type: 'Types de thérapie',
  population: 'Clientèles',
  issue: 'Motifs de consultation',
  modality: 'Modalités',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  photo: 'Photo',
  insurance: 'Assurance',
  license: 'Permis / Consentement',
  cv: 'CV / Contrat',
  diploma: 'Diplôme',
  fiche: 'Fiche',
  other: 'Autre',
}
