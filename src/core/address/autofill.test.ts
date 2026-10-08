import { describe, expect, it } from 'vitest'
import type { FieldValues, UseFormGetValues, UseFormSetValue } from 'react-hook-form'
import type { AddressSuggestion, PlaceAddress } from './api'
import { addressAutofill } from './autofill'

type Values = { line1: string; line2: string; city: string; province: string; postal: string }
const NAMES = { line1: 'line1', line2: 'line2', city: 'city', province: 'province', postalCode: 'postal' } as const

/** A form as `addressAutofill` sees it, over plain values. */
function fakeForm(initial: Partial<Values> = {}) {
  const values: Values = { line1: '', line2: '', city: '', province: '', postal: '', ...initial }
  const dirty = new Set<string>()
  const form = {
    getValues: ((name: keyof Values) => values[name]) as unknown as UseFormGetValues<Values & FieldValues>,
    setValue: ((name: keyof Values, value: string, options?: { shouldDirty?: boolean }) => {
      values[name] = value
      if (options?.shouldDirty) dirty.add(name)
    }) as unknown as UseFormSetValue<Values & FieldValues>,
    formState: { isSubmitted: false },
  }
  return { values, dirty, autofill: addressAutofill(form, NAMES) }
}

const place = (address: Partial<PlaceAddress>): PlaceAddress => ({
  line1: null,
  line2: null,
  city: null,
  province: null,
  postalCode: null,
  country: 'CA',
  ...address,
})

const PLATEAU = place({ line1: '1234, rue Saint-Denis', city: 'Montréal', province: 'QC', postalCode: 'H2X 3J6' })

