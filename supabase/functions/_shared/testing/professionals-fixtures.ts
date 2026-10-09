/**
 * Fixtures for the Professionnels function tests (Task 4b.2): ids, the
 * caller's access and `get_email_context` results for the module's
 * templates (the 4b.1 and 4c.2 seeds' subjects, buttons and variables,
 * shortened bodies). Test-only: never deployed.
 */
import { accessFixture, emailContextFixture } from './email-fixtures.ts'

export const PROFESSIONAL_ID = '00000000-0000-4000-8000-0000000000b1'
export const SUBMISSION_ID = '00000000-0000-4000-8000-0000000000b2'
export const LINK_ID_2 = '00000000-0000-4000-8000-0000000000b3'
export const PROFESSIONAL_EMAIL = 'nadia.cote@exemple.test'
export const PROVIDER_ID = '00000000-0000-4000-8000-0000000000c3'
export const REVIEWER_IDS = [
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d2',
] as const
export const REVIEWER_EMAILS = [
  'revision1@mana.test',
  'revision2@mana.test',
] as const

/** A `get_my_access` payload with the module `professionals` enabled. */
export function professionalsAccess(
  permissions: string[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...accessFixture(permissions),
    modules: ['professionals'],
    ...over,
  }
}

const VARIABLE = {
  'professional.first_name': {
    label: 'Prénom du professionnel',
    sample: 'Nadia',
    kind: 'text',
  },
  'professional.full_name': {
    label: 'Nom du professionnel',
    sample: 'Nadia Côté',
    kind: 'text',
  },
  'clinic.name': {
    label: 'Nom de la clinique',
    sample: 'Clinique MANA',
    kind: 'text',
  },
  'invitation.expires_at': {
    label: 'Fin de validité de l’invitation',
    sample: '15 octobre 2026 à 14 h 30',
    kind: 'datetime',
  },
  'document.expires_on': {
    label: 'Fin de l’assurance',
    sample: '31 mars 2027',
    kind: 'date',
  },
} as const

const TEMPLATES: Record<
  string,
  {
    subject: string
    body: string
    button: string
    paths: (keyof typeof VARIABLE)[]
  }
> = {
  'professionals.invite': {
    subject: 'Bienvenue dans l’équipe de {{clinic.name}}',
    body: 'Bonjour {{professional.first_name}},\n\n' +
      'Valide jusqu’au {{invitation.expires_at}}.',
    button: 'Créer mon accès',
    paths: ['professional.first_name', 'clinic.name', 'invitation.expires_at'],
  },
  'professionals.invite_reminder': {
    subject: 'Votre invitation vous attend',
    body: 'Bonjour {{professional.first_name}},\n\n' +
      'L’équipe de {{clinic.name}} vous attend. ' +
      'Valide jusqu’au {{invitation.expires_at}}.',
    button: 'Créer mon accès',
    paths: ['professional.first_name', 'clinic.name', 'invitation.expires_at'],
  },
  'professionals.profile_update': {
    subject: 'Une petite mise à jour de votre profil',
    body: 'Bonjour {{professional.first_name}},\n\n' +
      'L’équipe de {{clinic.name}} vous demande une mise à jour.',
    button: 'Mettre mon profil à jour',
    paths: ['professional.first_name', 'clinic.name'],
  },
  'professionals.submission_received': {
    subject: '{{professional.full_name}} a envoyé son profil',
    body: 'Bonjour,\n\n{{professional.full_name}} a envoyé son profil.',
    button: 'Réviser le dossier',
    paths: ['professional.full_name'],
  },
  'professionals.document_expiring': {
    subject: 'Votre assurance prend fin le {{document.expires_on}}',
    body: 'Bonjour {{professional.first_name}},\n\n' +
      'Votre preuve chez {{clinic.name}} prend fin le {{document.expires_on}}.',
    button: 'Téléverser ma preuve',
    paths: ['professional.first_name', 'clinic.name', 'document.expires_on'],
  },
  'professionals.document_expired': {
    subject: 'Votre assurance est échue',
    body: 'Bonjour {{professional.first_name}},\n\n' +
      'Votre preuve chez {{clinic.name}} a pris fin le {{document.expires_on}}.',
    button: 'Téléverser ma preuve',
    paths: ['professional.first_name', 'clinic.name', 'document.expires_on'],
  },
  'professionals.document_expired_reminder': {
    subject: 'Rappel : votre preuve d’assurance est attendue',
    body: 'Bonjour {{professional.first_name}},\n\n' +
      'Fin le {{document.expires_on}} ; {{clinic.name}} attend la nouvelle.',
    button: 'Téléverser ma preuve',
    paths: ['professional.first_name', 'clinic.name', 'document.expires_on'],
  },
}

/** `get_email_context` for one of the module's templates. */
export function professionalsEmailContext(
  key: string,
): Record<string, unknown> {
  const t = TEMPLATES[key]
  if (!t) throw new Error(`no fixture for ${key}`)
  return emailContextFixture({
    module_key: 'professionals',
    template: {
      key,
      subject: t.subject,
      body: t.body,
      button_label: t.button,
      why_line: 'Vous recevez ce courriel parce que la clinique vous écrit.',
      variables: t.paths.map((path) => ({
        path,
        ...VARIABLE[path],
        required: true,
      })),
      view_permission: 'professionals.view',
    },
  })
}
