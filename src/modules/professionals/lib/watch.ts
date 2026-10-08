import { t } from '@/i18n'
import type { ProfessionalStatus, RecordTab } from './constants'
import type { Onboarding, ProfessionalRecord } from '../api/parse'
import { clinicDaysSince, invitationState } from './onboarding'

/**
 * « À surveiller »: what staff should look at, for the list column, the filter and Aperçu.
 * 4a flags (muted): an incomplete matching profile, a login email that differs from the record's
 * (decision #38 leaves it). 4b (Task 4b.3): a submission waiting for review (« Dossier à
 * réviser », « Mise à jour à réviser »), an expired invitation link, an invitation unanswered for
 * INVITATION_UNANSWERED_DAYS. 4c adds the insurance flags (danger). Inactive files are not watched.
 */
export type WatchFlagKey =
  | 'submission_to_review'
  | 'update_to_review'
  | 'invitation_expired'
  | 'invitation_unanswered'
  | 'matching_incomplete'
  | 'login_email_mismatch'

/**
 * Where Aperçu « À surveiller » sends each flag: the tab that fixes it. The invitation flags are
 * settled on Aperçu itself (« Prochaine action », the header's menu), the review ones in
 * « Documents » once 4b.5 adds it: plain text until then.
 */
export const WATCH_TAB: Readonly<Partial<Record<WatchFlagKey, RecordTab>>> = {
  matching_incomplete: 'jumelage',
  login_email_mismatch: 'identite',
}

/** An invitation is « sans réponse » after this many clinic days without being opened (Task 4b.3). */
export const INVITATION_UNANSWERED_DAYS = 3

export interface WatchFlag {
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
  if (state === 'sent') {
    const days = clinicDaysSince(invitation.sentAt, now)
    if (days >= INVITATION_UNANSWERED_DAYS) {
      flags.push({ key: 'invitation_unanswered', label: t(`${W}.invitation_unanswered`, { count: String(days) }), tone: 'muted' })
    }
  }
  return flags
}

/** The flags, most important first (the list shows the first one). `now` dates the invitation's silence. */
export function watchFlags(subject: WatchSubject, now: number = Date.now()): WatchFlag[] {
  if (subject.status === 'inactive') return []
  const flags = onboardingFlags(subject, now)
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
  }
}
