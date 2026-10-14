import { describe, expect, it } from 'vitest'
import { buildCsv, collectPages, csvField, csvMoney, csvNumber } from './csv'

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

describe('collectPages (L7)', () => {
  const source = Array.from({ length: 23 }, (_, i) => i + 1)
  const fetchPage = (size: number) => (after: number | null) => Promise.resolve(source.filter((n) => n > (after ?? 0)).slice(0, size))

  it('follows the cursor until a short page', async () => {
    const calls: (number | null)[] = []
    const result = await collectPages((after: number | null) => {
      calls.push(after)
      return fetchPage(10)(after)
    }, 10, (page) => page.at(-1) ?? null)
    expect(result).toEqual({ rows: source, truncated: false })
    expect(calls).toEqual([null, 10, 20])
  })

  it('stops at the maximum and says the file is cut', async () => {
    const result = await collectPages(fetchPage(10), 10, (page) => page.at(-1) ?? null, 15)
    expect(result.rows).toEqual(source.slice(0, 15))
    expect(result.truncated).toBe(true)
  })

  it('a maximum met exactly by the last rows is not cut', async () => {
    const result = await collectPages(fetchPage(10), 10, (page) => page.at(-1) ?? null, 23)
    expect(result).toEqual({ rows: source, truncated: false })
  })
})
