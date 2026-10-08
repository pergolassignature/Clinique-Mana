import { describe, expect, it } from 'vitest'
import type { InvitationInfo, Onboarding } from '../api/parse'
import { clinicDaysSince, displayStatus, invitationLine, onboardingActions, questionnaireLine, shortDate } from './onboarding'

/** Thursday 8 October 2026, 16:00 in Toronto. */
const NOW = Date.parse('2026-10-08T20:00:00Z')
const can = (...keys: string[]) => (permission: string) => keys.includes(permission)
const INVITE = can('professionals.invite')

const invitation = (state: InvitationInfo['state'], extra: Partial<InvitationInfo> = {}): InvitationInfo => ({
  state,
  sentAt: '2026-10-05T14:00:00Z',
  expiresAt: '2026-10-12T14:00:00Z',
  openedAt: null,
  usedAt: null,
  ...extra,
})
const onboarding = (over: Partial<Onboarding> = {}): Onboarding => ({ invitation: null, submission: null, onboardingApproved: false, ...over })

describe('displayStatus (P4-43)', () => {
  it('reads in_review as « À réviser » while a submission waits, « En préparation » once approved with nothing waiting', () => {
    expect(displayStatus('in_review', null)).toBe('in_review')
    expect(displayStatus('in_review', onboarding({ submission: { id: 's', kind: 'onboarding', status: 'submitted', submittedAt: null } }))).toBe('in_review')
    expect(displayStatus('in_review', onboarding({ onboardingApproved: true }))).toBe('preparing')
    expect(displayStatus('in_review', onboarding({ onboardingApproved: true, submission: { id: 's', kind: 'update', status: 'draft', submittedAt: null } }))).toBe(
      'preparing',
    )
    expect(displayStatus('in_review', onboarding({ onboardingApproved: true, submission: { id: 's', kind: 'update', status: 'submitted', submittedAt: null } }))).toBe(
      'in_review',
    )
  })

  it('leaves every other status as stored', () => {
    for (const status of ['draft', 'invited', 'active', 'inactive'] as const) expect(displayStatus(status, onboarding({ onboardingApproved: true }))).toBe(status)
  })
})

describe('onboardingActions', () => {
  const file = (profileId: string | null, status: 'draft' | 'invited' | 'active' | 'inactive' = 'invited') => ({ profileId, status })

  it.each<[string, InvitationInfo | null, ReturnType<typeof onboardingActions>]>([
    ['no link: send', null, { invite: 'send', revoke: false, requestUpdate: false }],
    ['sent: resend or revoke', invitation('sent'), { invite: 'resend', revoke: true, requestUpdate: false }],
    ['opened: resend or revoke', invitation('opened'), { invite: 'resend', revoke: true, requestUpdate: false }],
    ['expired: a new link', invitation('expired'), { invite: 'new_link', revoke: false, requestUpdate: false }],
    ['revoked: send again', invitation('revoked'), { invite: 'send', revoke: false, requestUpdate: false }],
  ])('without an account, %s', (_, link, expected) => {
    expect(onboardingActions(file(null), onboarding({ invitation: link }), INVITE)).toEqual(expected)
  })

  it('an imported active file without an account can be invited (P4-171)', () => {
    expect(onboardingActions(file(null, 'active'), null, INVITE).invite).toBe('send')
  })

  it('with an account: an update request while nothing is open', () => {
    expect(onboardingActions(file('u1', 'active'), null, INVITE)).toEqual({ invite: null, revoke: false, requestUpdate: true })
    const open = onboarding({ submission: { id: 's', kind: 'update', status: 'draft', submittedAt: null } })
    expect(onboardingActions(file('u1', 'active'), open, INVITE).requestUpdate).toBe(false)
  })

  it('nothing for an inactive file (P4-303), nor without professionals.invite', () => {
    expect(onboardingActions(file(null, 'inactive'), null, INVITE)).toEqual({ invite: null, revoke: false, requestUpdate: false })
    expect(onboardingActions(file(null), null, can('professionals.manage'))).toEqual({ invite: null, revoke: false, requestUpdate: false })
  })
})

describe('dates, in the clinic’s timezone', () => {
  it('« 8 oct. » this year, with the year otherwise', () => {
    expect(shortDate('2026-10-08T14:00:00Z', NOW)).toBe('8 oct.')
    expect(shortDate('2025-12-30T14:00:00Z', NOW)).toBe('30 déc. 2025')
    // 1 January 03:00 UTC is still 31 December in Toronto.
    expect(shortDate('2026-01-01T03:00:00Z', NOW)).toBe('31 déc. 2025')
  })

  it('counts clinic days', () => {
    expect(clinicDaysSince('2026-10-08T05:00:00Z', NOW)).toBe(0)
    expect(clinicDaysSince('2026-10-08T03:00:00Z', NOW)).toBe(1)
    expect(clinicDaysSince('2026-10-05T14:00:00Z', NOW)).toBe(3)
  })
})

describe('invitationLine (A2.5)', () => {
  it.each<[InvitationInfo | null, string]>([
    [null, 'Aucune invitation envoyée.'],
    [invitation('sent'), 'Invitation envoyée le 5 oct. · expire le 12 oct.'],
    [invitation('opened', { openedAt: '2026-10-06T14:00:00Z' }), 'Invitation envoyée le 5 oct. · ouverte le 6 oct. · expire le 12 oct.'],
    [invitation('expired'), 'Lien expiré le 12 oct. — envoyez un nouveau lien.'],
    [invitation('used', { usedAt: '2026-10-07T14:00:00Z' }), 'Invitation acceptée le 7 oct.'],
    [invitation('revoked'), 'Invitation révoquée : le lien ne fonctionne plus.'],
  ])('%o', (link, line) => {
    expect(invitationLine(link, NOW)).toBe(line)
  })
})

describe('questionnaireLine', () => {
  it('says where the questionnaire is, nothing once approved', () => {
    expect(questionnaireLine({ profileId: null }, null, NOW)).toBe("S'ouvre quand l'invitation est acceptée.")
    expect(questionnaireLine({ profileId: 'u1' }, onboarding({ submission: { id: 's', kind: 'onboarding', status: 'draft', submittedAt: null } }), NOW)).toBe(
      'En cours : pas encore envoyé.',
    )
    expect(
      questionnaireLine({ profileId: 'u1' }, onboarding({ submission: { id: 's', kind: 'onboarding', status: 'submitted', submittedAt: '2026-10-07T14:00:00Z' } }), NOW),
    ).toBe('Envoyé le 7 oct. — à réviser.')
    expect(questionnaireLine({ profileId: 'u1' }, null, NOW)).toBe('Aucun questionnaire en cours.')
    expect(questionnaireLine({ profileId: 'u1' }, onboarding({ onboardingApproved: true }), NOW)).toBeNull()
  })
})
