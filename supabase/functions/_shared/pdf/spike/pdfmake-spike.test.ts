import { assert, assertEquals } from '@std/assert'
import { PAGE, renderWithPdfmake } from './pdfmake-spike.ts'
import { referenceContract } from './reference-contract.ts'

const latin1 = new TextDecoder('latin1')

Deno.test('reference contract: 6 pages, byte-stable, fields where the boxes are drawn', async () => {
  const first = await renderWithPdfmake(referenceContract, {}, {
    compress: false,
  })
  const second = await renderWithPdfmake(referenceContract, {}, {
    compress: false,
  })
  const pdf = latin1.decode(first.bytes)

  assert(pdf.startsWith('%PDF-'))
  assertEquals(first.pageCount, 6)
  assertEquals(second.pageCount, 6)
  assertEquals(second.fields, first.fields)
  assertEquals(second.bytes, first.bytes)

  const initials = first.fields.filter((f) => f.type === 'INITIALS')
  assertEquals(initials.length, 6 * 2)
  const signatures = first.fields.filter((f) => f.type === 'SIGNATURE')
  assertEquals(signatures.map((f) => [f.role, f.page]), [
    ['professional', 6],
    ['clinic', 6],
  ])

  // pdfkit draws in top-left coordinates (`1 0 0 -1 0 792 cm`), so each
  // field must match a drawn `x y w h re` rectangle exactly.
  const drawn = new Set(
    [...pdf.matchAll(/^([\d.]+ [\d.]+ [\d.]+ [\d.]+) re$/gm)].map((m) => m[1]),
  )
  for (const f of first.fields) {
    for (const v of [f.x, f.y, f.width, f.height]) assert(v >= 0 && v <= 100)
    const box = [
      (f.x * PAGE.width) / 100,
      (f.y * PAGE.height) / 100,
      (f.width * PAGE.width) / 100,
      (f.height * PAGE.height) / 100,
    ].map((v) => String(Math.round(v * 100) / 100)).join(' ')
    assert(drawn.has(box), `no box drawn at ${box} for ${f.type} ${f.role}`)
  }
})
