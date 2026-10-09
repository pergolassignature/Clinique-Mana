import { describe, expect, it } from 'vitest'
import { titleLabel } from './title-label'

const SOCIAL_WORK = { name: 'Travailleuse sociale ou travailleur social', nameFeminine: 'Travailleuse sociale', nameMasculine: 'Travailleur social' }

describe('titleLabel (P4-342)', () => {
  it('reads the feminine form for « Femme », the masculine form for « Homme »', () => {
    expect(titleLabel(SOCIAL_WORK, 'female')).toBe('Travailleuse sociale')
    expect(titleLabel(SOCIAL_WORK, 'male')).toBe('Travailleur social')
  })

  it('reads the name for « Autre / non précisé » and without a gender', () => {
    expect(titleLabel(SOCIAL_WORK, 'unspecified')).toBe('Travailleuse sociale ou travailleur social')
    expect(titleLabel(SOCIAL_WORK, null)).toBe('Travailleuse sociale ou travailleur social')
  })

  it('falls back to the name when the form is empty', () => {
    const feminineOnly = { ...SOCIAL_WORK, nameMasculine: null }
    expect(titleLabel(feminineOnly, 'female')).toBe('Travailleuse sociale')
    expect(titleLabel(feminineOnly, 'male')).toBe('Travailleuse sociale ou travailleur social')
    const none = { name: 'Psychologue', nameFeminine: null, nameMasculine: null }
    expect(titleLabel(none, 'female')).toBe('Psychologue')
    expect(titleLabel(none, 'male')).toBe('Psychologue')
  })
})
