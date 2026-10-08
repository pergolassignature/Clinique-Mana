import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { inflateSync } from 'node:zlib'
import { referenceContract } from './fixtures/reference-contract.ts'
import { referenceFiche } from './fixtures/reference-fiche.ts'
import { type Block, type PdfDocument, PdfError } from './model.ts'
import { renderPdf } from './render.ts'
import pdfmake from './vendor/pdfmake.js'

const PAGE = { width: 612, height: 792 } // Letter, points
const latin1 = new TextDecoder('latin1')
const fixture = (name: string) =>
  Deno.readFile(new URL(`./fixtures/${name}`, import.meta.url))
const [logo, photo] = await Promise.all([
  fixture('logo.png'),
  fixture('photo.jpg'),
])

/**
 * The FlateDecode streams of the PDF whose dictionary is flat (page contents,
 * fonts, CMaps; not images with nested parameters), inflated.
 */
function streams(bytes: Uint8Array): { dict: string; text: string }[] {
  const pdf = latin1.decode(bytes)
  const found = []
  for (const m of pdf.matchAll(/<<([^<>]*)>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length
    const end = pdf.indexOf('endstream', start)
    if (!m[1].includes('/FlateDecode')) continue
    const body = bytes.subarray(start, end).subarray(0, -1) // trailing EOL
    let inflated: Uint8Array
    try {
      inflated = inflateSync(body)
    } catch {
      inflated = inflateSync(body.subarray(0, -1)) // CRLF
    }
    found.push({ dict: m[1], text: latin1.decode(inflated) })
  }
  return found
}

/** The page content streams, in page order (pdfkit writes them in order). */
function pages(bytes: Uint8Array): string[] {
  return streams(bytes)
    .filter((s) =>
      !/\/(Subtype|Length1|Type)\b/.test(s.dict) &&
      !s.text.includes('begincmap') && /\bTf\b|\bre\b/.test(s.text)
    )
    .map((s) => s.text)
}

/** Font sizes of the text drawn on a page, in drawing order. */
const sizes = (page: string) =>
  [...page.matchAll(/\/F\d+ ([\d.]+) Tf/g)].map((m) => Number(m[1]))

const HEADING = new Set([10.5, 12, 16])
const BODY = new Set([9, 10]) // table, paragraph and list text

/** True when some body text follows the page's last heading line. */
function headingKeptWithNext(page: string): boolean {
  const s = sizes(page)
  const last = s.findLastIndex((size) => HEADING.has(size))
  return last === -1 || s.slice(last + 1).some((size) => BODY.has(size))
}

Deno.test('renderPdf: the reference contract is a stable 6-page PDF', async () => {
  const [first, second] = [
    await renderPdf(referenceContract, {}),
    await renderPdf(referenceContract, {}),
  ]
  assert(latin1.decode(first.bytes.subarray(0, 5)) === '%PDF-')
  assertEquals(first.pageCount, 6)
  assertEquals(pages(first.bytes).length, 6)
  assertEquals(second.bytes, first.bytes)
  assertEquals(second.fields, first.fields)
})

Deno.test('renderPdf: signing fields are fixed boxes, drawn where they are reported', async () => {
  const { bytes, pageCount, fields } = await renderPdf(referenceContract, {})
  const content = pages(bytes)

  const initials = fields.filter((f) => f.type === 'INITIALS')
  assertEquals(
    initials.map((f) => [f.role, f.page]),
    Array.from({ length: pageCount }, (_, i) => [
      ['professional', i + 1],
      ['clinic', i + 1],
    ]).flat(),
  )
  for (const type of ['SIGNATURE', 'DATE'] as const) {
    assertEquals(
      fields.filter((f) => f.type === type).map((f) => [f.role, f.page]),
      [['professional', pageCount], ['clinic', pageCount]],
    )
  }
  assertEquals(fields.length, pageCount * 2 + 4)

  // pdfkit draws in top-left coordinates (`1 0 0 -1 0 792 cm`), so each
  // field must match an `x y w h re` rectangle drawn on its page.
  for (const f of fields) {
    for (const v of [f.x, f.y, f.width, f.height]) assert(v >= 0 && v <= 100)
    assert(f.x + f.width <= 100 && f.y + f.height <= 100)
    const box = [
      (f.x * PAGE.width) / 100,
      (f.y * PAGE.height) / 100,
      (f.width * PAGE.width) / 100,
      (f.height * PAGE.height) / 100,
    ].map((v) => String(Math.round(v * 100) / 100)).join(' ')
    assertStringIncludes(
      content[f.page - 1],
      `${box} re`,
      `${f.type} ${f.role} p.${f.page}`,
    )
  }
})

Deno.test('renderPdf: a heading is never the last thing on its page', async () => {
  // The reference contract ended page 3 with an orphan heading in the spike.
  // Its last page, the signature page, has only its title and signer blocks.
  const contract = pages((await renderPdf(referenceContract, {})).bytes)
  contract.slice(0, -1).forEach((page, i) =>
    assert(headingKeptWithNext(page), `contract page ${i + 1}`)
  )

  // Push a heading down one line at a time across the first page break.
  const line: Block = { type: 'paragraph', runs: [{ text: 'Une ligne.' }] }
  let movedHeading = false
  for (let n = 18; n <= 40; n++) {
    const doc: PdfDocument = {
      title: 'Balayage',
      footer: { text: 'Pied' },
      blocks: [
        ...Array.from({ length: n }, () => line),
        { type: 'heading', level: 2, text: 'Titre' },
        line,
      ],
    }
    const rendered = pages((await renderPdf(doc, {})).bytes)
    rendered.forEach((page, i) =>
      assert(headingKeptWithNext(page), `n = ${n}, page ${i + 1}`)
    )
    if (rendered.length === 2) {
      const body = sizes(rendered[1]).filter((s) => BODY.has(s) || s === 12)
      movedHeading ||= body[0] === 12
    }
  }
  assert(movedHeading, 'the sweep never put the heading at a page top')
})

Deno.test('renderPdf: the fiche embeds its PNG and JPEG assets, with no fields', async () => {
  const fiche = await renderPdf(referenceFiche, { logo, photo })
  assertEquals(fiche.pageCount, 2)
  assertEquals(fiche.fields, [])
  const pdf = latin1.decode(fiche.bytes)
  assertEquals(pdf.match(/\/Subtype \/Image/g)?.length, 3) // logo + its alpha, photo
  assertStringIncludes(pdf, '/DCTDecode')
})

Deno.test('renderPdf: U+202F becomes U+00A0 (Inter has no narrow NBSP glyph)', async () => {
  const doc: PdfDocument = {
    title: 'Montant',
    footer: { text: 'Pied' },
    blocks: [{
      type: 'paragraph',
      runs: [{ text: 'Total\u202F: 130,00\u202F$' }],
    }],
  }
  const cmaps = streams((await renderPdf(doc, {})).bytes)
    .filter((s) => s.text.includes('begincmap'))
    .map((s) => s.text.toLowerCase())
    .join('\n')
  assertStringIncludes(cmaps, '<00a0>')
  assert(!cmaps.includes('202f'))
})

Deno.test('renderPdf: an invalid document is refused before rendering', async () => {
  const rows = Array.from({ length: 201 }, () => ['a'])
  const error = await assertRejects(
    () =>
      renderPdf({
        title: 'Trop long',
        footer: { text: 'Pied' },
        blocks: [{
          type: 'table',
          columns: [{ label: 'A', width: 100 }],
          rows,
        }],
      }, {}),
    PdfError,
  )
  assertEquals(error.code, 'invalid_document')
  assertStringIncludes(error.message, 'blocks.0.rows')
})

Deno.test('renderPdf: images must be supplied, as PNG or JPEG bytes', async () => {
  const doc = (assetKey: string): PdfDocument => ({
    title: 'Image',
    footer: { text: 'Pied' },
    blocks: [{ type: 'image', assetKey, width: 100 }],
  })
  const missing = await assertRejects(
    () => renderPdf(doc('logo'), { photo }),
    PdfError,
  )
  assertEquals(missing.code, 'missing_asset')

  const webp = new Uint8Array([
    ...new TextEncoder().encode('RIFF'),
    ...[30, 0, 0, 0],
    ...new TextEncoder().encode('WEBPVP8 '),
    ...new Uint8Array(22),
  ])
  for (const bytes of [webp, new TextEncoder().encode('<svg></svg>')]) {
    const unsupported = await assertRejects(
      () => renderPdf(doc('logo'), { logo: bytes }),
      PdfError,
    )
    assertEquals(unsupported.code, 'unsupported_image')
  }
})

Deno.test('renderPdf: pdfmake may not fetch a URL or read a local file', async () => {
  await renderPdf(referenceFiche, { logo, photo }) // configures the instance
  const attempt = (source: string) =>
    pdfmake.createPdf({
      images: { source },
      content: [{ image: 'source', width: 10 }],
      defaultStyle: { font: 'Inter' },
    }).getBuffer()
  await assertRejects(
    () => attempt('https://example.test/logo.png'),
    Error,
    'Access to URL denied',
  )
  await assertRejects(
    () => attempt('/etc/hosts'),
    Error,
    'Access to local file denied',
  )
})
