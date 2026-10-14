import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { MAX_CLIENTS, joinNames, maxClientsFor, participantRole } from './participants'

const E = 'modules.appointments.editor'

describe('participants (R-79)', () => {
  it('six people at most, two for a couple service', () => {
    expect(MAX_CLIENTS).toBe(6)
    expect(maxClientsFor(undefined)).toBe(6)
    expect(maxClientsFor({ forTwo: false })).toBe(6)
    expect(maxClientsFor({ forTwo: true })).toBe(2)
  })

  it('names everyone in plain French', () => {
    expect(joinNames(['Alice'])).toBe('Alice')
    expect(joinNames(['Alice', 'Bruno'])).toBe('Alice et Bruno')
    expect(joinNames(['Alice', 'Bruno', 'Chloé'])).toBe('Alice, Bruno et Chloé')
    expect(joinNames(['Alice', '', 'Chloé'])).toBe('Alice et Chloé')
    expect(joinNames([])).toBe('')
  })

  it('the person seen, a couple\'s second person, a family\'s other people', () => {
    expect(participantRole(0, 3)).toBe(t(`${E}.personSeen`))
    expect(participantRole(1, 2)).toBe(t(`${E}.secondPerson`))
    expect(participantRole(1, 3)).toBe(t(`${E}.otherPerson`))
    expect(participantRole(2, 3)).toBe(t(`${E}.otherPerson`))
  })
})
