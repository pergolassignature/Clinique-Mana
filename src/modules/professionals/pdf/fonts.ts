import { Font } from '@react-pdf/renderer'
import { FICHE_FONT_FILES, type FicheFontFiles, type FicheFontWeight } from './font-files'

/**
 * Raleway for the fiche (PS Hub's `fonts.ts`, with the clinic website's typeface, P4-214):
 * registered once, with hyphenation off (French words are never cut), in two families, the latin
 * subset first and latin-ext where it has no glyph (react-pdf picks per character from the
 * `fontFamily` list).
 */

const LATIN = 'Raleway'
const LATIN_EXT = 'Raleway-LatinExt'
const WEIGHTS: readonly FicheFontWeight[] = [400, 500, 600, 700]

/** The fiche's `fontFamily`: every text style uses it. */
export const FICHE_FONT_FAMILY = [LATIN, LATIN_EXT]

/**
 * Raleway's default figures are old-style (« 514 » with descenders), which make phone, licence
 * and price lines look uneven. Its `lnum` feature draws lining figures, but react-pdf 4.3.1 never
 * passes `fontFeatureSettings` to fontkit (textkit calls `font.layout(text, undefined, …)`), so
 * each loaded font asks for `lnum` itself whenever no feature is given (P4-215).
 */
const LINING_FIGURES = ['lnum']

type LayoutFn = (text: string, features?: unknown, ...rest: unknown[]) => unknown

function liningFigures(font: object): void {
  const layout = (font as { layout: LayoutFn }).layout.bind(font)
  Object.defineProperty(font, 'layout', {
    value: (text: string, features?: unknown, ...rest: unknown[]) => layout(text, features ?? LINING_FIGURES, ...rest),
  })
}

let ready: Promise<(codePoint: number) => boolean> | null = null

/**
 * Registers and loads the fonts once per page load, then resolves with a test of the characters
 * they can draw (`toPdfText` drops the others rather than let react-pdf fall back to Helvetica,
 * which prints them garbled). react-pdf keeps a font's first load, failed or not: a font that
 * could not be fetched fails every fiche until the page is reloaded (the error says so).
 *
 * The two subsets carry the same PostScript name (« Raleway-Regular »…), and the PDF writer keeps
 * one embedded font per name: latin-ext glyphs would be drawn from the latin font. Each latin-ext
 * font is renamed (« Raleway-Regular-LatinExt ») once loaded, before any render (P4-205;
 * `FicheDocument.test.tsx` renders « Łukasz Dvořák » to hold this).
 */
export function loadFicheFonts(files: FicheFontFiles = FICHE_FONT_FILES): Promise<(codePoint: number) => boolean> {
  ready ??= register(files)
  return ready
}

async function register(files: FicheFontFiles): Promise<(codePoint: number) => boolean> {
  Font.registerHyphenationCallback((word) => [word])
  Font.register({ family: LATIN, fonts: WEIGHTS.map((fontWeight) => ({ src: files.latin[fontWeight], fontWeight })) })
  Font.register({ family: LATIN_EXT, fonts: WEIGHTS.map((fontWeight) => ({ src: files.latinExt[fontWeight], fontWeight })) })
  const load = (fontFamily: string) => WEIGHTS.map((fontWeight) => Font.load({ fontFamily, fontWeight }).then(() => Font.getFont({ fontFamily, fontWeight }).data))
  const [latin, latinExt] = await Promise.all([Promise.all(load(LATIN)), Promise.all(load(LATIN_EXT))])
  for (const font of latinExt) {
    if (font) Object.defineProperty(font, 'postscriptName', { value: `${font.postscriptName}-LatinExt` })
  }
  for (const font of [...latin, ...latinExt]) {
    if (font) liningFigures(font)
  }
  // Every weight is the same subset: the regular one answers for all.
  const covered = [latin[0], latinExt[0]]
  return (codePoint) => covered.some((font) => font?.hasGlyphForCodePoint(codePoint) === true)
}
