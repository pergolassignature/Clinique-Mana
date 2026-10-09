// Raleway for the fiche, the clinic website's typeface (P4-214), from @fontsource/raleway: hashed
// assets Vite emits only because this chunk (loaded on « Fiche PDF ») imports them.
//
// WOFF 1, not WOFF2: fontkit 2.0.4 (under @react-pdf/renderer) crashes while subsetting the
// composite glyphs of a WOFF2 font (é, à, ç…), as scripts/build-pdf-fonts.ts notes for pdfmake.
// Two subsets per weight: latin (French and the rest of Latin-1, Œ, ’ « » and the no-break space)
// and latin-ext (Łukasz, Dvořák, Ștefan…), used where latin has no glyph.
import latin400 from '@fontsource/raleway/files/raleway-latin-400-normal.woff?url'
import latin500 from '@fontsource/raleway/files/raleway-latin-500-normal.woff?url'
import latin600 from '@fontsource/raleway/files/raleway-latin-600-normal.woff?url'
import latin700 from '@fontsource/raleway/files/raleway-latin-700-normal.woff?url'
import latinExt400 from '@fontsource/raleway/files/raleway-latin-ext-400-normal.woff?url'
import latinExt500 from '@fontsource/raleway/files/raleway-latin-ext-500-normal.woff?url'
import latinExt600 from '@fontsource/raleway/files/raleway-latin-ext-600-normal.woff?url'
import latinExt700 from '@fontsource/raleway/files/raleway-latin-ext-700-normal.woff?url'

/** The weights the fiche uses. */
export type FicheFontWeight = 400 | 500 | 600 | 700

export interface FicheFontFiles {
  latin: Readonly<Record<FicheFontWeight, string>>
  latinExt: Readonly<Record<FicheFontWeight, string>>
}

export const FICHE_FONT_FILES: FicheFontFiles = {
  latin: { 400: latin400, 500: latin500, 600: latin600, 700: latin700 },
  latinExt: { 400: latinExt400, 500: latinExt500, 600: latinExt600, 700: latinExt700 },
}
