import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { matchesOrderPattern, professionItemSchema, professionsErrorField, professionsSchema, toProfessionItems } from './professions'
import { CATALOG, CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { buildCatalogView } from '../lib/catalog-view'
import { IDS } from '../test/fixtures'
import { errorAt } from '../test/schema-helpers'

const schema = (heldTitleIds: string[] = [], heldMotifIds: string[] = []) => professionsSchema(CATALOG_VIEW, { heldTitleIds, heldMotifIds })
const psy = (overrides = {}) => ({ titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: false, ...overrides })
const naturo = (overrides = {}) => ({ titleId: IDS.naturopathe, licenceNumber: '', isPrimary: false, ...overrides })

describe('professionItemSchema', () => {
  it('requires a title and checks the base licence format', () => {
    expect(errorAt(professionItemSchema, { titleId: '', licenceNumber: '', isPrimary: true }, 'titleId')).toBe(t('modules.professionals.validation.titleRequired'))
    expect(errorAt(professionItemSchema, { titleId: 'x', licenceNumber: '-12', isPrimary: true }, 'licenceNumber')).toBe('Numéro de permis invalide.')
    expect(errorAt(professionItemSchema, { titleId: 'x', licenceNumber: '1'.repeat(31), isPrimary: true }, 'licenceNumber')).toBe('Numéro de permis invalide.')
    expect(professionItemSchema.parse({ titleId: 'x', licenceNumber: ' AB 12-3 ', isPrimary: true }).licenceNumber).toBe('AB 12-3')
  })
})

describe('professionsSchema', () => {
  it('round-trips the record’s titles', () => {
    const items = toProfessionItems(recordFixture().professions)
    expect(items).toEqual([{ titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true }])
    expect(schema([IDS.psychologue]).parse(items)).toEqual([{ titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true }])
  })

  it('makes the first title primary when none is flagged (removing the primary promotes the other)', () => {
    expect(schema().parse([naturo(), psy()])).toEqual([
      { titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true },
      { titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: false },
    ])
    expect(schema().parse([naturo(), psy({ isPrimary: true })]).map((p) => p.isPrimary)).toEqual([false, true])
  })

  it('allows none, at most two, each once, one primary', () => {
    expect(schema().parse([])).toEqual([])
    expect(errorAt(schema(), [psy(), naturo(), psy()])).toBe('Un professionnel a au plus deux titres.')
    expect(errorAt(schema(), [psy(), psy()], '1.titleId')).toBe(t('modules.professionals.validation.titleRepeated'))
    expect(errorAt(schema(), [psy({ isPrimary: true }), naturo({ isPrimary: true })])).toBe('Un seul titre principal.')
  })

  it('requires the licence of a regulated title, in its order’s format', () => {
    expect(errorAt(schema(), [psy({ licenceNumber: '' })], '0.licenceNumber')).toBe('Le numéro de permis est requis pour ce titre.')
    expect(errorAt(schema(), [psy({ licenceNumber: 'abc' })], '0.licenceNumber')).toBe(
      t('modules.professionals.validation.licenceOrderFormat', { title: 'Psychologue' }),
    )
  })

  it('keeps an archived title already held, refuses adding one', () => {
    const archived = { titleId: IDS.archivedTitle, licenceNumber: '', isPrimary: true }
    expect(schema([IDS.archivedTitle]).safeParse([archived]).success).toBe(true)
    expect(errorAt(schema([]), [archived], '0.titleId')).toBe('Ce titre est archivé.')
  })

  it('keeps the last regulated title while restricted motifs are held', () => {
    expect(errorAt(schema([IDS.psychologue], [IDS.psychose, IDS.anxiete]), [naturo()])).toBe(
      t('modules.professionals.validation.restrictedMotifsHeld', { names: 'Psychose' }),
    )
    expect(schema([IDS.psychologue], [IDS.anxiete]).safeParse([naturo()]).success).toBe(true)
    expect(schema([IDS.psychologue], [IDS.psychose]).safeParse([psy(), naturo()]).success).toBe(true)
  })
})

describe('matchesOrderPattern', () => {
  it('checks the order’s format, and leaves a pattern JavaScript cannot read to the database', () => {
    expect(matchesOrderPattern('^[0-9]{5}$', '12345')).toBe(true)
    expect(matchesOrderPattern('^[0-9]{5}$', '1234')).toBe(false)
    expect(matchesOrderPattern(null, 'x')).toBe(true)
    expect(matchesOrderPattern('(', 'x')).toBe(true)
  })

  it.each(['^[[:digit:]]{5}$', '^\\d{5}\\M', '(?i)^ab[0-9]+$', '^([0-9])\\1$'])('leaves %s (read differently by JavaScript) to the database', (pattern) => {
    expect(matchesOrderPattern(pattern, 'abc')).toBe(true)
  })
})

describe('professionsSchema with an order format in PostgreSQL-only syntax', () => {
  it('skips the client format check; the database decides', () => {
    const catalog = buildCatalogView({ ...CATALOG, orders: CATALOG.orders.map((o) => ({ ...o, licencePattern: '^\\y[0-9]{5}\\y$' })) })
    const items = [psy({ licenceNumber: 'AB 1' })]
    expect(professionsSchema(catalog, { heldTitleIds: [], heldMotifIds: [] }).parse(items)).toEqual([{ titleId: IDS.psychologue, licenceNumber: 'AB 1', isPrimary: true }])
    expect(errorAt(schema(), items, '0.licenceNumber')).toBe(t('modules.professionals.validation.licenceOrderFormat', { title: 'Psychologue' }))
  })
})

describe('professionsErrorField', () => {
  const items = [{ titleId: 'a' }, { titleId: 'b' }]
  const refusal = (hint: string, details: string) => ({ code: 'P0001', message: 'x', hint, details })

  it('routes by HINT to the row whose title the DETAIL names', () => {
    expect(professionsErrorField(refusal('licence', 'b'), items)).toBe('items.1.licenceNumber')
    expect(professionsErrorField(refusal('title', 'a'), items)).toBe('items.0.titleId')
  })

  it('takes the last row for a title chosen twice', () => {
    expect(professionsErrorField(refusal('title', 'a'), [{ titleId: 'a' }, { titleId: 'a' }])).toBe('items.1.titleId')
  })

  it('is null for a refusal about the list, a title no row holds, or another code', () => {
    expect(professionsErrorField(refusal('', ''), items)).toBeNull()
    expect(professionsErrorField(refusal('licence', 'z'), items)).toBeNull()
    expect(professionsErrorField(refusal('licence', ''), items)).toBeNull()
    expect(professionsErrorField({ code: '22023', message: 'Titre inconnu.', hint: 'title', details: 'a' }, items)).toBeNull()
  })
})
