import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { frenchSpacing, NNBSP, setFrenchSpacing, t } from './index'
import frCA from './fr-CA.json'

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

describe('frenchSpacing', () => {
  const n = NNBSP

  it('puts a narrow no-break space instead of a plain space before ? ! ; :', () => {
    expect(frenchSpacing('Supprimer ?')).toBe(`Supprimer${n}?`)
    expect(frenchSpacing('Attention !')).toBe(`Attention${n}!`)
    expect(frenchSpacing('une ligne vide ; du gras')).toBe(`une ligne vide${n}; du gras`)
    expect(frenchSpacing('Courriel : {email}')).toBe(`Courriel${n}: {email}`)
  })

  it('puts one inside guillemets, with or without a space in the template', () => {
    expect(frenchSpacing('Cliquez sur « Continuer ».')).toBe(`Cliquez sur «${n}Continuer${n}».`)
    expect(frenchSpacing('Cliquez sur «Continuer».')).toBe(`Cliquez sur «${n}Continuer${n}».`)
    expect(frenchSpacing(`«\u00A0Continuer\u00A0»`)).toBe(`«${n}Continuer${n}»`)
    expect(frenchSpacing(`«${n}Continuer${n}»`)).toBe(`«${n}Continuer${n}»`)
  })

  it('leaves times, URLs and query strings alone (no space before the mark)', () => {
    expect(frenchSpacing('à 14:30')).toBe('à 14:30')
    expect(frenchSpacing('https://cliniquemana.com/?page=1&a=b')).toBe('https://cliniquemana.com/?page=1&a=b')
    expect(frenchSpacing('Merci!')).toBe('Merci!')
  })

  it('is idempotent', () => {
    const once = frenchSpacing('Exécuter « {label} » maintenant ?')
    expect(frenchSpacing(once)).toBe(once)
  })
})

describe('t and French spacing', () => {
  beforeAll(() => setFrenchSpacing(true))
  afterAll(() => setFrenchSpacing(false))

  it('spaces the template', () => {
    expect(t('auth.login.forgot')).toBe(`Mot de passe oublié${NNBSP}?`)
  })

  it('never rewrites an interpolated value', () => {
    expect(t('nav.palette.empty', { query: 'a :b ?c «d»' })).toBe(`Aucun résultat pour «${NNBSP}a :b ?c «d»${NNBSP}».`)
  })

  it('leaves no plain space before ? ! ; : nor inside « » in any dictionary string once spaced (the list to clean: scripts/report-french-spacing.mjs)', () => {
    const left: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (/ [?!;:]|«[^\u202F]|[^\u202F]»/.test(frenchSpacing(node))) left.push(path)
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key)
      }
    }
    walk(frCA, '')
    expect(left).toEqual([])
  })
})
