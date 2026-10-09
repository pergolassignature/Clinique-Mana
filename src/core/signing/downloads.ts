import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { fetchStoredFile } from '@/core/storage/api'
import { FunctionCallError } from '@/core/supabase/functions'
import { isChunkLoadError } from '@/shared/lib/app-update'
import { retryInText } from '@/shared/lib/retry-after'
import { signedFileNames } from './file-names'
import { PdfSplitError } from './pdf-split-error'

/**
 * A signed document's three downloads (P4-500), for any module's card: the document alone (pages
 * 1…N), Documenso's certificate and audit log alone (pages N+1…end), and the full sealed original
 * as stored (the legal proof: Documenso's digital signature covers the whole file, the split files
 * do not carry it). The split runs in the browser with pdf-lib, a chunk loaded on the press
 * (`pdf-split.ts`). N is the request's recorded `page_count`; without one (sent before it was
 * recorded, or recovered), the page count of the stored source file, the PDF that was sent. Every
 * file is read through a new `storage-sign` URL at each press (P3-33, P4-479), never cached.
 */

/** What a request gives its downloads (a module's read model, only for its readers). */
export interface SignedDocumentFiles {
  /** The request's title (« Contrat de service — Prénom Nom »): the files' names. */
  title: string | null
  /** When the signed PDF was stored: the date in the document's name. */
  completedAt: string | null
  signedFileId: string
  /** The PDF that was sent: its pages are N when `pageCount` is null. */
  sourceFileId: string | null
  /** N, recorded at send. */
  pageCount: number | null
}

export type SignedDownloadKind = 'document' | 'certificate' | 'sealed'

interface SignedDownload {
  /** The file to save; null for a certificate the sealed PDF does not hold. */
  file: { bytes: Uint8Array; fileName: string } | null
  /** Whether the sealed PDF holds pages after the document (null: not split, not known). */
  hasCertificate: boolean | null
}

/** Whether the document can be split before anything is read: N recorded, or a source to count. */
export function canSplit(files: SignedDocumentFiles): boolean {
  return files.pageCount !== null || files.sourceFileId !== null
}

const loadSplitter = () => import('./pdf-split')

/** Starts loading pdf-lib's chunk (a hover or focus on a split download), so a press finds it ready. */
export function preloadPdfSplitter(): void {
  void loadSplitter().catch(() => undefined)
}

/** Reads, splits when asked, and names the file `kind`. */
export async function prepareSignedDownload(files: SignedDocumentFiles, kind: SignedDownloadKind): Promise<SignedDownload> {
  const names = signedFileNames(files.title, files.completedAt)
  if (kind === 'sealed') {
    return { file: { bytes: await fetchStoredFile(files.signedFileId), fileName: names.sealed }, hasCertificate: null }
  }
  const countSource = files.pageCount === null && files.sourceFileId !== null
  if (!countSource && files.pageCount === null) throw new PdfSplitError('page_count_unknown')
  const [splitter, sealed, source] = await Promise.all([
    loadSplitter(),
    fetchStoredFile(files.signedFileId),
    countSource ? fetchStoredFile(files.sourceFileId!) : Promise.resolve(null),
  ])
  const documentPages = files.pageCount ?? (await splitter.countPdfPages(source!))
  const parts = await splitter.splitSignedPdf(sealed, documentPages)
  const hasCertificate = parts.certificate !== null
  if (kind === 'document') return { file: { bytes: parts.document, fileName: names.document }, hasCertificate }
  return { file: parts.certificate && { bytes: parts.certificate, fileName: names.certificate }, hasCertificate }
}

/**
 * The French text of a failed download: too many URLs asked (with when to retry), a new deploy (the
 * chunk is gone), a split that failed (reported with its code: it means N and the file disagree),
 * an unknown N, else « Le fichier n'a pas pu être téléchargé ».
 */
export function signedDownloadErrorMessage(error: unknown): string {
  const D = 'signing.downloads'
  if (error instanceof FunctionCallError && error.code === 'rate_limited') return `${t(`${D}.errors.rateLimited`)} ${retryInText(error.retryAfter)}`
  if (isChunkLoadError(error)) return t(`${D}.errors.appUpdated`)
  if (error instanceof PdfSplitError) {
    if (error.code === 'page_count_unknown') return t(`${D}.cannotSplit`)
    const report = new Error(error.message)
    report.name = `PdfSplitError ${error.code}`
    Sentry.captureException(report, { tags: { area: 'signing', code: error.code } })
    return t(`${D}.errors.splitFailed`)
  }
  return t(`${D}.errors.failed`)
}
