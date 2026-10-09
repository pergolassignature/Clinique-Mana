import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { MISSING_TAB, missingLabel, nextAction, readinessItemLabel, warningLabel } from './readiness'
import { READINESS_DOCUMENT_MISSING, READINESS_MISSING } from './constants'
import { recordFixture } from '../test/fixtures-domain'
import type { InvitationInfo, Onboarding, ProfessionalRecord } from '../api/parse'
import type { ReadinessMissing } from './constants'

const T = (key: Parameters<typeof t>[0]) => t(key)

/** A complete file has an account (`account_created` is one of its items since 4b.1). */
function withReadiness(missing: ReadinessMissing[], status: ProfessionalRecord['professional']['status'] = 'draft'): ProfessionalRecord {
  const record = recordFixture()
  return {
    ...record,
    professional: { ...record.professional, status, profileId: missing.length === 0 ? 'user-1' : null },
    readiness: { ...record.readiness, complete: missing.length === 0, done: missing.length === 0 ? 1 : 0, items: [{ key: 'matching_profile', done: missing.length === 0, missing }] },
  }
}

const can = (...keys: string[]) => (permission: string) => keys.includes(permission)
/** Thursday 8 October 2026, 16:00 in Toronto. */
const NOW = Date.parse('2026-10-08T20:00:00Z')

describe('labels', () => {
  it('names the item, each gap and the warning', () => {
    expect(readinessItemLabel('matching_profile')).toBe('Profil de jumelage complet')
    expect(missingLabel('profession')).toBe('un titre professionnel')
    expect(missingLabel('licence')).toBe('le numéro de permis')
    expect(warningLabel('login_email_mismatch')).toBe(T('modules.professionals.readiness.warnings.login_email_mismatch'))
  })

  it('sends every gap to the tab that fixes it', () => {
    expect(READINESS_MISSING.map((m) => MISSING_TAB[m])).toEqual(['identite', 'identite', 'identite', 'jumelage', 'jumelage', 'jumelage'])
    expect(READINESS_DOCUMENT_MISSING.map((m) => MISSING_TAB[m])).toEqual(['documents', 'documents', 'documents', 'documents', 'documents'])
  })

  it('names the documents item and its gaps (4c.2)', () => {
    expect(readinessItemLabel('documents')).toBe('Documents requis en règle')
    expect(missingLabel('insurance')).toBe('la preuve d\'assurance')
    expect(missingLabel('insurance_expired')).toBe('une preuve d\'assurance en vigueur')
    for (const key of READINESS_DOCUMENT_MISSING) expect(missingLabel(key)).not.toContain('modules.professionals')
  })
})

describe('nextAction', () => {
  it.each<[string, ReadinessMissing[], ProfessionalRecord['professional']['status'], string[], ReturnType<typeof nextAction>]>([
    [
      'matching gaps → Jumelage, for a matching editor',
      ['clientele', 'motif'],
      'draft',
      ['professionals.matching'],
      { message: T('modules.professionals.readiness.nextAction.completeMatching'), action: { kind: 'tab', label: T('modules.professionals.readiness.nextAction.complete'), tab: 'jumelage' } },
    ],
    ['matching gaps, read-only: the sentence alone', ['motif'], 'draft', [], { message: T('modules.professionals.readiness.nextAction.completeMatching'), action: null }],
    [
      'document gaps → Documents, for whoever uploads (4c.3)',
      ['photo', 'insurance_expired'],
      'draft',
      ['professionals.manage', 'professionals.matching'],
      { message: T('modules.professionals.readiness.nextAction.completeDocuments'), action: { kind: 'tab', label: T('modules.professionals.readiness.nextAction.complete'), tab: 'documents' } },
    ],
    [
      'document gaps, without professionals.manage: the sentence alone',
      ['image_consent'],
      'draft',
      ['professionals.matching'],
      { message: T('modules.professionals.readiness.nextAction.completeDocuments'), action: null },
    ],
    [
      'identity gaps first → Identité et permis, for a manager',
      ['licence', 'motif'],
      'invited',
      ['professionals.manage', 'professionals.matching'],
      { message: T('modules.professionals.readiness.nextAction.completeIdentity'), action: { kind: 'tab', label: T('modules.professionals.readiness.nextAction.complete'), tab: 'identite' } },
    ],
    [
      'complete and not active: « Activer » opens the activation (P4-74)',
      [],
      'draft',
      ['professionals.manage'],
      { message: T('modules.professionals.readiness.nextAction.readyToActivate'), action: { kind: 'activate', label: T('modules.professionals.record.actions.activate') } },
    ],
    [
      'complete and inactive: « Réactiver »',
      [],
      'inactive',
      ['professionals.manage'],
      { message: T('modules.professionals.readiness.nextAction.readyToReactivate'), action: { kind: 'activate', label: T('modules.professionals.record.actions.reactivate') } },
    ],
    ['complete, without manage: the sentence alone', [], 'in_review', ['professionals.matching'], { message: T('modules.professionals.readiness.nextAction.readyToActivate'), action: null }],
    ['active: nothing to do', [], 'active', ['professionals.manage'], { message: T('modules.professionals.readiness.nextAction.nothingToDo'), action: null }],
  ])('%s', (_, missing, status, keys, expected) => {
    expect(nextAction(withReadiness(missing, status), null, can(...keys), NOW)).toEqual(expected)
  })

  it('names the two onboarding items (4b.1)', () => {
    expect(readinessItemLabel('account_created')).toBe('Compte créé (invitation acceptée)')
    expect(readinessItemLabel('submission_approved')).toBe('Questionnaire approuvé')
  })
})

