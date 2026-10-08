import { describe, expect, it } from 'vitest'
import type { ProfessionalRecord } from '../api/parse'
import { IDS } from '../test/fixtures'
import { CATALOG_VIEW, motifsCatalog, recordFixture, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { buildFicheContent, displayWebsite, initialsOf, toPdfText, type FicheInput } from './fiche-content'

const CLINIC = { name: 'Clinique MANA', phone: '+15145550000', email: 'bonjour@cliniquemana.ca', website: 'https://www.cliniquemana.ca/' }

function input(over: Partial<FicheInput> = {}, record: Partial<ProfessionalRecord> = {}): FicheInput {
  return {
    record: { ...recordFixture(), ...record },
    catalog: CATALOG_VIEW,
    titleId: null,
    clinic: CLINIC,
    logo: null,
    brandLogo: '/assets/logo.png',
    photo: null,
    fees: null,
    generatedOn: '8 octobre 2026',
    ...over,
  }
}

describe('buildFicheContent', () => {
  it('names the clinic from Settings: phone formatted, website without its scheme, empty ones left out', () => {
    expect(buildFicheContent(input()).clinic).toEqual({
      name: 'Clinique MANA',
      contact: ['514 555-0000', 'bonjour@cliniquemana.ca', 'www.cliniquemana.ca'],
      logo: { src: '/assets/logo.png', brand: true },
      website: 'www.cliniquemana.ca',
    })
    const bare = buildFicheContent(input({ clinic: { name: 'Clinique', phone: null, email: null, website: null } })).clinic
    expect(bare.contact).toEqual([])
    expect(bare.website).toBeNull()
  })

  it('prints the logo uploaded in Settings, else Clinique MANA\'s lockup: never no logo (P4-214)', () => {
    expect(buildFicheContent(input({ logo: 'data:image/png;base64,x' })).clinic.logo).toEqual({ src: 'data:image/png;base64,x', brand: false })
    expect(buildFicheContent(input({ logo: null })).clinic.logo).toEqual({ src: '/assets/logo.png', brand: true })
  })

  it.each([
    ['Marie', 'Tremblay', 'MT'],
    ['Marc-André', 'Pelletier', 'MP'],
    ['étienne', 'Fortin', 'ÉF'],
    ['  Łukasz ', 'Dvořák', 'ŁD'],
  ])('draws the initials of %s %s as « %s » while there is no photo', (firstName, lastName, initials) => {
    expect(initialsOf(firstName, lastName)).toBe(initials)
  })

  it('prints the primary title by default, « Membre de l’ordre » and the licence, as the clinic site does', () => {
    const content = buildFicheContent(input())
    expect(content.name).toBe('Marie Tremblay')
    expect(content.title).toBe('Psychologue')
    expect(content.credential).toBe('Membre de l’OPQ · N° de permis\u00a012345')
  })

  it('prints the title chosen among two, a title without an order without a credential', () => {
    const professions = [
      { id: 'r1', titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true },
      { id: 'r2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: false },
    ]
    const content = buildFicheContent(input({ titleId: IDS.naturopathe }, { professions }))
    expect(content.title).toBe('Naturopathe')
    expect(content.credential).toBeNull()
    // An unknown title id falls back to the primary one.
    expect(buildFicheContent(input({ titleId: 'unknown' }, { professions })).title).toBe('Psychologue')
  })

  it('has no title line without a title', () => {
    const content = buildFicheContent(input({}, { professions: [] }))
    expect(content.title).toBeNull()
    expect(content.credential).toBeNull()
  })

  it('makes « À propos » of the presentation, as paragraphs, never the approach text (P4-216); empty prints nothing', () => {
    const publicProfile = { ...recordFixture().publicProfile, bio: '  Premier.\n\n\nDeuxième,\nsuite.  ', approach: 'Mon approche.' }
    expect(buildFicheContent(input({}, { publicProfile })).about).toEqual(['Premier.', 'Deuxième,\nsuite.'])
    expect(JSON.stringify(buildFicheContent(input({}, { publicProfile })))).not.toContain('Mon approche.')
    expect(buildFicheContent(input({}, { publicProfile: { ...publicProfile, bio: '   ' } })).about).toEqual([])
  })

  it('prints the public contact when set', () => {
    expect(buildFicheContent(input()).publicContact).toBeNull()
    const publicProfile = { ...recordFixture().publicProfile, publicEmail: 'marie@exemple.ca', publicPhone: '+15145551234' }
    expect(buildFicheContent(input({}, { publicProfile })).publicContact).toBe('marie@exemple.ca · 514 555-1234')
  })

  it('lists clientèles ★ first, never an archived one, languages by name; no approaches (P4-210)', () => {
    const content = buildFicheContent(
      input({}, {
        clienteles: [
          { id: IDS.children, specialized: false },
          { id: IDS.couples, specialized: true },
          { id: IDS.seniors, specialized: false },
        ],
        specialties: [{ id: IDS.cbt, specialized: true }],
        languageIds: [IDS.en, IDS.fr],
      }),
    )
    expect(content.clienteles).toEqual([
      { label: 'Couples', specialized: true },
      { label: 'Enfants (0 à 12 ans)', specialized: false },
      { label: 'Aînés (65 ans et plus)', specialized: false },
    ])
    expect(content).not.toHaveProperty('approaches')
    expect(JSON.stringify(content)).not.toContain('Thérapie cognitivo-comportementale')
    expect(content.languages).toEqual(['Français', 'Anglais'])
  })

  it('names all 72 held motifs under their category, never a summary (P4-211)', () => {
    const catalog = seventyTwoMotifsCatalog()
    const motifIds = catalog.motifs.filter((m) => m.isActive).map((m) => m.id)
    const { motifs } = buildFicheContent(input({ catalog }, { motifIds }))
    expect(motifs.map((group) => group.name)).toEqual(Array.from({ length: 8 }, (_, c) => `Catégorie ${c + 1}`))
    expect(motifs.flatMap((group) => group.names)).toEqual(catalog.motifs.filter((m) => m.isActive).map((m) => m.name))
  })

  it('names the held motifs of each category in the catalogue order; archived ones never print', () => {
    const catalog = motifsCatalog([9, 2])
    const motifIds = ['m-0-0', 'm-0-4', 'm-0-8', 'm-0-2', 'm-1-0', 'm-1-1', 'm-archived']
    const { motifs } = buildFicheContent(input({ catalog }, { motifIds }))
    expect(motifs).toEqual([
      { name: 'Catégorie 1', names: ['Motif 1.1', 'Motif 1.3', 'Motif 1.5', 'Motif 1.9'] },
      { name: 'Catégorie 2', names: ['Motif 2.1', 'Motif 2.2'] },
    ])
  })

  it('keeps « Honoraires » pending without fees, the initials in the photo slot without a photo', () => {
    const content = buildFicheContent(input())
    expect(content.fees).toBeNull()
    expect(content.photo).toBeNull()
    expect(content.initials).toBe('MT')
    expect(buildFicheContent(input({ fees: ['Individuel, 50 min : 120 $'], photo: 'data:image/png;base64,x' }))).toMatchObject({
      fees: ['Individuel, 50 min : 120 $'],
      photo: 'data:image/png;base64,x',
    })
  })

  it('passes every text through what the fonts can draw', () => {
    const canDraw = (codePoint: number) => codePoint < 0x2000 || codePoint === 0x2019
    const publicProfile = { ...recordFixture().publicProfile, bio: 'Bonjour 🙂 l’équipe\u202f!' }
    const content = buildFicheContent(input({ canDraw }, { publicProfile, professional: { ...recordFixture().professional, firstName: 'Ǹadia' } }))
    expect(content.about).toEqual(['Bonjour  l’équipe\u00a0!'])
    expect(content.name).toBe('Ǹadia Tremblay')
  })
})

describe('toPdfText', () => {
  it('normalises, keeps line breaks, drops control characters, maps the narrow no-break space', () => {
    expect(toPdfText('Ge\u0301rald\r\nRoy\tici\u0007\u202f:')).toBe('Gérald\nRoy ici\u00a0:')
  })

  it('replaces a character the fonts lack by its base letter, or drops it', () => {
    const latinOnly = (codePoint: number) => codePoint <= 0xff
    expect(toPdfText('Łukasz ǹ ★ ok', latinOnly)).toBe('ukasz n  ok')
  })
})

describe('displayWebsite', () => {
  it.each([
    ['https://www.cliniquemana.ca/', 'www.cliniquemana.ca'],
    ['http://cliniquemana.ca/rendez-vous', 'cliniquemana.ca/rendez-vous'],
  ])('%s → %s', (url, shown) => expect(displayWebsite(url)).toBe(shown))
})
