// @vitest-environment node
import path from 'node:path'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { beforeAll, describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../api/parse'
import { IDS } from '../test/fixtures'
import { CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { readPdf } from '../test/pdf-text'
import { buildCatalogView } from '../lib/catalog-view'
import { buildFicheContent, type FicheInput } from './fiche-content'
import { FicheDocument } from './FicheDocument'
import { loadFicheFonts } from './fonts'

/**
 * The fiche rendered for real (react-pdf in Node, the app's Raleway files, Clinique MANA's logo)
 * and read back: what a client would see on paper, following PS Hub's generateReactPDF tests with
 * text extraction (Task 4c.5 « Tests »).
 */

const fontFile = (subset: string, weight: number) => path.resolve(`node_modules/@fontsource/raleway/files/raleway-${subset}-${weight}-normal.woff`)
const files = (subset: string) => ({ 400: fontFile(subset, 400), 500: fontFile(subset, 500), 600: fontFile(subset, 600), 700: fontFile(subset, 700) })
/** The lockup the renderer bundles (`MANA_LOGO_URL`), from the design system. */
const BRAND_LOGO = path.resolve('docs/design-system/assets/logo.png')
/** 1×1 PNGs without alpha (a logo, a photo): one image object each. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQa64BAAHgAR7osfNHAAAAAElFTkSuQmCC'
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOYLW0DAAJHAPMFhPWnAAAAAElFTkSuQmCC'
const P = 'modules.professionals.fiche.pdf'

let canDraw: (codePoint: number) => boolean
beforeAll(async () => {
  canDraw = await loadFicheFonts({ latin: files('latin'), latinExt: files('latin-ext') })
})

function record(over: Partial<ProfessionalRecord> = {}): ProfessionalRecord {
  const base = recordFixture()
  return { ...base, ...over, professional: { ...base.professional, status: 'active', ...over.professional } }
}

async function render(over: Partial<Omit<FicheInput, 'canDraw'>> = {}) {
  const content = buildFicheContent({
    record: record(),
    catalog: CATALOG_VIEW,
    titleId: null,
    clinic: { name: 'Clinique MANA', phone: '+15145550000', email: 'bonjour@cliniquemana.ca', website: 'https://www.cliniquemana.ca' },
    logo: null,
    brandLogo: BRAND_LOGO,
    photo: null,
    fees: null,
    generatedOn: '8 octobre 2026',
    ...over,
    canDraw,
  })
  return readPdf(await renderToBuffer(<FicheDocument content={content} />))
}

const all = (pages: string[]) => pages.join('\n')
/** An overline as printed (upper case). */
const upper = (text: string) => text.toLocaleUpperCase('fr-CA')

describe('FicheDocument', () => {
  it('prints the clinic, the person, the facts and the footer on one Letter page, never the clinic name as a header', async () => {
    const pdf = await render({ record: record({ publicProfile: { ...recordFixture().publicProfile, bio: 'Une présentation.', publicEmail: 'marie@exemple.ca', publicPhone: '+15145551234' } }) })
    expect(pdf.pages).toHaveLength(1)
    const text = all(pdf.pages)
    for (const expected of [
      '514 555-0000',
      'bonjour@cliniquemana.ca',
      'www.cliniquemana.ca',
      'MT',
      'Marie Tremblay',
      'Psychologue',
      'Membre de l’OPQ · N° de permis\u00a012345',
      'marie@exemple.ca · 514 555-1234',
      upper(t(`${P}.clienteles`)),
      'Couples',
      upper(t(`${P}.languages`)),
      'Français',
      t(`${P}.about`),
      'Une présentation.',
      upper(t(`${P}.fees`)),
      t(`${P}.feesPending`),
      'Fiche à jour le 8 octobre 2026 · Page 1 de 1',
    ]) {
      expect(text).toContain(expected)
    }
    // The logo stands for the clinic: its name (« Clinique MANA (local) » on a local stack) is never printed.
    expect(text).not.toContain('Clinique MANA')
    // One page: no running header (it starts on page 2).
    expect(text.split('\n')).not.toContain('Marie Tremblay · Psychologue')
    expect(pdf.title).toBe('Fiche de Marie Tremblay')
    expect(pdf.offPage).toBe(0)
  })

  it('draws lining figures: Raleway\'s old-style ones would drop 3, 4, 5, 7 and 9 below the line (P4-215)', () => {
    for (const fontWeight of [400, 500, 600, 700]) {
      const font = Font.getFont({ fontFamily: 'Raleway', fontWeight }).data
      const glyphs: { bbox: { minY: number } }[] = font?.layout('0123456789').glyphs ?? []
      expect(glyphs).toHaveLength(10)
      expect(glyphs.every((glyph) => glyph.bbox.minY > -30), `weight ${fontWeight}`).toBe(true)
    }
  })

  it('draws French with Raleway only: é è à ç « » ’ and no-break spaces, nothing missing, no fallback font', async () => {
    const bio = 'Un espace « où déposer ce qu’on vit », à son rythme\u202f: ça compte. Garçon, élève, Noël, cœur.'
    const pdf = await render({ record: record({ publicProfile: { ...recordFixture().publicProfile, bio } }) })
    // The narrow no-break space (absent from Raleway's latin subset) is printed as a no-break space.
    expect(all(pdf.pages)).toContain('Un espace « où déposer ce qu’on vit », à son rythme\u00a0: ça compte. Garçon, élève, Noël, cœur.')
    expect(pdf.notdef).toBe(0)
    expect(pdf.fonts.length).toBeGreaterThan(0)
    expect(pdf.fonts.every((font) => /\+Raleway-/.test(font))).toBe(true)
  })

  it('draws names beyond French from the latin-ext subset, under its own font name', async () => {
    const pdf = await render({ record: record({ professional: { ...recordFixture().professional, firstName: 'Łukasz', lastName: 'Dvořák' } }) })
    expect(all(pdf.pages)).toContain('Łukasz Dvořák')
    expect(pdf.notdef).toBe(0)
    expect(pdf.fonts.some((font) => font.endsWith('-LatinExt'))).toBe(true)
  })

  it('drops a character no font has (an emoji) instead of printing it garbled', async () => {
    const pdf = await render({ record: record({ publicProfile: { ...recordFixture().publicProfile, bio: 'Bienvenue 🙂 ici.' } }) })
    expect(all(pdf.pages)).toContain('Bienvenue  ici.')
    expect(pdf.fonts.every((font) => /\+Raleway-/.test(font))).toBe(true)
  })

  it('flows a long presentation over pages, the footer on each, the person named atop every page after the first', async () => {
    const paragraph = 'Elle accompagne les adultes dans les périodes où la vie pèse plus lourd : anxiété, deuil, transitions. '.repeat(5)
    const bio = Array.from({ length: 14 }, () => paragraph).join('\n\n')
    const pdf = await render({ record: record({ publicProfile: { ...recordFixture().publicProfile, bio, approach: 'Approche intégrative.' } }) })
    expect(pdf.pages.length).toBeGreaterThanOrEqual(2)
    expect(pdf.offPage).toBe(0)
    pdf.pages.forEach((page, i) => {
      expect(page).toContain(`Page ${i + 1} de ${pdf.pages.length}`)
      expect(page.split('\n')).toContain('www.cliniquemana.ca')
      if (i > 0) expect(page.split('\n')).toContain('Marie Tremblay · Psychologue')
    })
    // The free-text approach is not printed (P4-216).
    expect(all(pdf.pages)).not.toContain('Approche intégrative.')
  })

  it('names every one of 72 held motifs under its category, in columns, never « Tous » (P4-211)', async () => {
    // The legacy list's shape (8 categories of 9) with names as long as the clinic's real ones.
    const base = seventyTwoMotifsCatalog()
    const catalog = buildCatalogView({
      ...base,
      motifs: base.motifs.map((m) => (m.isActive ? { ...m, name: `${m.name} : difficultés relationnelles et transitions` } : m)),
    })
    const held = catalog.motifs.filter((m) => m.isActive)
    const pdf = await render({ catalog, record: record({ motifIds: held.map((m) => m.id) }) })
    const text = all(pdf.pages)
    // A long name may wrap inside its column: compare without line breaks.
    const flat = text.replace(/\s+/g, ' ')
    for (const motif of held) expect(flat, motif.name).toContain(motif.name)
    expect(text).not.toMatch(/\bTous\b/)
    expect(text).not.toMatch(/\d+ sur \d+/)
    const lines = text.split('\n')
    for (let c = 1; c <= 8; c++) expect(lines, `Catégorie ${c}`).toContain(`Catégorie ${c}`)
    expect(pdf.offPage).toBe(0)
    expect(pdf.pages.length).toBeLessThanOrEqual(3)
  })

  it("lists a category's motifs down three columns, its name on its own line above them", async () => {
    const catalog = seventyTwoMotifsCatalog()
    const held = [...['0-0', '0-1', '0-2', '0-3', '0-4', '0-5'], ...['1-0', '1-1']].map((k) => `m-${k}`)
    const lines = all((await render({ catalog, record: record({ motifIds: held }) })).pages).split('\n')
    const first = lines.indexOf('Catégorie 1')
    // Down the columns: 1.1 and 1.2 in the first, 1.3 and 1.4 in the second…
    expect(lines.slice(first + 1, first + 7)).toEqual(['Motif 1.1', 'Motif 1.2', 'Motif 1.3', 'Motif 1.4', 'Motif 1.5', 'Motif 1.6'])
    const second = lines.indexOf('Catégorie 2')
    expect(lines.slice(second + 1, second + 3)).toEqual(['Motif 2.1', 'Motif 2.2'])
  })

  it('makes the fiche of the title chosen, with that title\'s order and licence only', async () => {
    const two = record({
      professions: [
        { id: 'row-1', titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true },
        { id: 'row-2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: false },
      ],
    })
    const second = all((await render({ record: two, titleId: IDS.naturopathe })).pages)
    expect(second).toContain('Naturopathe')
    expect(second).not.toContain('Psychologue')
    expect(second).not.toContain('OPQ')
    const primary = all((await render({ record: two, titleId: null })).pages)
    expect(primary).toContain('Psychologue')
    expect(primary).toContain('Membre de l’OPQ')
    expect(primary).not.toContain('Naturopathe')
  })

  it('reads « Honoraires : À confirmer » without Services et tarifs, the fees once they exist', async () => {
    const pending = all((await render()).pages)
    expect(pending).toContain(upper(t(`${P}.fees`)))
    expect(pending).toContain(t(`${P}.feesPending`))
    const priced = all((await render({ fees: ['Individuel, 50 min : 120 $'] })).pages)
    expect(priced).toContain('Individuel, 50 min : 120 $')
    expect(priced).not.toContain(t(`${P}.feesPending`))
  })

  it('marks specialised clientèles with the star and its legend', async () => {
    const text = all((await render()).pages)
    expect(text).toContain(t(`${P}.specialized`))
    const plain = all((await render({ record: record({ clienteles: [{ id: IDS.couples, specialized: false }] }) })).pages)
    expect(plain).not.toContain(t(`${P}.specialized`))
  })

  it('always prints a logo: Clinique MANA\'s lockup, or the one uploaded in Settings; the initials until a photo exists', async () => {
    // The lockup is a PNG with transparency: the image and its soft mask.
    const brand = await render()
    expect(brand.images).toBe(2)
    expect(brand.pages[0]).toContain('MT')
    // An uploaded logo (opaque 1×1 here) replaces it.
    expect((await render({ logo: PNG })).images).toBe(1)
    const both = await render({ logo: PNG, photo: PHOTO })
    expect(both.images).toBe(2)
    expect(both.pages[0]?.split('\n')).not.toContain('MT')
    for (const pdf of [brand, both]) expect(all(pdf.pages)).not.toContain('Clinique MANA')
  })
})
