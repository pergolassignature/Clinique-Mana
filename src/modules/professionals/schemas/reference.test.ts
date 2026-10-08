import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { referenceSchemas, toReferenceFormValues } from './reference'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { errorAt } from '../test/schema-helpers'

const V = (key: Parameters<typeof t>[0]) => t(key)

describe('names (every list)', () => {
  const schema = referenceSchemas.specialties

  it('tidies the name like reference_text', () => {
    expect(schema.parse({ name: '  Thérapie   d’impact ' })).toEqual({ name: 'Thérapie d’impact' })
  })

  it('requires 1–120 characters', () => {
    expect(errorAt(schema, { name: ' ' }, 'name')).toBe(V('modules.professionals.validation.nameRequired'))
    expect(errorAt(schema, { name: 'x'.repeat(121) }, 'name')).toBe(V('modules.professionals.validation.nameTooLong'))
  })
})

describe('professional_orders', () => {
  const schema = referenceSchemas.professional_orders
  const base = { name: 'Ordre des psychologues du Québec', acronym: 'opq', licenceLabel: '', licencePattern: '' }

  it('upper-cases the acronym, empty label and pattern → null (the label defaults in SQL)', () => {
    expect(schema.parse(base)).toEqual({ name: base.name, acronym: 'OPQ', licenceLabel: null, licencePattern: null })
  })

  it('keeps the pattern’s inner spaces', () => {
    expect(schema.parse({ ...base, licencePattern: ' ^[0-9]{3} [0-9]{2}$ ' }).licencePattern).toBe('^[0-9]{3} [0-9]{2}$')
  })

  it.each(['O', 'O1', 'ABCDEFGHIJK'])('refuses the acronym %s', (acronym) => {
    expect(errorAt(schema, { ...base, acronym }, 'acronym')).toBe(V('modules.professionals.validation.acronym'))
  })

  it('refuses an unreadable pattern and over-long label or pattern', () => {
    expect(errorAt(schema, { ...base, licencePattern: '[' }, 'licencePattern')).toBe(V('modules.professionals.validation.licencePattern'))
    expect(errorAt(schema, { ...base, licenceLabel: 'x'.repeat(61) }, 'licenceLabel')).toBe(V('modules.professionals.validation.licenceLabelTooLong'))
    expect(errorAt(schema, { ...base, licencePattern: 'x'.repeat(201) }, 'licencePattern')).toBe(V('modules.professionals.validation.licencePatternTooLong'))
  })
})

describe('profession_titles', () => {
  it('requires a category; « Aucun ordre » sends null', () => {
    const schema = referenceSchemas.profession_titles
    expect(schema.parse({ name: 'Naturopathe', categoryId: IDS.naturopathie, orderId: '' })).toEqual({ name: 'Naturopathe', categoryId: IDS.naturopathie, orderId: null })
    expect(errorAt(schema, { name: 'X', categoryId: '', orderId: '' }, 'categoryId')).toBe(V('modules.professionals.validation.categoryRequired'))
  })
})

describe('clienteles', () => {
  const schema = referenceSchemas.clienteles

  it('reads ages; none for couples, families, groups', () => {
    expect(schema.parse({ name: 'Aînés', minAge: '65', maxAge: '' })).toEqual({ name: 'Aînés', minAge: 65, maxAge: null })
    expect(schema.parse({ name: 'Couples', minAge: '', maxAge: '' })).toEqual({ name: 'Couples', minAge: null, maxAge: null })
  })

  it('checks the bounds as save_clientele does', () => {
    expect(errorAt(schema, { name: 'X', minAge: '121', maxAge: '' }, 'minAge')).toBe(V('modules.professionals.validation.ages'))
    expect(errorAt(schema, { name: 'X', minAge: '', maxAge: '12' }, 'maxAge')).toBe(V('modules.professionals.validation.maxAgeNeedsMin'))
    expect(errorAt(schema, { name: 'X', minAge: '13', maxAge: '12' }, 'maxAge')).toBe(V('modules.professionals.validation.maxAgeBelowMin'))
  })
})

describe('motif_categories, motifs, languages, deactivation_reasons', () => {
  it('motif category: description optional (300), icon from the 20', () => {
    const schema = referenceSchemas.motif_categories
    expect(schema.parse({ name: 'Vie intérieure', description: ' ', icon: 'Brain' })).toEqual({ name: 'Vie intérieure', description: null, icon: 'Brain' })
    expect(errorAt(schema, { name: 'X', description: '', icon: 'Skull' }, 'icon')).toBe(V('modules.professionals.validation.icon'))
    expect(errorAt(schema, { name: 'X', description: 'x'.repeat(301), icon: 'Brain' }, 'description')).toBe(V('modules.professionals.validation.descriptionTooLong'))
  })

  it('motif: « Autres » sends null, the restricted switch as is', () => {
    expect(referenceSchemas.motifs.parse({ name: 'Proche aidance', categoryId: '', isRestricted: true })).toEqual({ name: 'Proche aidance', categoryId: null, isRestricted: true })
  })

  it('language: the code lower-cased, two letters', () => {
    expect(referenceSchemas.languages.parse({ name: 'Portugais', code: ' PT ' })).toEqual({ name: 'Portugais', code: 'pt' })
    expect(errorAt(referenceSchemas.languages, { name: 'X', code: 'por' }, 'code')).toBe(V('modules.professionals.validation.languageCode'))
  })

  it('deactivation reason: the two flags', () => {
    expect(referenceSchemas.deactivation_reasons.parse({ name: 'Congé', requiresNote: false, disablesAccount: true })).toEqual({ name: 'Congé', requiresNote: false, disablesAccount: true })
  })
})

describe('toReferenceFormValues', () => {
  it('fills the dialog from a row, null as empty', () => {
    expect(toReferenceFormValues('clienteles', CATALOG.clienteles[1]!)).toEqual({ name: 'Aînés', minAge: '65', maxAge: '' })
    expect(toReferenceFormValues('professional_orders', CATALOG.orders[0]!)).toEqual({
      name: 'Ordre des psychologues du Québec',
      acronym: 'OPQ',
      licenceLabel: 'N° de permis',
      licencePattern: '^[0-9]{5}$',
    })
    expect(toReferenceFormValues('motifs', CATALOG.motifs[3]!)).toEqual({ name: 'Sans catégorie', categoryId: '', isRestricted: false })
  })

  it('gives a new row its defaults', () => {
    expect(toReferenceFormValues('motif_categories', null)).toEqual({ name: '', description: '', icon: 'Brain' })
    expect(toReferenceFormValues('deactivation_reasons', null)).toEqual({ name: '', requiresNote: false, disablesAccount: false })
    expect(toReferenceFormValues('languages', null)).toEqual({ name: '', code: '' })
  })

  it('round-trips every catalogue row through its schema', () => {
    expect(referenceSchemas.professional_orders.parse(toReferenceFormValues('professional_orders', CATALOG.orders[0]!))).toMatchObject({ acronym: 'OPQ' })
    expect(referenceSchemas.profession_titles.parse(toReferenceFormValues('profession_titles', CATALOG.titles[0]!))).toMatchObject({ orderId: IDS.opq })
    expect(referenceSchemas.motif_categories.parse(toReferenceFormValues('motif_categories', CATALOG.motifCategories[0]!))).toMatchObject({ icon: 'Brain' })
  })
})
