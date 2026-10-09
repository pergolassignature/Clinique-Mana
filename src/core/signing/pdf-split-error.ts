/**
 * Why a sealed PDF could not be split (P4-500): unreadable, fewer pages than the document has, or
 * the document's page count is unknown (none recorded and no source file to count). Its own file,
 * so code outside the pdf-lib chunk can test for it without loading pdf-lib.
 */
export class PdfSplitError extends Error {
  constructor(readonly code: 'unreadable' | 'page_count_mismatch' | 'page_count_unknown') {
    super(`PDF split failed: ${code}`)
    this.name = 'PdfSplitError'
  }
}
