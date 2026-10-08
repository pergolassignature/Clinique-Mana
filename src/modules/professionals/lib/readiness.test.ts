import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { MISSING_TAB, missingLabel, nextAction, readinessItemLabel, warningLabel } from './readiness'
import { READINESS_MISSING } from './constants'
import { recordFixture } from '../test/fixtures-domain'
import type { ProfessionalRecord } from '../api/parse'
import type { ReadinessMissing } from './constants'

const T = (key: Parameters<typeof t>[0]) => t(key)

function withReadiness(missing: ReadinessMissing[], status: ProfessionalRecord['professional']['status'] = 'draft'): ProfessionalRecord {
  const record = recordFixture()
  return {
    ...record,
    professional: { ...record.professional, status },
    readiness: { ...record.readiness, complete: missing.length === 0, done: missing.length === 0 ? 1 : 0, items: [{ key: 'matching_profile', done: missing.length === 0, missing }] },
  }
}

const can = (...keys: string[]) => (permission: string) => keys.includes(permission)

describe('labels', () => {
  it('names the item, each gap and the warning', () => {
    expect(readinessItemLabel('matching_profile')).toBe('Profil de jumelage complet')
    expect(missingLabel('profession')).toBe('un titre professionnel')
    expect(missingLabel('licence')).toBe('le numéro de permis')
    expect(warningLabel('login_email_mismatch')).toBe(T('modules.professionals.readiness.warnings.login_email_mismatch'))
  })

  it('sends every gap to the tab that fixes it', () => {
    expect(READINESS_MISSING.map((m) => MISSING_TAB[m])).toEqual(['identite', 'identite', 'identite', 'jumelage', 'jumelage', 'jumelage'])
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
    expect(nextAction(withReadiness(missing, status), can(...keys))).toEqual(expected)
  })

  it('matching done, account and questionnaire missing (4b.1): the sentence alone, no tab', () => {
    const record = withReadiness([], 'invited')
    const incomplete: ProfessionalRecord = {
      ...record,
      readiness: {
        ...record.readiness,
        complete: false,
        items: [...record.readiness.items, { key: 'account_created', done: false, missing: [] }, { key: 'submission_approved', done: false, missing: [] }],
      },
    }
    expect(nextAction(incomplete, can('professionals.manage', 'professionals.matching'))).toEqual({
      message: T('modules.professionals.readiness.nextAction.awaitingOnboarding'),
      action: null,
    })
    expect(readinessItemLabel('account_created')).toBe('Compte créé (invitation acceptée)')
    expect(readinessItemLabel('submission_approved')).toBe('Questionnaire approuvé')
  })
})
