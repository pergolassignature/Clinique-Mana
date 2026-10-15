import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import type { MatchBasis } from '../api/demandes'
import { autoOptionLabel, clienteleConflict, participantsHint } from './clientele'

const C = 'modules.demandes.clientele'
const children = { id: 'k1', key: 'children', name: 'Enfants' }
const adults = { id: 'k4', key: 'adults', name: 'Adultes' }
const basis = (over: Partial<MatchBasis> = {}): MatchBasis => ({
  person: 'participant',
  age: 9,
  clientele_auto: { basis: 'age', clienteles: [children] },
  derivable_ids: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'],
  ...over,
})

describe('the clientèle « Automatique » (D-59)', () => {
  it('shows what the server derived, with its source', () => {
    expect(autoOptionLabel(basis())).toBe('Automatique : Enfants (participant principal, 9 ans)')
    expect(autoOptionLabel(basis({ person: 'file', age: 40, clientele_auto: { basis: 'age', clienteles: [adults] } }))).toBe(
      'Automatique : Adultes (dossier de la demande, 40 ans)',
    )
    expect(autoOptionLabel(basis({ clientele_auto: { basis: 'couple', clienteles: [{ id: 'k5', key: 'couples', name: 'Couples' }] } }))).toBe(
      'Automatique : Couples (un couple)',
    )
    expect(autoOptionLabel(basis({ age: null, clientele_auto: { basis: 'none', clienteles: [] } }))).toBe('Automatique : à préciser (âge inconnu)')
    expect(autoOptionLabel(basis({ person: null, age: null, clientele_auto: { basis: 'none', clienteles: [] } }))).toBe(
      'Automatique : à préciser (aucun participant ni dossier)',
    )
  })

  it('a choice the participants contradict is a warning; a special clientèle or a matching one is not', () => {
    expect(clienteleConflict('k4', basis())).toBe(t(`${C}.conflict`, { names: 'Enfants' }))
    expect(clienteleConflict('k1', basis())).toBeNull()
    expect(clienteleConflict('k8', basis())).toBeNull() // « Parents »: not one the rule gives
    expect(clienteleConflict('', basis())).toBeNull()
    expect(clienteleConflict('k4', basis({ clientele_auto: { basis: 'none', clienteles: [] } }))).toBeNull()
  })
})

describe('« Ajoutez … dans Participants » (D-60)', () => {
  const requester = { client_id: 'mother', relationship: 'self', is_primary: true }
  const child = { client_id: null, relationship: 'child', is_primary: true }

  it('shows for someone else when nobody but the requester is listed', () => {
    expect(participantsHint('child', [], 'mother')).toBe(t(`${C}.addPeople.child`))
    expect(participantsHint('child', [requester], 'mother')).toBe(t(`${C}.addPeople.child`))
    expect(participantsHint('teen', [{ ...child, is_primary: false }, requester], 'mother')).toBe(t(`${C}.addPeople.teen`))
    expect(participantsHint('other', [], null)).toBe(t(`${C}.addPeople.other`))
    expect(participantsHint('couple', [requester], 'mother')).toBe(t(`${C}.addPeople.couple`))
    expect(participantsHint('family', [], null)).toBe(t(`${C}.addPeople.family`))
    // The request's own file listed under another relationship is still the requester.
    expect(participantsHint('child', [{ client_id: 'mother', relationship: 'parent', is_primary: true }], 'mother')).toBe(t(`${C}.addPeople.child`))
  })

  it('hides for oneself, an unknown « Pour qui », or once the person seen is listed', () => {
    expect(participantsHint('self', [], null)).toBeNull()
    expect(participantsHint('', [], null)).toBeNull()
    expect(participantsHint('child', [{ ...requester, is_primary: false }, child], 'mother')).toBeNull()
    expect(participantsHint('couple', [requester, { client_id: 'partner', relationship: 'partner', is_primary: false }], 'mother')).toBeNull()
  })
})
