import { describe, expect, it } from 'vitest'
import { PRICES, SERVICES, SIDS, TITLES } from '../test/fixtures'
import { priceGaps } from './price-gaps'

describe('priceGaps', () => {
  it('reports a title without a grid as missing, and nothing where the grid matches GOrendezvous', () => {
    const gaps = priceGaps(TITLES, SERVICES, PRICES)
    // Only 10150 is in the fixture catalogue: the 30 and 60 min columns have no reference service.
    expect(gaps).toEqual([{ title: TITLES[1], duration: 50, gridCents: null, observedCents: 15000 }])
  })

  it('reports a grid price that differs from the observed one', () => {
    const prices = PRICES.map((p) => (p.titleId === SIDS.psychologue ? { ...p, priceCents: 18000 } : p))
    expect(priceGaps(TITLES.slice(0, 1), SERVICES, prices)).toEqual([{ title: TITLES[0], duration: 50, gridCents: 18000, observedCents: 17500 }])
  })

  it('skips titles GOrendezvous never priced and archived reference services', () => {
    const other = { id: 'x', key: 'naturopathe', name: 'Naturopathe', sortOrder: 9 }
    expect(priceGaps([other], SERVICES, PRICES)).toEqual([])
    const archived = SERVICES.map((s) => (s.code === 10150 ? { ...s, isActive: false } : s))
    expect(priceGaps(TITLES, archived, PRICES)).toEqual([])
  })
})
