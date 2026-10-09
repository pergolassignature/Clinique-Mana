import { t } from '@/i18n'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import type { InsuranceStatus, ProfessionalStatus, RecordTab } from './constants'
import type { Onboarding, ProfessionalRecord } from '../api/parse'
import { clinicDaysSince, invitationEmail, invitationState } from './onboarding'

/**
 * « À surveiller »: what staff should look at, for the list column, the filter and Aperçu.
 * 4a flags (muted): an incomplete matching profile, a login email that differs from the record's
 * (decision #38 leaves it). 4b (Task 4b.3): a submission waiting for review (« Dossier à
 * réviser », « Mise à jour à réviser »), an expired invitation link, an invitation unanswered for
 * INVITATION_UNANSWERED_DAYS; an invitation email that did not leave (danger) or whose outcome is
 * unknown (P4-490, as Aperçu says). 4c: the insurance expiring (within its reminder days) or
 * expired (danger), from `insurance_status` / `insurance_expires_on` (the list's columns, the
 * record's `readiness.insurance`). Inactive files are not watched.
 */
type WatchFlagKey =
  | 'insurance_expired'
  | 'insurance_expiring'
  | 'submission_to_review'
  | 'update_to_review'
  | 'invitation_expired'
  | 'invitation_not_sent'
  | 'invitation_unknown'
  | 'invitation_unanswered'
  | 'matching_incomplete'
  | 'login_email_mismatch'

/**
 * Where Aperçu « À surveiller » sends each flag: the tab that fixes it. The invitation flags are
 * settled on Aperçu itself (« Prochaine action », the header's menu): plain text; the review ones
 * in « Documents » (Task 4b.5).
 */
export const WATCH_TAB: Readonly<Partial<Record<WatchFlagKey, RecordTab>>> = {
  submission_to_review: 'documents',
  update_to_review: 'documents',
  matching_incomplete: 'jumelage',
  login_email_mismatch: 'identite',
  insurance_expired: 'documents',
  insurance_expiring: 'documents',
}

/** An invitation is « sans réponse » after this many clinic days without being opened (Task 4b.3). */
export const INVITATION_UNANSWERED_DAYS = 3

interface WatchFlag {
  key: WatchFlagKey
  label: string
  tone: 'danger' | 'muted'
}

/** What the flags read; a list row has these fields, a record goes through `recordWatchSubject`. */
export interface WatchSubject {
  status: ProfessionalStatus
  matchingComplete: boolean
  emailMatchesLogin: boolean
  hasAccount: boolean
  /** From `list_professional_invitation_states` (list) or `get_professional_onboarding` (record). */
  onboarding: Onboarding | null
  /** The insurance's state and last valid day (`yyyy-MM-dd`); absent or null: nothing to say. */
  insuranceStatus?: InsuranceStatus | null
  insuranceExpiresOn?: string | null
}

const W = 'modules.professionals.watch'

/** The onboarding flags: a review waiting first, then the invitation that needs staff. */
function onboardingFlags({ hasAccount, onboarding }: WatchSubject, now: number): WatchFlag[] {
  const flags: WatchFlag[] = []
  const submission = onboarding?.submission
  if (submission?.status === 'submitted') {
    const key = submission.kind === 'onboarding' ? 'submission_to_review' : 'update_to_review'
    flags.push({ key, label: t(`${W}.${key}`), tone: 'muted' })
  }
  const invitation = onboarding?.invitation
  if (hasAccount || !invitation) return flags
  // As of `now`: a link past its expiry is expired before the next refetch says so.
  const state = invitationState(invitation, now)
  if (state === 'expired') flags.push({ key: 'invitation_expired', label: t(`${W}.invitation_expired`), tone: 'muted' })
  const email = state === 'sent' ? invitationEmail(invitation, now) : null
  if (email?.kind === 'failed') flags.push({ key: 'invitation_not_sent', label: t(`${W}.invitation_not_sent`), tone: 'danger' })
  if (email?.kind === 'unknown') flags.push({ key: 'invitation_unknown', label: t(`${W}.invitation_unknown`), tone: 'muted' })
  if (email?.kind === 'sent' || email?.kind === 'copied') {
    const days = clinicDaysSince(invitation.sentAt, now)
    if (days >= INVITATION_UNANSWERED_DAYS) {
      flags.push({ key: 'invitation_unanswered', label: t(`${W}.invitation_unanswered`, { count: String(days) }), tone: 'muted' })
    }
  }
  return flags
}

/**
 * The insurance's flag: « Assurance expire le 12 oct. 2026 » (its last valid day) or « Assurance
 * expirée depuis le 6 oct. 2026 » (the day after it). An expired one comes first of all.
 */
function insuranceFlag({ insuranceStatus, insuranceExpiresOn }: WatchSubject): WatchFlag | null {
  if (!insuranceExpiresOn || (insuranceStatus !== 'expiring' && insuranceStatus !== 'expired')) return null
  if (insuranceStatus === 'expiring') {
    return { key: 'insurance_expiring', label: t(`${W}.insurance_expiring`, { date: formatDateOnlyShort(insuranceExpiresOn) }), tone: 'danger' }
  }
  const since = formatDateOnlyShort(shiftCalendarDay(insuranceExpiresOn, 1))
  return { key: 'insurance_expired', label: t(`${W}.insurance_expired`, { date: since }), tone: 'danger' }
}

/** The flags, most important first (the list shows the first one). `now` dates the invitation's silence. */
export function watchFlags(subject: WatchSubject, now: number = Date.now()): WatchFlag[] {
  if (subject.status === 'inactive') return []
  const insurance = insuranceFlag(subject)
  const flags = [...(insurance && insurance.key === 'insurance_expired' ? [insurance] : []), ...onboardingFlags(subject, now)]
  if (insurance && insurance.key === 'insurance_expiring') flags.push(insurance)
  if (!subject.matchingComplete) flags.push({ key: 'matching_incomplete', label: t(`${W}.matching_incomplete`), tone: 'muted' })
  if (!subject.emailMatchesLogin) flags.push({ key: 'login_email_mismatch', label: t(`${W}.login_email_mismatch`), tone: 'muted' })
  return flags
}

/** The watch subject of a record (its readiness carries the same facts as a list row). */
export function recordWatchSubject(record: Pick<ProfessionalRecord, 'professional' | 'readiness'>, onboarding: Onboarding | null): WatchSubject {
  return {
    status: record.professional.status,
    matchingComplete: record.readiness.items.find((i) => i.key === 'matching_profile')?.done ?? false,
    emailMatchesLogin: !record.readiness.warnings.includes('login_email_mismatch'),
    hasAccount: record.professional.profileId !== null,
    onboarding,
    insuranceStatus: record.readiness.insurance?.status ?? null,
    insuranceExpiresOn: record.readiness.insurance?.expires_on ?? null,
  }
}
