import { describe, expect, it } from 'vitest'
import type { InvitationInfo, Onboarding } from '../api/parse'
import {
  clinicDaysSince,
  displayStatus,
  EMAIL_PENDING_MS,
  emailFailureReason,
  invitationEmail,
  invitationLine,
  invitationState,
  isLiveInvitation,
  onboardingActions,
  questionnaireLine,
  shortDate,
  type InvitationEmail,
} from './onboarding'

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
  delivery: 'email',
  emailStatus: 'sent',
  emailError: null,
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
    ['no link: send', null, { invite: 'send', revoke: false, requestUpdate: false, copyLink: true }],
    ['sent: resend or revoke', invitation('sent'), { invite: 'resend', revoke: true, requestUpdate: false, copyLink: true }],
    ['opened: resend or revoke', invitation('opened'), { invite: 'resend', revoke: true, requestUpdate: false, copyLink: true }],
    ['expired: a new link', invitation('expired'), { invite: 'new_link', revoke: false, requestUpdate: false, copyLink: true }],
    ['revoked: send again', invitation('revoked'), { invite: 'send', revoke: false, requestUpdate: false, copyLink: true }],
  ])('without an account, %s', (_, link, expected) => {
    expect(onboardingActions(file(null), onboarding({ invitation: link }), INVITE, NOW)).toEqual(expected)
  })

  it('a link read as sent but past its expiry offers a new link, without a refetch', () => {
    const lapsed = invitation('sent', { expiresAt: '2026-10-08T19:00:00Z' })
    expect(onboardingActions(file(null), onboarding({ invitation: lapsed }), INVITE, NOW)).toEqual({ invite: 'new_link', revoke: false, requestUpdate: false, copyLink: true })
  })

  it('an imported active file without an account can be invited (P4-171)', () => {
    expect(onboardingActions(file(null, 'active'), null, INVITE, NOW).invite).toBe('send')
  })

  it('with an account: an update request while nothing is open', () => {
    expect(onboardingActions(file('u1', 'active'), null, INVITE)).toEqual({ invite: null, revoke: false, requestUpdate: true, copyLink: false })
    const open = onboarding({ submission: { id: 's', kind: 'update', status: 'draft', submittedAt: null } })
    expect(onboardingActions(file('u1', 'active'), open, INVITE).requestUpdate).toBe(false)
  })

  it('nothing for an inactive file (P4-303), nor without professionals.invite', () => {
    expect(onboardingActions(file(null, 'inactive'), null, INVITE)).toEqual({ invite: null, revoke: false, requestUpdate: false, copyLink: false })
    expect(onboardingActions(file(null), null, can('professionals.manage'))).toEqual({ invite: null, revoke: false, requestUpdate: false, copyLink: false })
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
    [invitation('expired'), 'Lien expiré le 12 oct. : envoyez un nouveau lien.'],
    [invitation('used', { usedAt: '2026-10-07T14:00:00Z' }), 'Invitation acceptée le 7 oct.'],
    [invitation('revoked'), 'Invitation révoquée : le lien ne fonctionne plus.'],
  ])('%o', (link, line) => {
    expect(invitationLine(link, NOW)).toBe(line)
  })
})

