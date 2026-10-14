import { describe, expect, it } from 'vitest'
import { offeredServices, type CatalogueService } from './offered'

const service = (over: Partial<CatalogueService>): CatalogueService => ({
  id: 's1',
  code: 10150,
  name: 'Consultation individuelle 50 min',
  durationMinutes: 50,
  bufferAfterMinutes: 10,
  forTwo: false,
  priceSource: 'grid',
  taxRule: 'exempt',
  titleIds: ['psy'],
  excludedProfessionalIds: [],
  ...over,
})

describe('offeredServices (L26)', () => {
  const catalogue = [
    service({}),
    service({ id: 's2', code: 10130, name: 'Consultation 30 min', titleIds: ['psy', 'sexo'] }),
    service({ id: 's3', code: 50100, name: 'Inscription', priceSource: 'fixed', titleIds: [] }),
    service({ id: 's4', code: 10160, name: 'Sexothérapie', titleIds: ['sexo'] }),
  ]
  const prices = [
    { serviceId: 's1', titleId: 'psy', priceCents: 17500, source: 'grid' as const },
    { serviceId: 's2', titleId: 'sexo', priceCents: 9000, source: 'grid' as const },
    { serviceId: 's2', titleId: 'psy', priceCents: 11000, source: 'grid' as const },
    { serviceId: 's4', titleId: 'sexo', priceCents: null, source: 'grid' as const },
  ]

  it('the services one of her titles allows, by code; never a clinic service offered by no title', () => {
    const rows = offeredServices(catalogue, { professionalId: 'p1', primaryTitleId: 'psy', titleIds: ['psy'] }, prices)
    expect(rows.map((r) => [r.code, r.priceCents])).toEqual([
      [10130, 11000],
      [10150, 17500],
    ])
  })

  it('her price is her primary title’s first, then another of her titles; « À confirmer » (null) without a grid', () => {
    const rows = offeredServices(catalogue, { professionalId: 'p1', primaryTitleId: 'sexo', titleIds: ['psy', 'sexo'] }, prices)
    expect(rows.map((r) => [r.code, r.priceCents])).toEqual([
      [10130, 9000],
      [10150, 17500],
      [10160, null],
    ])
  })

  it('says which of her titles\' services she does not offer (R-83), another professional\'s list aside', () => {
    const rows = offeredServices(
      [service({ excludedProfessionalIds: ['p1'] }), service({ id: 's2', code: 10130, excludedProfessionalIds: ['p2'] })],
      { professionalId: 'p1', primaryTitleId: 'psy', titleIds: ['psy'] },
      prices,
    )
    expect(rows.map((r) => [r.code, r.offered])).toEqual([
      [10130, true],
      [10150, false],
    ])
  })
})