describe('nextAction with the onboarding (Task 4b.3)', () => {
  const N = 'modules.professionals.readiness.nextAction'
  const INVITE = ['professionals.invite', 'professionals.manage', 'professionals.matching']

  /** Matching done; account and questionnaire still to come. */
  function onboardingFile(profileId: string | null = null, status: ProfessionalRecord['professional']['status'] = 'invited'): ProfessionalRecord {
    const record = withReadiness([], status)
    return {
      ...record,
      professional: { ...record.professional, profileId },
      readiness: {
        ...record.readiness,
        complete: false,
        items: [...record.readiness.items, { key: 'account_created', done: profileId !== null, missing: [] }, { key: 'submission_approved', done: false, missing: [] }],
      },
    }
  }
  const invitation = (state: InvitationInfo['state'], extra: Partial<InvitationInfo> = {}): Onboarding => ({
    invitation: { state, sentAt: '2026-10-08T14:00:00Z', expiresAt: '2026-10-15T14:00:00Z', openedAt: null, usedAt: null, ...extra },
    submission: null,
    onboardingApproved: false,
  })

  it('no invitation yet: says so, with « Envoyer l’invitation » for an inviter', () => {
    expect(nextAction(onboardingFile(null, 'draft'), null, can(...INVITE), NOW)).toEqual({
      message: t(`${N}.notInvited`, { firstName: 'Marie' }),
      action: { kind: 'invite', label: "Envoyer l'invitation", action: 'send' },
    })
    expect(nextAction(onboardingFile(null, 'draft'), null, can('professionals.manage'), NOW).action).toBeNull()
  })

  it('an expired link comes before the matching gaps, with « Envoyer un nouveau lien »', () => {
    const gaps = { ...withReadiness(['motif'], 'invited') }
    expect(nextAction(gaps, invitation('expired'), can(...INVITE), NOW)).toEqual({
      message: t(`${N}.invitationExpired`, { date: '15 oct.' }),
      action: { kind: 'invite', label: "Envoyer un nouveau lien", action: 'new_link' },
    })
  })

  it('a revoked link, or one used by an account since removed: says which, with « Envoyer l’invitation »', () => {
    const send = { kind: 'invite', label: "Envoyer l'invitation", action: 'send' }
    expect(nextAction(onboardingFile(null, 'draft'), invitation('revoked'), can(...INVITE), NOW)).toEqual({
      message: "L'invitation de Marie a été révoquée : son lien ne fonctionne plus.",
      action: send,
    })
    expect(nextAction(onboardingFile(null, 'draft'), invitation('used', { usedAt: '2026-10-09T13:00:00Z' }), can(...INVITE), NOW)).toEqual({
      message: "Marie a créé son accès avec le lien d'invitation le 9 oct., mais ce compte n'existe plus.",
      action: send,
    })
  })

  it('a link read as sent but past its expiry reads expired, with « Envoyer un nouveau lien »', () => {
    expect(nextAction(onboardingFile(), invitation('sent', { expiresAt: '2026-10-08T19:00:00Z' }), can(...INVITE), NOW)).toEqual({
      message: t(`${N}.invitationExpired`, { date: '8 oct.' }),
      action: { kind: 'invite', label: 'Envoyer un nouveau lien', action: 'new_link' },
    })
  })

  it('matching gaps come before an invitation not yet sent', () => {
    expect(nextAction(withReadiness(['motif'], 'draft'), null, can(...INVITE), NOW).message).toBe(t(`${N}.completeMatching`))
  })

  it('a live link: waiting for the professional, no button (the menu re-sends)', () => {
    expect(nextAction(onboardingFile(), invitation('sent'), can(...INVITE), NOW)).toEqual({
      message: t(`${N}.invitationSent`, { firstName: 'Marie', date: '8 oct.' }),
      action: null,
    })
    expect(nextAction(onboardingFile(), invitation('opened', { openedAt: '2026-10-09T13:00:00Z' }), can(...INVITE), NOW).message).toBe(
      t(`${N}.invitationOpened`, { firstName: 'Marie', date: '9 oct.' }),
    )
  })

  it('the questionnaire being filled in, then waiting for the review', () => {
    const draft: Onboarding = { invitation: null, submission: { id: 's1', kind: 'onboarding', status: 'draft', submittedAt: null }, onboardingApproved: false }
    expect(nextAction(onboardingFile('user-1'), draft, can(...INVITE), NOW).message).toBe(t(`${N}.questionnaireInProgress`, { firstName: 'Marie' }))
    const submitted: Onboarding = { ...draft, submission: { id: 's1', kind: 'onboarding', status: 'submitted', submittedAt: '2026-10-10T15:00:00Z' } }
    // « Réviser le profil » leads reviewers to Documents (Task 4b.5); others read the sentence alone.
    expect(nextAction(onboardingFile('user-1', 'in_review'), submitted, can('professionals.review'), NOW)).toEqual({
      message: t(`${N}.reviewOnboarding`, { firstName: 'Marie', date: '10 oct.' }),
      action: { kind: 'tab', label: t(`${N}.review`), tab: 'documents' },
    })
    expect(nextAction(onboardingFile('user-1', 'in_review'), submitted, can(...INVITE), NOW).action).toBeNull()
  })

  it('never offers « Réviser le profil » on the reviewer’s own file (P4-304)', () => {
    const submitted: Onboarding = { invitation: null, submission: { id: 's1', kind: 'update', status: 'submitted', submittedAt: '2026-10-10T15:00:00Z' }, onboardingApproved: true }
    expect(nextAction(onboardingFile('user-1', 'active'), submitted, can('professionals.review'), NOW, 'user-1')).toEqual({
      message: 'Vous avez envoyé une mise à jour de votre profil le 10 oct. : une autre personne autorisée doit la réviser.',
      action: null,
    })
    // Another reviewer's file keeps the button.
    expect(nextAction(onboardingFile('user-1', 'active'), submitted, can('professionals.review'), NOW, 'user-2').action).toEqual({
      kind: 'tab',
      label: t(`${N}.review`),
      tab: 'documents',
    })
  })

  it('an update waiting for review comes first, even on an active file', () => {
    const update: Onboarding = { invitation: null, submission: { id: 's2', kind: 'update', status: 'submitted', submittedAt: '2026-10-10T15:00:00Z' }, onboardingApproved: true }
    expect(nextAction(withReadiness([], 'active'), update, can(...INVITE), NOW).message).toBe(t(`${N}.reviewUpdate`, { firstName: 'Marie', date: '10 oct.' }))
  })

  it('an account without an approved questionnaire and nothing open', () => {
    expect(nextAction(onboardingFile('user-1'), null, can(...INVITE), NOW)).toEqual({ message: t(`${N}.awaitingQuestionnaire`, { firstName: 'Marie' }), action: null })
  })
})

