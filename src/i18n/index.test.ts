import { describe, expect, it } from 'vitest'
import { ofName, t } from './index'

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

  it('elides « de » and « que » before a name that starts with a vowel or a y, never before a h', () => {
    expect(t('nav.userMenu', { name: 'Aurélie Essai' })).toBe("Menu d'Aurélie Essai")
    expect(t('nav.userMenu', { name: 'Émilie Roy' })).toBe("Menu d'Émilie Roy")
    expect(t('nav.userMenu', { name: 'Yves Côté' })).toBe("Menu d'Yves Côté")
    expect(t('nav.userMenu', { name: 'Hélène Roy' })).toBe('Menu de Hélène Roy')
    expect(t('modules.professionals.record.matching.places.help', { firstName: 'Aurélie' })).toMatch(/^Nombre de nouveaux clients qu'Aurélie peut accueillir/)
    expect(t('modules.professionals.submission.card.description', { firstName: 'Aurélie' })).toMatch(/^Ce qu'Aurélie a envoyé/)
  })
})

describe('ofName', () => {
  it('« d’ » before a vowel or a y, « de » otherwise (h included)', () => {
    expect(ofName('Aurélie')).toBe("d'Aurélie")
    expect(ofName('Isabelle')).toBe("d'Isabelle")
    expect(ofName('Marie')).toBe('de Marie')
    expect(ofName('Hugo')).toBe('de Hugo')
  })
})
