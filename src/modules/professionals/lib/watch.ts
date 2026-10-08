import { t } from '@/i18n'
import type { ProfessionalStatus, RecordTab } from './constants'
import type { ProfessionalRecord } from '../api/parse'

/**
 * « À surveiller »: what staff should look at, for the list column, the filter and Aperçu.
 * 4a flags (muted): an incomplete matching profile, a login email that differs from the record's
 * (decision #38 leaves it). 4b adds invitation_pending and review_pending; 4c the insurance flags
 * (danger). Inactive files are not watched.
 */
export type WatchFlagKey = 'matching_incomplete' | 'login_email_mismatch'

/** Where Aperçu « À surveiller » sends each flag: the tab that fixes it. */
export const WATCH_TAB: Readonly<Record<WatchFlagKey, RecordTab>> = {
  matching_incomplete: 'jumelage',
  login_email_mismatch: 'identite',
}

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
}

/** The flags, most important first (the list shows the first one). */
export function watchFlags(subject: WatchSubject): WatchFlag[] {
  if (subject.status === 'inactive') return []
  const flags: WatchFlag[] = []
  if (!subject.matchingComplete) flags.push({ key: 'matching_incomplete', label: t('modules.professionals.watch.matching_incomplete'), tone: 'muted' })
  if (!subject.emailMatchesLogin) flags.push({ key: 'login_email_mismatch', label: t('modules.professionals.watch.login_email_mismatch'), tone: 'muted' })
  return flags
}

/** The watch subject of a record (its readiness carries the same facts as a list row). */
export function recordWatchSubject(record: Pick<ProfessionalRecord, 'professional' | 'readiness'>): WatchSubject {
  return {
    status: record.professional.status,
    matchingComplete: record.readiness.items.find((i) => i.key === 'matching_profile')?.done ?? false,
    emailMatchesLogin: !record.readiness.warnings.includes('login_email_mismatch'),
  }
}