describe('nextAction with the service contract (Task 4d.3)', () => {
  const N = 'modules.professionals.readiness.nextAction'
  /** An account, the questionnaire approved, the documents in order; `signed` the contract. */
  function contractFile(signed: boolean, documents = true): ProfessionalRecord {
    const record = withReadiness([], 'invited')
    const items = [
      ...record.readiness.items,
      { key: 'account_created' as const, done: true, missing: [] },
      { key: 'submission_approved' as const, done: true, missing: [] },
      { key: 'documents' as const, done: documents, missing: [] },
      { key: 'contract_signed' as const, done: signed, missing: [] },
    ]
    return { ...record, readiness: { ...record.readiness, complete: items.every((i) => i.done), items } }
  }

  it('only the contract left: « à envoyer » or « en attente de la signature de … », with a link to Documents', () => {
    const link = { kind: 'tab', label: t(`${N}.openContract`), tab: 'documents' }
    expect(nextAction(contractFile(false), null, can('professionals.view'), NOW, null, { kind: 'to_send' })).toEqual({
      message: 'Contrat de service à envoyer : le dossier de Marie est complet, sauf ce contrat.',
      action: link,
    })
    expect(nextAction(contractFile(false), null, can('professionals.view'), NOW, null, { kind: 'awaiting', name: 'Dominique Exemple' })).toEqual({
      message: 'En attente de la signature de Dominique Exemple : le contrat de service a été envoyé.',
      action: link,
    })
  })

  it('only the contract left, its card not loaded: one sentence for both', () => {
    expect(nextAction(contractFile(false), null, can('professionals.view'), NOW)).toEqual({
      message: t(`${N}.contractToSign`, { firstName: 'Marie' }),
      action: { kind: 'tab', label: t(`${N}.openContract`), tab: 'documents' },
    })
  })

  it('another item missing too: not the contract’s message', () => {
    expect(nextAction(contractFile(false, false), null, can('professionals.view'), NOW).message).not.toBe(t(`${N}.contractToSign`, { firstName: 'Marie' }))
  })

  it('names the item, and its pending label exists', () => {
    expect(readinessItemLabel('contract_signed')).toBe('Contrat de service signé')
    expect(t('modules.professionals.readiness.pending.contract_signed')).toBe('Contrat de service pas encore signé')
  })
})
