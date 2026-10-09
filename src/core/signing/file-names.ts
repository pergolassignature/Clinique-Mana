import { getClinicDateString } from '@/shared/lib/timezone'

/**
 * The names of a signed document's downloads (P4-500), from the request's title (« Contrat de
 * service — Olivier Bergeron »):
 * - the document alone: « Contrat de service - Olivier Bergeron - signé le 2026-10-09.pdf » (the
 *   clinic date of completion);
 * - Documenso's pages alone: « … - certificat et journal de signature.pdf »;
 * - the full sealed original: « … - complet scellé.pdf », also the stored file's name
 *   (`sealedPdfFileName` in `supabase/functions/_shared/signing-file-name.ts`, parity in the test).
 * The rule is the fiche's (P4-200): dashes become « - », letters and digits of every language kept
 * with spaces and `'’()._-`, any other character a space, at most 100 characters with the suffix
 * and the extension (the title is cut, never the suffix).
 */

const MAX_FILE_NAME = 100
const DASHES = /\s*[\u2012-\u2015\u2212]\s*/gu
const UNSAFE = /[^\p{L}\p{N} '’()._-]+/gu
const FALLBACK = 'Document signé'

export const SEALED_SUFFIX = ' - complet scellé'
const CERTIFICATE_SUFFIX = ' - certificat et journal de signature'

/** The title made safe for a file name; « Document signé » when nothing is left. */
export function signedFileBase(title: string | null | undefined): string {
  const base = (title ?? '').normalize('NFC').replace(DASHES, ' - ').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return base || FALLBACK
}

/** « {base}{suffix}.pdf », the base cut so the whole stays within 100 characters. */
export function signedFileName(title: string | null | undefined, suffix: string): string {
  const room = MAX_FILE_NAME - Array.from(suffix).length - 4
  const base = Array.from(signedFileBase(title)).slice(0, room).join('').replace(/[\s-]+$/u, '')
  return `${base || FALLBACK}${suffix}.pdf`
}

interface SignedFileNames {
  document: string
  certificate: string
  sealed: string
}

/** The three names; « signé le » takes the clinic date of `completedAt` (none: « signé »). */
export function signedFileNames(title: string | null | undefined, completedAt: string | null): SignedFileNames {
  return {
    document: signedFileName(title, completedAt ? ` - signé le ${getClinicDateString(completedAt)}` : ' - signé'),
    certificate: signedFileName(title, CERTIFICATE_SUFFIX),
    sealed: signedFileName(title, SEALED_SUFFIX),
  }
}
