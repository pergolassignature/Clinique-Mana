import { describe, expect, it } from 'vitest'
import { countPdfPages, splitSignedPdf } from './pdf-split'
import { PdfSplitError } from './pdf-split-error'
import { pageCountOf, pdfWithPages } from './test/pdf-fixture'

describe('splitSignedPdf (P4-500)', () => {
  it('N pages + 3 of Documenso → the document (N pages) and the certificate and journal (3 pages)', async () => {
    const sealed = await pdfWithPages(7 + 3)
    const parts = await splitSignedPdf(sealed, 7)
    expect(parts.totalPages).toBe(10)
    expect(await pageCountOf(parts.document)).toBe(7)
    expect(parts.certificate).not.toBeNull()
    expect(await pageCountOf(parts.certificate!)).toBe(3)
  })

  it('N = total: no certificate, and the document is the sealed bytes themselves', async () => {
    const sealed = await pdfWithPages(4)
    const parts = await splitSignedPdf(sealed, 4)
    expect(parts.certificate).toBeNull()
    expect(parts.document).toBe(sealed)
  })

  it('N larger than the file, or not a page count: page_count_mismatch', async () => {
    const sealed = await pdfWithPages(3)
    for (const n of [4, 0, 1.5]) {
      await expect(splitSignedPdf(sealed, n)).rejects.toMatchObject({ name: 'PdfSplitError', code: 'page_count_mismatch' })
    }
  })

  it('bytes that are not a PDF: unreadable', async () => {
    const error = await splitSignedPdf(new TextEncoder().encode('<html>'), 1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdfSplitError)
    expect((error as PdfSplitError).code).toBe('unreadable')
  })

  it('countPdfPages reads a source file’s page count', async () => {
    expect(await countPdfPages(await pdfWithPages(5))).toBe(5)
  })
})
