/**
 * The stored signed PDF's name (P4-500): « {titre} - complet scellé.pdf »,
 * from the request's title (« Contrat de service — Olivier Bergeron » →
 * « Contrat de service - Olivier Bergeron - complet scellé.pdf »). It is
 * Documenso's whole sealed file: our document, its certificate and its audit
 * log. The same rule as the browser's downloads
 * (`src/core/signing/file-names.ts`, parity in its test; P4-200's rule for
 * the fiche): dashes become « - », letters and digits of every language are
 * kept with spaces and `'’()._-`, any other character is a space, at most 100
 * characters with the suffix and the extension (the title is cut, never the
 * suffix). No import: the web app's test reads this file.
 */

const MAX_FILE_NAME = 100
const DASHES = /\s*[\u2012-\u2015\u2212]\s*/gu
const UNSAFE = /[^\p{L}\p{N} '’()._-]+/gu
const FALLBACK = 'Document signé'
export const SEALED_SUFFIX = ' - complet scellé'

/** The title made safe for a file name; « Document signé » when nothing is left. */
export function signedFileBase(title: string | null | undefined): string {
  const base = (title ?? '').normalize('NFC').replace(DASHES, ' - ')
    .replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return base || FALLBACK
}

/** « {base}{suffix}.pdf », the base cut so the whole stays within 100 characters. */
export function signedFileName(
  title: string | null | undefined,
  suffix: string,
): string {
  const room = MAX_FILE_NAME - Array.from(suffix).length - 4
  const base = Array.from(signedFileBase(title)).slice(0, room).join('')
    .replace(/[\s-]+$/u, '')
  return `${base || FALLBACK}${suffix}.pdf`
}

/** The sealed original's name, as `storeSignedPdf` registers it. */
export function sealedPdfFileName(title: string | null | undefined): string {
  return signedFileName(title, SEALED_SUFFIX)
}
