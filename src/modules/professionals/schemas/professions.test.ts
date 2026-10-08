import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { matchesOrderPattern, professionItemSchema, professionsSchema, toProfessionItems } from './professions'
import { CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
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
})
