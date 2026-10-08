import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { deactivateSchema, overrideSchema } from './status'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { errorAt } from '../test/schema-helpers'

const schema = deactivateSchema(CATALOG.deactivationReasons)

describe('deactivateSchema', () => {
  it('needs an active reason', () => {
    expect(errorAt(schema, { reasonId: '', note: '' }, 'reasonId')).toBe('Choisissez une raison.')
    expect(errorAt(schema, { reasonId: 'unknown', note: '' }, 'reasonId')).toBe('Choisissez une raison.')
    const archived = deactivateSchema(CATALOG.deactivationReasons.map((r) => ({ ...r, isActive: r.id !== IDS.leave })))
    expect(errorAt(archived, { reasonId: IDS.leave, note: '' }, 'reasonId')).toBe('Choisissez une raison.')
  })

  it('needs a note when the reason requires one (« Autre »)', () => {
    expect(errorAt(schema, { reasonId: IDS.other, note: '  ' }, 'note')).toBe('Précisez la raison.')
    expect(schema.parse({ reasonId: IDS.other, note: ' Départ ' })).toEqual({ reasonId: IDS.other, note: 'Départ' })
  })

  it('stores no note as null, and caps it at 500', () => {
    expect(schema.parse({ reasonId: IDS.leave, note: '' })).toEqual({ reasonId: IDS.leave, note: null })
    expect(errorAt(schema, { reasonId: IDS.leave, note: 'x'.repeat(501) }, 'note')).toBe(t('modules.professionals.validation.noteMax'))
  })
})

describe('overrideSchema', () => {
  it('needs 5 to 500 characters, trimmed', () => {
    expect(errorAt(overrideSchema, { reason: ' abc ' }, 'reason')).toBe('Indiquez la raison (au moins 5 caractères).')
    expect(errorAt(overrideSchema, { reason: 'x'.repeat(501) }, 'reason')).toBe(t('modules.professionals.validation.overrideReasonMax'))
    expect(overrideSchema.parse({ reason: ' Dossier complété hors application ' })).toEqual({ reason: 'Dossier complété hors application' })
  })
})
