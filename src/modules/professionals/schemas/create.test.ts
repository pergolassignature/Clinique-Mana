import { describe, expect, expectTypeOf, it } from 'vitest'
import { t } from '@/i18n'
import { CREATE_PROFESSIONAL_DEFAULTS, createProfessionalSchema } from './create'
import type { NewProfessional } from '../api/record'
import { CATALOG, CATALOG_VIEW } from '../test/fixtures-domain'
import { buildCatalogView } from '../lib/catalog-view'
import { IDS } from '../test/fixtures'
import { errorAt } from '../test/schema-helpers'

const schema = createProfessionalSchema(CATALOG_VIEW)
const values = (overrides: Partial<typeof CREATE_PROFESSIONAL_DEFAULTS> = {}) => ({
  ...CREATE_PROFESSIONAL_DEFAULTS,
  firstName: 'Marie',
  lastName: 'Tremblay',
  email: 'marie@exemple.ca',
  ...overrides,
})

describe('createProfessionalSchema', () => {
  it('outputs what createProfessional takes', () => {
    expectTypeOf(schema.parse(values())).toEqualTypeOf<NewProfessional>()
  })

  it('normalises: names tidy, email trimmed and lower-cased, empty title → null', () => {
    expect(schema.parse(values({ firstName: '  Marie  Ève ', email: '  Marie.T@Exemple.CA ' }))).toEqual({
      firstName: 'Marie Ève',
      lastName: 'Tremblay',
      email: 'marie.t@exemple.ca',
      titleId: null,
      licenceNumber: null,
    })
  })

  it('requires the names, a valid email', () => {
    expect(errorAt(schema, values({ firstName: ' ' }), 'firstName')).toBe('Prénom requis.')
    expect(errorAt(schema, values({ lastName: '' }), 'lastName')).toBe('Nom requis.')
    expect(errorAt(schema, values({ firstName: 'x'.repeat(81) }), 'firstName')).toBe(t('modules.professionals.validation.maxChars', { max: '80' }))
    expect(errorAt(schema, values({ email: 'x' }), 'email')).toBe('Courriel invalide.')
    expect(errorAt(schema, values({ email: `${'a'.repeat(250)}@x.ca` }), 'email')).toBe('Courriel invalide.')
  })

  it('requires the licence for a regulated title, in the order’s format (P4-35)', () => {
    expect(errorAt(schema, values({ titleId: IDS.psychologue }), 'licenceNumber')).toBe('Le numéro de permis est requis pour ce titre.')
    expect(errorAt(schema, values({ titleId: IDS.psychologue, licenceNumber: 'abc' }), 'licenceNumber')).toBe(
      t('modules.professionals.validation.licenceOrderFormat', { title: 'Psychologue' }),
    )
    expect(schema.parse(values({ titleId: IDS.psychologue, licenceNumber: ' 12345 ' }))).toMatchObject({ titleId: IDS.psychologue, licenceNumber: '12345' })
  })

  it('refuses an archived title (a stale draft)', () => {
    expect(errorAt(schema, values({ titleId: IDS.archivedTitle }), 'titleId')).toBe(t('modules.professionals.validation.titleArchived'))
  })

  it('leaves an order format JavaScript reads differently to the database', () => {
    const catalog = buildCatalogView({ ...CATALOG, orders: CATALOG.orders.map((o) => ({ ...o, licencePattern: '^[[:digit:]]{5}$' })) })
    expect(createProfessionalSchema(catalog).parse(values({ titleId: IDS.psychologue, licenceNumber: 'abc' }))).toMatchObject({ licenceNumber: 'abc' })
  })

  it('needs no licence for a title without an order', () => {
    expect(schema.parse(values({ titleId: IDS.naturopathe }))).toMatchObject({ titleId: IDS.naturopathe, licenceNumber: null })
  })

  it('refuses a malformed licence, and drops one typed without a title', () => {
    expect(errorAt(schema, values({ titleId: IDS.naturopathe, licenceNumber: '#1' }), 'licenceNumber')).toBe('Numéro de permis invalide.')
    expect(schema.parse(values({ licenceNumber: '12345' })).licenceNumber).toBeNull()
  })
})
