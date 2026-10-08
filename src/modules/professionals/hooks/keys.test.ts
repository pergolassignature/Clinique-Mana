import { describe, expect, it } from 'vitest'
import { compensationTermsKeys, professionalCatalogKeys, professionalKeys, professionalsSettingsKeys } from './keys'

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) => expect(key.slice(0, prefix.length)).toEqual(prefix)

describe('query keys', () => {
  it('nest every list query under lists(), and lists() and records under all', () => {
    startsWith(professionalKeys.list(), professionalKeys.lists())
    startsWith(professionalKeys.pages({ sort: 'name' }), professionalKeys.lists())
    startsWith(professionalKeys.lists(), professionalKeys.all)
    startsWith(professionalKeys.record('p1'), professionalKeys.all)
    startsWith(professionalKeys.history('p1'), professionalKeys.all)
  })

  it('keep a record, its history and the lists apart (narrow invalidation)', () => {
    expect(professionalKeys.record('p1').slice(0, 2)).not.toEqual(professionalKeys.lists())
    expect(professionalKeys.history('p1')).not.toEqual(professionalKeys.record('p1'))
    expect(professionalKeys.record('p1')).not.toEqual(professionalKeys.record('p2'))
  })

  it('give the catalogue and the settings their own roots', () => {
    startsWith(professionalCatalogKeys.catalog(), professionalCatalogKeys.all)
    startsWith(professionalCatalogKeys.usage(), professionalCatalogKeys.all)
    startsWith(professionalsSettingsKeys.settings(), professionalsSettingsKeys.all)
    expect(professionalCatalogKeys.all[0]).not.toBe(professionalKeys.all[0])
    expect(professionalsSettingsKeys.all[0]).not.toBe(professionalKeys.all[0])
  })

  it('nest every compensation entry under compensations(), apart from the private data (4a.18)', () => {
    startsWith(professionalKeys.compensation('p1'), professionalKeys.compensations())
    startsWith(professionalKeys.compensations(), professionalKeys.all)
    expect(professionalKeys.private('p1').slice(0, 2)).not.toEqual(professionalKeys.compensations())
    startsWith(professionalKeys.review('2026-09-01'), professionalKeys.reviews())
    startsWith(professionalKeys.reviews(), professionalKeys.all)
    expect(professionalKeys.reviews().slice(0, 2)).not.toEqual(professionalKeys.compensations())
    startsWith(compensationTermsKeys.kinds(), compensationTermsKeys.all)
    startsWith(compensationTermsKeys.terms(), compensationTermsKeys.all)
    expect(compensationTermsKeys.all[0]).not.toBe(professionalKeys.all[0])
  })
})
