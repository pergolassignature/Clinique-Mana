import type { SectionValues } from '../api/self'
import type { ProfessionalRecord } from '../api/parse'
import type { SubmissionSection } from './constants'

/**
 * « Mon profil » (Task 4b.5), pure: the record as the questionnaire's sections hold it, so the page
 * says each section in the questionnaire's words (`ProfileSectionSummary`), and what the page
 * offers next.
 */

/** The questionnaire (4b.4): where an open submission is filled in. */
export const QUESTIONNAIRE_PATH = '/mon-profil/questionnaire'

/** « Mon profil » (4b.5). */
export const MY_PROFILE_PATH = '/mon-profil'

/**
 * The record as `private.professional_submission_snapshot` writes it (20261008191219): the same keys
 * and shapes as a submission's prefill, for the sections the record itself holds.
 */
export function recordSectionValues(record: ProfessionalRecord) {
  const { professional: p, publicProfile: pub, matchingProfile: m } = record
  return {
    personal: {
      personal_phone: p.personalPhone,
      address_line1: p.addressLine1,
      address_line2: p.addressLine2,
      city: p.city,
      province: p.province,
      postal_code: p.postalCode,
    },
    professional: {
      professions: record.professions.map((x) => ({ title_id: x.titleId, licence_number: x.licenceNumber, is_primary: x.isPrimary })),
      years_experience: p.yearsExperience,
    },
    portrait: { bio: pub.bio, approach: pub.approach, public_email: pub.publicEmail, public_phone: pub.publicPhone },
    languages: { language_ids: record.languageIds },
    clienteles: { clienteles: record.clienteles, min_client_age: m.minClientAge, women_only: m.womenOnly },
    motifs: { motif_ids: record.motifIds },
    availability: { accepting_new_clients: m.acceptingNewClients, availability_periods: m.availabilityPeriods, availability_note: m.availabilityNote },
  } satisfies Partial<Record<SubmissionSection, SectionValues>>
}

/**
 * What « Mon profil » offers about the questionnaire:
 * - `inactive`: nothing to start (`start_my_profile_update` refuses an inactive file, P4-303);
 * - `continue`: a draft is open (the onboarding, an update, or a profile sent back with a note);
 * - `sent`: the profile is with the clinic for review;
 * - `update`: nothing open, « Mettre mon profil à jour ».
 */
export type ProfileAction = 'inactive' | 'continue' | 'sent' | 'update'

export function profileAction(status: ProfessionalRecord['professional']['status'], open: { status: 'draft' | 'submitted' } | null): ProfileAction {
  if (open?.status === 'draft') return status === 'inactive' ? 'inactive' : 'continue'
  if (open?.status === 'submitted') return 'sent'
  return status === 'inactive' ? 'inactive' : 'update'
}
