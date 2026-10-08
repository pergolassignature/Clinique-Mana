import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import {
  availabilitySchema,
  clienteleItemsSchema,
  holdsRegulatedTitle,
  languageIdsSchema,
  motifIdsSchema,
  specialtyItemsSchema,
  toAvailabilityFormValues,
} from './matching'
import { CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { errorAt } from '../test/schema-helpers'

describe('availabilitySchema', () => {
  it('turns the flat checkboxes into the periods array, in order', () => {
    const values = toAvailabilityFormValues(recordFixture().matchingProfile)
    expect(values).toEqual({ am: true, pm: false, evening: true, weekend: false, acceptingNewClients: true, note: '' })
    expect(availabilitySchema.parse({ ...values, weekend: true, note: ' Pas le vendredi. ' })).toEqual({
      availabilityPeriods: ['am', 'evening', 'weekend'],
      acceptingNewClients: true,
      availabilityNote: 'Pas le vendredi.',
    })
  })

  it('stores no note as null and caps it at 500', () => {
    const values = toAvailabilityFormValues(recordFixture().matchingProfile)
    expect(availabilitySchema.parse(values).availabilityNote).toBeNull()
    expect(errorAt(availabilitySchema, { ...values, note: 'x'.repeat(501) }, 'note')).toBe(t('modules.professionals.validation.maxChars', { max: '500' }))
  })
})

describe('holdsRegulatedTitle', () => {
  it('is true with a title of an order', () => {
    expect(holdsRegulatedTitle([{ titleId: IDS.psychologue }], CATALOG_VIEW)).toBe(true)
    expect(holdsRegulatedTitle([{ titleId: IDS.naturopathe }], CATALOG_VIEW)).toBe(false)
    expect(holdsRegulatedTitle([], CATALOG_VIEW)).toBe(false)
  })
})

describe('motifIdsSchema', () => {
  const schema = (heldIds: string[], hasRegulatedTitle = true) => motifIdsSchema(CATALOG_VIEW, { heldIds, hasRegulatedTitle })

  it('accepts active motifs and an archived one already held; [] clears', () => {
    expect(schema([IDS.archivedMotif]).parse([IDS.anxiete, IDS.archivedMotif])).toEqual([IDS.anxiete, IDS.archivedMotif])
    expect(schema([]).parse([])).toEqual([])
  })

  it('refuses a newly added archived motif', () => {
    expect(errorAt(schema([]), [IDS.archivedMotif])).toBe(t('modules.professionals.validation.motifArchived', { name: 'Ancien motif' }))
  })

  it('refuses a restricted motif without a regulated title (P4-16)', () => {
    expect(errorAt(schema([], false), [IDS.psychose])).toBe(t('modules.professionals.validation.motifRestricted', { name: 'Psychose' }))
    expect(schema([], true).safeParse([IDS.psychose]).success).toBe(true)
  })

  it('caps the set at 500', () => {
    expect(errorAt(schema([]), Array.from({ length: 501 }, () => IDS.anxiete))).toBe(t('modules.professionals.validation.tooMany'))
  })
})

describe('languageIdsSchema', () => {
  it('needs at least one language', () => {
    expect(errorAt(languageIdsSchema(CATALOG_VIEW, { heldIds: [IDS.fr] }), [])).toBe('Au moins une langue est requise.')
    expect(languageIdsSchema(CATALOG_VIEW, { heldIds: [] }).parse([IDS.fr, IDS.en])).toEqual([IDS.fr, IDS.en])
  })

  it('refuses a newly added archived language', () => {
    const view = { ...CATALOG_VIEW, byId: { ...CATALOG_VIEW.byId, languages: new Map([[IDS.en, { ...CATALOG_VIEW.languages[1]!, isActive: false }]]) } }
    expect(errorAt(languageIdsSchema(view, { heldIds: [] }), [IDS.en])).toBe(t('modules.professionals.validation.languageArchived', { name: 'Anglais' }))
    expect(languageIdsSchema(view, { heldIds: [IDS.en] }).safeParse([IDS.en]).success).toBe(true)
  })
})

describe('clienteleItemsSchema and specialtyItemsSchema', () => {
  it('keep the stars and refuse a newly added archived row', () => {
    expect(clienteleItemsSchema(CATALOG_VIEW, { heldIds: [] }).parse([{ id: IDS.couples, specialized: true }])).toEqual([{ id: IDS.couples, specialized: true }])
    const archived = {
      ...CATALOG_VIEW,
      byId: {
        ...CATALOG_VIEW.byId,
        clienteles: new Map([[IDS.couples, { ...CATALOG_VIEW.clienteles[2]!, isActive: false }]]),
        specialties: new Map([[IDS.cbt, { ...CATALOG_VIEW.specialties[0]!, isActive: false }]]),
      },
    }
    expect(errorAt(clienteleItemsSchema(archived, { heldIds: [] }), [{ id: IDS.couples, specialized: false }])).toBe(
      t('modules.professionals.validation.clienteleArchived', { name: 'Couples' }),
    )
    expect(errorAt(specialtyItemsSchema(archived, { heldIds: [] }), [{ id: IDS.cbt, specialized: false }])).toBe(
      t('modules.professionals.validation.specialtyArchived', { name: 'Thérapie cognitivo-comportementale (TCC)' }),
    )
    expect(specialtyItemsSchema(archived, { heldIds: [IDS.cbt] }).safeParse([{ id: IDS.cbt, specialized: true }]).success).toBe(true)
  })
})
