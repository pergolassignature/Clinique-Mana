import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { INVITATION_UNANSWERED_DAYS, recordWatchSubject, WATCH_TAB, watchFlags, type WatchSubject } from './watch'
import type { InvitationInfo, Onboarding } from '../api/parse'
import { listRowFixture, recordFixture } from '../test/fixtures-domain'

const subject = (overrides: Partial<WatchSubject> = {}): WatchSubject => ({
  status: 'active',
  matchingComplete: true,
  emailMatchesLogin: true,
  hasAccount: true,
  onboarding: null,
  ...overrides,
})

/** Thursday 8 October 2026, 16:00 in Toronto. */
const NOW = Date.parse('2026-10-08T20:00:00Z')

const invited = (state: InvitationInfo['state'], sentAt = '2026-10-05T14:00:00Z'): Onboarding => ({
  invitation: { state, sentAt, expiresAt: '2026-10-12T14:00:00Z', openedAt: null, usedAt: null, delivery: 'email', emailStatus: 'sent', emailError: null },
  submission: null,
  onboardingApproved: false,
})

describe('watchFlags: the invitation email (P4-490)', () => {
  const link = (extra: Partial<InvitationInfo>): Onboarding => {
    const base = invited('sent', '2026-10-01T14:00:00Z')
    return { ...base, invitation: base.invitation && { ...base.invitation, ...extra } }
  }
  const keys = (onboarding: Onboarding) => watchFlags(subject({ hasAccount: false, status: 'invited', onboarding }), NOW)

  it('an email that did not leave: « Courriel d’invitation non parti », danger, never « sans réponse »', () => {
    expect(keys(link({ emailStatus: null, emailError: 'not_configured' }))).toEqual([
      { key: 'invitation_not_sent', label: "Courriel d'invitation non parti", tone: 'danger' },
    ])
    expect(keys(link({ emailStatus: 'bounced' })).map((f) => f.key)).toEqual(['invitation_not_sent'])
  })

  it('an unknown outcome: its own flag; a copied link waits like a sent one', () => {
    expect(keys(link({ emailStatus: 'failed', emailError: 'provider_unavailable' })).map((f) => f.key)).toEqual(['invitation_unknown'])
    expect(keys(link({ delivery: 'copied', emailStatus: null })).map((f) => f.key)).toEqual(['invitation_unanswered'])
    expect(keys(link({ emailStatus: 'delivered' })).map((f) => f.key)).toEqual(['invitation_unanswered'])
  })
})

describe('watchFlags', () => {
  it.each<[string, Partial<WatchSubject>, string[]]>([
    ['nothing to report', {}, []],
    ['incomplete matching profile', { matchingComplete: false }, ['matching_incomplete']],
    ['login email differs', { emailMatchesLogin: false }, ['login_email_mismatch']],
    ['both, matching first', { matchingComplete: false, emailMatchesLogin: false }, ['matching_incomplete', 'login_email_mismatch']],
    ['an inactive file is not watched', { status: 'inactive', matchingComplete: false, emailMatchesLogin: false }, []],
    ['a draft is watched', { status: 'draft', matchingComplete: false }, ['matching_incomplete']],
  ])('%s', (_, overrides, keys) => {
    expect(watchFlags(subject(overrides), NOW).map((f) => f.key)).toEqual(keys)
  })

  it('labels and tones the flags', () => {
    expect(watchFlags(subject({ matchingComplete: false }), NOW)).toEqual([
      { key: 'matching_incomplete', label: t('modules.professionals.watch.matching_incomplete'), tone: 'muted' },
    ])
  })

  it('reads a list row as is', () => {
    expect(watchFlags(listRowFixture({ matchingComplete: false }), NOW).map((f) => f.key)).toEqual(['matching_incomplete'])
  })
})

