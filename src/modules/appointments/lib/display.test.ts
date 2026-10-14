import { describe, expect, it } from 'vitest'
import type { AgendaReference } from '../api/agenda'
import { servicesFor } from './display'

const service = (id: string, titleIds: string[], excludedProfessionalIds: string[] = []) => ({
  id,
  code: 10150,
  name: id,
  durationMinutes: 50,
  bufferAfterMinutes: 10,
  forTwo: false,
  colour: null,
  titleIds,
  excludedProfessionalIds,
})

const REFERENCE: AgendaReference = {
  professionals: [
    { id: 'p1', name: 'Félix Gauthier', active: true, titleIds: ['psy'] },
    { id: 'p2', name: 'Julie Morin', active: true, titleIds: ['psy'] },
  ],
  services: [service('individual', ['psy']), service('couple', ['psy'], ['p1']), service('call', []), service('naturo', ['naturo'])],
  reasons: [],
}

describe('servicesFor', () => {
  it('her titles’ services and the clinic’s, never another title’s nor one she does not offer (R-83)', () => {
    expect(servicesFor(REFERENCE, 'p1').map((s) => s.id)).toEqual(['individual', 'call'])
    expect(servicesFor(REFERENCE, 'p2').map((s) => s.id)).toEqual(['individual', 'couple', 'call'])
  })
})
