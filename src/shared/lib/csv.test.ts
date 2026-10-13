import { describe, expect, it } from 'vitest'
import { buildCsv, csvField, csvMoney, csvNumber } from './csv'

describe('csv', () => {
  it('guards a text cell that a spreadsheet would read as a formula', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-2')).toBe("'-2")
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvField('\tx')).toBe("'\tx")
    expect(csvField('Alice Essai')).toBe('Alice Essai')
  })

  it('quotes a separator, a quote or a line break', () => {
    expect(csvField('a;b')).toBe('"a;b"')
    expect(csvField('dit "oui"')).toBe('"dit ""oui"""')
    expect(csvField('a\nb')).toBe('"a\nb"')
  })

  it('writes the numbers the app computed as they are, with a decimal comma', () => {
    expect(buildCsv(['Montant', 'Code', 'Quantité', 'Vide'], [[csvMoney(17550), csvNumber(10150), csvNumber(1.5), null]])).toBe(
      '\uFEFFMontant;Code;Quantité;Vide\r\n175,50;10150;1,5;\r\n',
    )
  })
})
