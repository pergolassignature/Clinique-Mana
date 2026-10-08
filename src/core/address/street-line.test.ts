import { describe, expect, it } from 'vitest'
import { FRENCH_GENERICS as SERVER_GENERICS, streetLine as serverStreetLine } from '../../../supabase/functions/places/address'
import { civicNumber, FRENCH_GENERICS, splitCivicNumber, startsWithGeneric, streetLine } from './street-line'

/** Title case, as Google returns a route: `rond-point` → `Rond-Point`. */
const titled = (word: string) => word.replace(/(^|-)(\p{L})/gu, (_, dash: string, letter: string) => dash + letter.toUpperCase())

describe('street line (browser copy of the places function’s rule)', () => {
  it('has the same French generics as the function', () => {
    expect([...FRENCH_GENERICS].sort()).toEqual([...SERVER_GENERICS].sort())
  })

  it('formats every generic, number or not, in Québec or not, as the function does', () => {
    for (const generic of FRENCH_GENERICS) {
      const route = `${titled(generic)} Saint-Joseph`
      for (const number of ['12', null]) {
        for (const quebec of [true, false]) {
          expect(streetLine(number, route, quebec)).toBe(serverStreetLine(number, route, quebec))
        }
      }
    }
    expect(streetLine('10', 'Rond-Point Des Érables', true)).toBe('10, rond-point Des Érables')
    expect(streetLine('10', 'Avenue Road', false)).toBe('10 Avenue Road')
    expect(streetLine('10', null, true)).toBeNull()
  })

  it('reads a civic number at the start of a line', () => {
    expect(civicNumber('1234 rue st-d')).toBe('1234')
    expect(civicNumber(' 1234A, rue Saint-Denis')).toBe('1234A')
    expect(civicNumber('1234-1236 boul. Saint-Laurent')).toBe('1234-1236')
    expect(civicNumber('rue Saint-Denis')).toBeNull()
    expect(civicNumber('1234rue')).toBeNull()
    expect(splitCivicNumber('1234 Rue Saint-Denis')).toEqual(['1234', 'Rue Saint-Denis'])
    expect(splitCivicNumber('1234, rue Saint-Denis')).toEqual(['1234', 'rue Saint-Denis'])
    expect(splitCivicNumber('Rue Saint-Denis')).toEqual([null, 'Rue Saint-Denis'])
    expect(startsWithGeneric('Rue Saint-Denis')).toBe(true)
    expect(startsWithGeneric('Le Plateau-Mont-Royal')).toBe(false)
  })
})
