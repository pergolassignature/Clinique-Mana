import { describe, expect, it } from 'vitest'
import { dollarsToCents, parseTierRows, tierRow, tiersText } from './payer-tiers'

describe('a PAE agreement’s tiers (R-85)', () => {
  it('reads in plain French, the usual coverage last', () => {
    expect(tiersText([{ sessions: 3, coveragePercent: 100, sessionAmountCents: null }], null, 50)).toBe('3 premières séances : 100 % ; ensuite : 50 %')
    expect(
      tiersText(
        [
          { sessions: 1, coveragePercent: null, sessionAmountCents: 8000 },
          { sessions: 2, coveragePercent: 50, sessionAmountCents: null },
          { sessions: 1, coveragePercent: 25, sessionAmountCents: null },
        ],
        3000,
        null,
      ),
    ).toBe('Première séance : 80,00 $ ; 2 séances suivantes : 50 % ; Séance suivante : 25 % ; ensuite : 30,00 $')
    expect(tiersText([], null, 50)).toBeNull()
  })

  it('parses the form’s rows: whole sessions, a share of 1–100 % or dollars', () => {
    expect(
      parseTierRows([
        { sessions: '3', mode: 'percent', value: '100' },
        { sessions: ' 2 ', mode: 'amount', value: '60,50' },
      ]),
    ).toEqual([
      { sessions: 3, coveragePercent: 100, sessionAmountCents: null },
      { sessions: 2, coveragePercent: null, sessionAmountCents: 6050 },
    ])
    expect(parseTierRows([])).toEqual([])
    for (const bad of [
      { sessions: '0', mode: 'percent', value: '100' },
      { sessions: '1.5', mode: 'percent', value: '100' },
      { sessions: '1000', mode: 'percent', value: '100' },
      { sessions: '3', mode: 'percent', value: '0' },
      { sessions: '3', mode: 'percent', value: '101' },
      { sessions: '3', mode: 'amount', value: '' },
      { sessions: '3', mode: 'amount', value: '0' },
      { sessions: '3', mode: 'amount', value: '0,00' },
      { sessions: '3', mode: 'amount', value: 'abc' },
      { sessions: '3', mode: 'amount', value: '10000,01' },
    ] as const) {
      expect(parseTierRows([bad]), JSON.stringify(bad)).toBeNull()
    }
  })

  it('a saved tier back in the form', () => {
    expect(tierRow({ sessions: 3, coveragePercent: 100, sessionAmountCents: null })).toEqual({ sessions: '3', mode: 'percent', value: '100' })
    expect(tierRow({ sessions: 2, coveragePercent: null, sessionAmountCents: 6050 })).toEqual({ sessions: '2', mode: 'amount', value: '60,50' })
    expect(dollarsToCents('94,50 $')).toBe(9450)
  })
})