describe('watchFlags: the onboarding (Task 4b.3)', () => {
  const noAccount = { status: 'invited' as const, hasAccount: false }

  it(`an invitation sent ${INVITATION_UNANSWERED_DAYS} clinic days ago and never opened: « sans réponse depuis 3 jours »`, () => {
    expect(watchFlags(subject({ ...noAccount, onboarding: invited('sent') }), NOW)).toEqual([
      { key: 'invitation_unanswered', label: 'Invitation sans réponse depuis 3 jours', tone: 'muted' },
    ])
  })

  it('not before, nor once opened', () => {
    expect(watchFlags(subject({ ...noAccount, onboarding: invited('sent', '2026-10-06T14:00:00Z') }), NOW)).toEqual([])
    expect(watchFlags(subject({ ...noAccount, onboarding: invited('opened') }), NOW)).toEqual([])
  })

  it('counts clinic days: 23:30 in Toronto is still that day', () => {
    // 2026-10-06 03:30 UTC is 5 October, 23:30 in Toronto: three days before 8 October.
    expect(watchFlags(subject({ ...noAccount, onboarding: invited('sent', '2026-10-06T03:30:00Z') }), NOW).map((f) => f.key)).toEqual(['invitation_unanswered'])
  })

  it('an expired link, also one still read as sent once its expiry has passed', () => {
    expect(watchFlags(subject({ ...noAccount, onboarding: invited('expired') }), NOW).map((f) => f.label)).toEqual(['Invitation expirée'])
    expect(watchFlags(subject({ ...noAccount, onboarding: invited('sent') }), Date.parse('2026-10-12T14:00:00Z')).map((f) => f.key)).toEqual(['invitation_expired'])
  })

  it('no invitation flag once there is an account, nor for an inactive file', () => {
    expect(watchFlags(subject({ onboarding: invited('expired') }), NOW)).toEqual([])
    expect(watchFlags(subject({ ...noAccount, status: 'inactive', onboarding: invited('expired') }), NOW)).toEqual([])
  })

  it('a submission waiting for review comes first: « Dossier à réviser », « Mise à jour à réviser »', () => {
    const waiting = (kind: 'onboarding' | 'update'): Onboarding => ({
      invitation: null,
      submission: { id: 's1', kind, status: 'submitted', submittedAt: '2026-10-07T12:00:00Z' },
      onboardingApproved: kind === 'update',
    })
    expect(watchFlags(subject({ status: 'in_review', matchingComplete: false, onboarding: waiting('onboarding') }), NOW).map((f) => f.label)).toEqual([
      'Dossier à réviser',
      'Profil de jumelage incomplet',
    ])
    expect(watchFlags(subject({ onboarding: waiting('update') }), NOW).map((f) => f.label)).toEqual(['Mise à jour à réviser'])
    // A draft is not waiting for anyone on staff.
    const draft: Onboarding = { ...waiting('update'), submission: { id: 's1', kind: 'update', status: 'draft', submittedAt: null } }
    expect(watchFlags(subject({ onboarding: draft }), NOW)).toEqual([])
  })

  it('the invitation flags are settled on Aperçu itself; the review ones in Documents (4b.5)', () => {
    expect(WATCH_TAB.invitation_expired).toBeUndefined()
    expect(WATCH_TAB.invitation_unanswered).toBeUndefined()
    expect(WATCH_TAB.submission_to_review).toBe('documents')
    expect(WATCH_TAB.update_to_review).toBe('documents')
    expect(WATCH_TAB.matching_incomplete).toBe('jumelage')
  })
})

describe('recordWatchSubject', () => {
  it('reads the record’s readiness item and warnings, its account and its onboarding', () => {
    const record = recordFixture()
    expect(recordWatchSubject(record, null)).toEqual({
      status: 'draft',
      matchingComplete: false,
      emailMatchesLogin: true,
      hasAccount: false,
      onboarding: null,
      insuranceStatus: null,
      insuranceExpiresOn: null,
    })
    const complete = {
      ...record,
      professional: { ...record.professional, profileId: 'user-1' },
      readiness: { ...record.readiness, items: [{ key: 'matching_profile' as const, done: true, missing: [] }], warnings: ['login_email_mismatch' as const] },
    }
    const onboarding = invited('used')
    expect(recordWatchSubject(complete, onboarding)).toEqual({
      status: 'draft',
      matchingComplete: true,
      emailMatchesLogin: false,
      hasAccount: true,
      onboarding,
      insuranceStatus: null,
      insuranceExpiresOn: null,
    })
  })
})

describe('watchFlags: the insurance (4c, P4-406)', () => {
  it('expiring: « Assurance expire le … », its last valid day, danger, after the review', () => {
    const waiting: Onboarding = { invitation: null, submission: { id: 's1', kind: 'update', status: 'submitted', submittedAt: '2026-10-07T14:00:00Z' }, onboardingApproved: true }
    expect(watchFlags(subject({ insuranceStatus: 'expiring', insuranceExpiresOn: '2026-10-12', onboarding: waiting }), NOW)).toEqual([
      { key: 'update_to_review', label: 'Mise à jour à réviser', tone: 'muted' },
      { key: 'insurance_expiring', label: 'Assurance expire le 12 oct. 2026', tone: 'danger' },
    ])
  })

  it('expired: « Assurance expirée depuis le … », the day after its last valid day, first of all', () => {
    const flags = watchFlags(subject({ insuranceStatus: 'expired', insuranceExpiresOn: '2026-10-05', matchingComplete: false }), NOW)
    expect(flags[0]).toEqual({ key: 'insurance_expired', label: 'Assurance expirée depuis le 6 oct. 2026', tone: 'danger' })
    expect(flags.map((f) => f.key)).toEqual(['insurance_expired', 'matching_incomplete'])
  })

  it('valid, missing, no date or an inactive file: nothing', () => {
    expect(watchFlags(subject({ insuranceStatus: 'valid', insuranceExpiresOn: '2027-03-31' }), NOW)).toEqual([])
    expect(watchFlags(subject({ insuranceStatus: 'missing', insuranceExpiresOn: null }), NOW)).toEqual([])
    expect(watchFlags(subject({ insuranceStatus: 'expired', insuranceExpiresOn: null }), NOW)).toEqual([])
    expect(watchFlags(subject({ status: 'inactive', insuranceStatus: 'expired', insuranceExpiresOn: '2026-10-05' }), NOW)).toEqual([])
  })

  it('both flags open « Documents »', () => {
    expect(WATCH_TAB.insurance_expired).toBe('documents')
    expect(WATCH_TAB.insurance_expiring).toBe('documents')
  })

  it('a list row and a record read the same state', () => {
    const row = { ...listRowFixture(), insuranceStatus: 'expired' as const, insuranceExpiresOn: '2026-10-05' }
    expect(watchFlags(row, NOW).map((f) => f.key)).toContain('insurance_expired')
    const record = recordFixture()
    const withInsurance = { ...record, readiness: { ...record.readiness, insurance: { status: 'expiring' as const, expires_on: '2026-10-12' } } }
    expect(recordWatchSubject(withInsurance, null)).toMatchObject({ insuranceStatus: 'expiring', insuranceExpiresOn: '2026-10-12' })
  })
})
