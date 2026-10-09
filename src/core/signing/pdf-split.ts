import { PDFDocument } from 'pdf-lib'
import { PdfSplitError } from './pdf-split-error'

/**
 * Splits Documenso's sealed PDF in the browser (P4-500): pages 1…N are our document, the pages
 * after them Documenso's « Certificat de signature » and « Journal d'audit ». pdf-lib is heavy, so
 * this module is its own chunk, imported only on a download press (`hooks.ts`), never on the login
 * page (`scripts/check-entry-chunk.mjs` checks for it). The split files are copies of the pages:
 * they do not carry Documenso's digital signature, which covers the whole sealed file (the proof,
 * stored untouched).
 */

export interface SplitSignedPdf {
  /** Every page of the sealed file. */
  totalPages: number
  /** Pages 1…N; the sealed bytes themselves when they hold nothing else. */
  document: Uint8Array
  /** Pages N+1…end; null when Documenso added none. */
  certificate: Uint8Array | null
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    // No metadata rewrite: the copies say nothing the original does not.
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch {
    throw new PdfSplitError('unreadable')
  }
}

/** The page count of a PDF (the stored source file, for a request sent before N was recorded). */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount()
}

async function copyPages(source: PDFDocument, from: number, to: number): Promise<Uint8Array> {
  const copy = await PDFDocument.create({ updateMetadata: false })
  const indices = Array.from({ length: to - from }, (_, i) => from + i)
  for (const page of await copy.copyPages(source, indices)) copy.addPage(page)
  return copy.save()
}

/** The document (pages 1…`documentPages`) and the certificate pages after it. */
export async function splitSignedPdf(bytes: Uint8Array, documentPages: number): Promise<SplitSignedPdf> {
  const source = await load(bytes)
  const totalPages = source.getPageCount()
  if (!Number.isInteger(documentPages) || documentPages < 1 || documentPages > totalPages) {
    throw new PdfSplitError('page_count_mismatch')
  }
  if (documentPages === totalPages) return { totalPages, document: bytes, certificate: null }
  // One after the other: both copies read the same source document.
  const document = await copyPages(source, 0, documentPages)
  const certificate = await copyPages(source, documentPages, totalPages)
  return { totalPages, document, certificate }
}
