import { describe, expect, it } from 'vitest'
import { looksMojibake } from './mojibake'

/** What a UTF-8 string becomes when it is read back as Latin-1, one byte to one character. */
const mangle = (text: string) => Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('')

describe('looksMojibake', () => {
  it('catches a Latin-1 read of French text', () => {
    expect(looksMojibake(mangle('Saint-Irénée'))).toBe(true)
    expect(looksMojibake(mangle('Montréal'))).toBe(true)
    expect(looksMojibake(mangle('à Québec'))).toBe(true)
    expect(looksMojibake(mangle('L’Île-Perrot'))).toBe(true)
    expect(looksMojibake(mangle('10 °C, 2e étage'))).toBe(true)
  })

  it('catches it after a title-case lowered the first character', () => {
    // The value found in the clinic's file: the mangling, then an initcap that lowered « Ã » and
    // capitalised what follows each « © ».
    expect(looksMojibake('Saint-Irã©Nã©E')).toBe(true)
    expect(looksMojibake(mangle('Montréal').toLowerCase())).toBe(true)
  })

  it('leaves real French, and other accented names, alone', () => {
    for (const city of ['Saint-Irénée', 'Montréal', 'Québec', 'Château-Richer', 'Trois-Rivières', 'Saint-Jérôme', 'L’Île-Perrot', 'São Paulo', 'Ängelholm']) {
      expect(looksMojibake(city), city).toBe(false)
    }
    expect(looksMojibake('1234, rue Saint-Denis')).toBe(false)
    expect(looksMojibake('')).toBe(false)
  })
})
