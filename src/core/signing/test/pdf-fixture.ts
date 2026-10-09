import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * A small PDF built in the test (never a real signed file): `pages` pages, each saying « Page n ».
 * Test-only: no production file imports this one.
 */
export async function pdfWithPages(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= pages; n++) doc.addPage([200, 200]).drawText(`Page ${n}`, { x: 20, y: 100, size: 12, font })
  return doc.save()
}

/** The page count of `bytes`, read back with pdf-lib. */
export async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount()
}