describe('addressAutofill', () => {
  it('fills line 1, the city, the province and the postal code, dirty, and says what it wrote', () => {
    const { values, dirty, autofill } = fakeForm({ line1: '1234 saint-d' })
    const fill = autofill.apply(PLATEAU, autofill.capture())
    expect(values).toEqual({ line1: '1234, rue Saint-Denis', line2: '', city: 'Montréal', province: 'QC', postal: 'H2X 3J6' })
    expect([...dirty].sort()).toEqual(['city', 'line1', 'postal', 'province'])
    expect(fill).toEqual({ line1: '1234, rue Saint-Denis', city: 'Montréal', province: 'QC', postalCode: 'H2X 3J6' })
  })

  describe('a street without a civic number', () => {
    it('keeps the typed number in front, in the Québec comma form', () => {
      const { values, autofill } = fakeForm({ line1: '1234 saint-denis' })
      autofill.apply({ ...PLATEAU, line1: 'rue Saint-Denis' }, autofill.capture())
      expect(values.line1).toBe('1234, rue Saint-Denis')
    })

    it('keeps a number with a letter or a range; uses the form’s province when Google has none', () => {
      const { values, autofill } = fakeForm({ line1: '12A chemin du lac', province: 'QC' })
      autofill.apply(place({ line1: 'chemin du Lac-Écho', city: 'Prévost' }), autofill.capture())
      expect(values.line1).toBe('12A, chemin du Lac-Écho')

      const range = fakeForm({ line1: '1234-1236 saint-laurent' })
      range.autofill.apply({ ...PLATEAU, line1: 'boulevard Saint-Laurent' }, range.autofill.capture())
      expect(range.values.line1).toBe('1234-1236, boulevard Saint-Laurent')
    })

    it('outside Québec: the number and a space', () => {
      const { values, autofill } = fakeForm({ line1: '100 queen' })
      autofill.apply(place({ line1: 'Queen Street West', city: 'Toronto', province: 'ON' }), autofill.capture())
      expect(values.line1).toBe('100 Queen Street West')
    })

    it('without a typed number, the street alone; Google’s own number always wins', () => {
      const { values, autofill } = fakeForm({ line1: 'saint-denis' })
      autofill.apply({ ...PLATEAU, line1: 'rue Saint-Denis' }, autofill.capture())
      expect(values.line1).toBe('rue Saint-Denis')

      const google = fakeForm({ line1: '99 saint-denis' })
      google.autofill.apply(PLATEAU, google.autofill.capture())
      expect(google.values.line1).toBe('1234, rue Saint-Denis')
    })
  })

  describe('a field Google returns nothing for', () => {
    it('keeps a value the person typed', () => {
      const { values, autofill } = fakeForm({ line1: '1234 saint-d', city: 'Laval', postal: 'H7N 1A1', line2: 'Bureau 210' })
      autofill.apply(place({ line1: '1234, rue Saint-Denis', province: 'QC' }), autofill.capture())
      expect(values).toMatchObject({ city: 'Laval', postal: 'H7N 1A1', line2: 'Bureau 210' })
    })

    it('clears the previous choice’s city, postal code and unit, untouched since', () => {
      const { values, autofill } = fakeForm({ line1: '3450 drummond' })
      const first = autofill.apply(place({ line1: '3450, rue Drummond', line2: '402', city: 'Montréal', province: 'QC', postalCode: 'H3G 1Y2' }), autofill.capture())
      expect(values).toMatchObject({ line2: '402', city: 'Montréal', postal: 'H3G 1Y2' })

      values.line1 = '1500 rang saint-joseph'
      autofill.apply(place({ line1: '1500, rang Saint-Joseph', province: 'QC' }), autofill.capture(), first)
      expect(values).toEqual({ line1: '1500, rang Saint-Joseph', line2: '', city: '', province: 'QC', postal: '' })
    })

    it('never clears a field the person edited after the previous choice, nor line 1, nor the province', () => {
      const { values, autofill } = fakeForm({ line1: '3450 drummond' })
      const first = autofill.apply(place({ line1: '3450, rue Drummond', line2: '402', city: 'Montréal', province: 'QC', postalCode: 'H3G 1Y2' }), autofill.capture())
      values.city = 'Westmount'
      values.line2 = '402B'
      values.line1 = 'pointe'
      autofill.apply(place({ country: null }), autofill.capture(), first)
      expect(values).toEqual({ line1: 'pointe', line2: '402B', city: 'Westmount', province: 'QC', postal: '' })
    })

    it('replaces the previous choice’s unit with the new one, but never a unit the person typed', () => {
      const { values, autofill } = fakeForm({ line1: '3450 drummond' })
      const first = autofill.apply({ ...PLATEAU, line2: '402' }, autofill.capture())
      autofill.apply({ ...PLATEAU, line2: '12' }, autofill.capture(), first)
      expect(values.line2).toBe('12')

      const typed = fakeForm({ line1: '3450 drummond', line2: 'Bureau 210' })
      typed.autofill.apply({ ...PLATEAU, line2: '402' }, typed.autofill.capture())
      expect(typed.values.line2).toBe('Bureau 210')
    })
  })

  it('fills nothing when « Adresse » changed since the choice (« Annuler », a reload)', () => {
    const { values, dirty, autofill } = fakeForm({ line1: '1234 saint-d' })
    const captured = autofill.capture()
    values.line1 = '123, rue Saint-Denis'
    expect(autofill.apply(PLATEAU, captured)).toBeNull()
    expect(autofill.applyStreet({ placeId: 'ChIJfakePlateau000001', mainText: '1234 Rue Saint-Denis', secondaryText: 'Montréal, QC, Canada' }, captured)).toBe(false)
    expect(values).toEqual({ line1: '123, rue Saint-Denis', line2: '', city: '', province: '', postal: '' })
    expect(dirty.size).toBe(0)
  })

  describe('applyStreet (the chosen place could not be read)', () => {
    const suggestion = (mainText: string, secondaryText = 'Montréal, QC, Canada'): AddressSuggestion => ({ placeId: 'ChIJfakePlace0000001', mainText, secondaryText })

    it('fills line 1 alone, in the Québec comma form, as the function would', () => {
      const { values, autofill } = fakeForm({ line1: '1234 saint-d', city: 'Laval' })
      expect(autofill.applyStreet(suggestion('1234 Rue Saint-Denis'), autofill.capture())).toBe(true)
      expect(values).toEqual({ line1: '1234, rue Saint-Denis', line2: '', city: 'Laval', province: '', postal: '' })
    })

    it('elsewhere keeps the suggestion’s form; without a province in the text, the form’s decides', () => {
      const toronto = fakeForm({ line1: '100 queen' })
      toronto.autofill.applyStreet(suggestion('100 Queen Street West', 'Toronto, ON, Canada'), toronto.autofill.capture())
      expect(toronto.values.line1).toBe('100 Queen Street West')

      const noProvince = fakeForm({ line1: '5 rue', province: 'QC' })
      noProvince.autofill.applyStreet(suggestion('5 Rue Principale', 'Saint-Liboire'), noProvince.autofill.capture())
      expect(noProvince.values.line1).toBe('5, rue Principale')
    })

    it('keeps the typed number when the suggestion has none', () => {
      const { values, autofill } = fakeForm({ line1: '1500 rang st-joseph' })
      autofill.applyStreet(suggestion('Rang Saint-Joseph', 'Saint-Liboire, QC, Canada'), autofill.capture())
      expect(values.line1).toBe('1500, rang Saint-Joseph')
    })

    it('leaves line 1 as typed for a suggestion that is no street (a neighbourhood, a city)', () => {
      const { values, autofill } = fakeForm({ line1: 'plateau mont' })
      expect(autofill.applyStreet(suggestion('Le Plateau-Mont-Royal'), autofill.capture())).toBe(false)
      expect(values.line1).toBe('plateau mont')
    })
  })
})
