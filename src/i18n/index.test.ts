import { describe, expect, it } from 'vitest'
import { t } from './index'

describe('t', () => {
  it('returns the French text of a key', () => {
    expect(t('nav.home')).toBe('Accueil')
  })

  it('fills {placeholders} from the values', () => {
    expect(t('nav.userMenu', { name: 'Camille Tremblay' })).toBe('Menu de Camille Tremblay')
  })

  it('leaves a placeholder without a value as written', () => {
    expect(t('nav.userMenu')).toBe('Menu de {name}')
    expect(t('nav.userMenu', {})).toBe('Menu de {name}')
  })

  it('does not read inherited properties as values', () => {
    expect(t('nav.userMenu', { other: 'x' })).toBe('Menu de {name}')
  })
})