describe('invitationEmail: never « envoyée » without an email (P4-490)', () => {
  const email = (emailStatus: string | null, emailError: string | null, extra: Partial<InvitationInfo> = {}) =>
    invitationEmail(invitation('sent', { emailStatus, emailError, ...extra }), NOW)

  it.each<[string, string | null, string | null, InvitationEmail]>([
    ['queued', 'queued', null, { kind: 'sent' }],
    ['sent', 'sent', null, { kind: 'sent' }],
    ['delivered', 'delivered', null, { kind: 'sent' }],
    ['delayed', 'delivery_delayed', null, { kind: 'sent' }],
    ['outcome unknown', 'failed', 'provider_unavailable', { kind: 'unknown' }],
    ['bounced', 'bounced', null, { kind: 'failed', reason: 'refused' }],
    ['address refused by the provider', 'failed', 'invalid_recipient', { kind: 'failed', reason: 'refused' }],
    ['rejected', 'failed', 'provider_rejected', { kind: 'failed', reason: 'other' }],
    ['not queued: not configured', null, 'not_configured', { kind: 'failed', reason: 'not_configured' }],
    ['not queued: module off', null, 'module_disabled', { kind: 'failed', reason: 'not_configured' }],
    ['not queued: address refused', null, 'invalid_recipient', { kind: 'failed', reason: 'refused' }],
    ['not queued: limit', null, 'rate_limited', { kind: 'failed', reason: 'rate_limited' }],
    ['not queued: internal', null, 'internal', { kind: 'failed', reason: 'other' }],
  ])('%s', (_, status, error, expected) => {
    expect(email(status, error)).toEqual(expected)
  })

  it('no email at all: pending for two minutes after the link, then « pas parti »', () => {
    expect(email(null, null, { sentAt: new Date(NOW - EMAIL_PENDING_MS + 1000).toISOString() })).toEqual({ kind: 'pending' })
    expect(email(null, null, { sentAt: new Date(NOW - EMAIL_PENDING_MS).toISOString() })).toEqual({ kind: 'failed', reason: 'other' })
    // Olivier on staging: no Resend key, no email_log row, no stamp (a link issued before P4-490).
    expect(email(null, null)).toEqual({ kind: 'failed', reason: 'other' })
  })

  it('a copied link expects no email', () => {
    expect(email(null, null, { delivery: 'copied' })).toEqual({ kind: 'copied' })
  })

  it('the « Dossier » line says how the link was handed over', () => {
    const line = (extra: Partial<InvitationInfo>) => invitationLine(invitation('sent', extra), NOW)
    expect(line({ emailStatus: null, emailError: 'not_configured' })).toBe("Courriel d'invitation non parti · lien créé le 5 oct., expire le 12 oct.")
    expect(line({ delivery: 'copied', emailStatus: null })).toBe("Lien d'invitation copié le 5 oct. · expire le 12 oct.")
    expect(line({ emailStatus: 'failed', emailError: 'provider_unavailable' })).toBe('Invitation du 5 oct. : Résultat inconnu · expire le 12 oct.')
    expect(line({ emailStatus: null, sentAt: new Date(NOW - 1000).toISOString() })).toBe("Envoi de l'invitation en cours · expire le 12 oct.")
    // Opened: the link reached her, whatever the email says.
    expect(invitationLine(invitation('opened', { openedAt: '2026-10-06T14:00:00Z', emailStatus: null, emailError: 'not_configured' }), NOW)).toBe(
      'Invitation envoyée le 5 oct. · ouverte le 6 oct. · expire le 12 oct.',
    )
  })

  it('the reasons in plain words', () => {
    expect(emailFailureReason('not_configured')).toBe("La clinique n'a pas encore configuré l'envoi de courriels (Paramètres → Courriels).")
    expect(emailFailureReason('refused')).toBe("L'adresse a refusé le courriel.")
  })
})

describe('invitationState: the link as of now', () => {
  it('a sent or opened link whose expiry has passed is expired; the others read as stored', () => {
    const lapsedAt = { expiresAt: '2026-10-08T20:00:00Z' }
    expect(invitationState(invitation('sent', lapsedAt), NOW)).toBe('expired')
    expect(invitationState(invitation('opened', lapsedAt), NOW)).toBe('expired')
    expect(invitationState(invitation('sent'), NOW)).toBe('sent')
    expect(invitationState(invitation('used', lapsedAt), NOW)).toBe('used')
    expect(invitationState(invitation('revoked', lapsedAt), NOW)).toBe('revoked')
    expect(invitationState(null, NOW)).toBeNull()
    expect(isLiveInvitation(invitation('sent', lapsedAt), NOW)).toBe(false)
    expect(isLiveInvitation(invitation('opened'), NOW)).toBe(true)
  })

  it('« Lien expiré » for a link past its expiry, before the server says so', () => {
    expect(invitationLine(invitation('sent', { expiresAt: '2026-10-08T14:00:00Z' }), NOW)).toBe('Lien expiré le 8 oct. : envoyez un nouveau lien.')
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
    ).toBe('Envoyé le 7 oct., à réviser.')
    expect(questionnaireLine({ profileId: 'u1' }, null, NOW)).toBe('Aucun questionnaire en cours.')
    expect(questionnaireLine({ profileId: 'u1' }, onboarding({ onboardingApproved: true }), NOW)).toBeNull()
  })

  it('an update open on a file without an approved questionnaire reads the same way, never « Aucun questionnaire en cours » (P4-497)', () => {
    const update = (status: 'draft' | 'submitted', submittedAt: string | null) => onboarding({ submission: { id: 's', kind: 'update', status, submittedAt } })
    expect(questionnaireLine({ profileId: 'u1' }, update('submitted', '2026-10-07T14:00:00Z'), NOW)).toBe('Mise à jour envoyée le 7 oct., à réviser.')
    expect(questionnaireLine({ profileId: 'u1' }, update('submitted', null), NOW)).toBe('Mise à jour envoyée, à réviser.')
    expect(questionnaireLine({ profileId: 'u1' }, update('draft', null), NOW)).toBe('Mise à jour en cours : pas encore envoyée.')
    // Once the onboarding questionnaire was approved, the item is done: no line.
    expect(questionnaireLine({ profileId: 'u1' }, { ...update('submitted', '2026-10-07T14:00:00Z'), onboardingApproved: true }, NOW)).toBeNull()
  })
})
