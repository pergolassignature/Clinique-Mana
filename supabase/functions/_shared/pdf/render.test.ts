import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { inflateSync } from 'node:zlib'
import { referenceContract } from './fixtures/reference-contract.ts'
import { referenceFiche } from './fixtures/reference-fiche.ts'
import {
  type Block,
  MAX_DOCUMENT_TABLE_ROWS,
  MAX_TABLE_ROWS,
  type PdfDocument,
  PdfError,
} from './model.ts'
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
/** The header and footer text and the box captions. */
const CHROME = new Set([7.5, 8])

/** True when the page draws text besides its header, footer and captions. */
const hasContent = (page: string) => sizes(page).some((s) => !CHROME.has(s))

/**
 * How many glyphs are drawn with glyph id 0 (`.notdef`, a missing
 * character), over every page: pdfkit writes text as hex glyph ids in `TJ`.
 */
function notdefs(bytes: Uint8Array): number {
  let count = 0
  for (const page of pages(bytes)) {
    for (const [, shown] of page.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const [, hex] of shown.matchAll(/<([0-9a-fA-F]*)>/g)) {
        for (let i = 0; i < hex.length; i += 4) {
          if (hex.slice(i, i + 4) === '0000') count++
        }
      }
    }
  }
  return count
}

const p = (text: string): Block => ({ type: 'paragraph', runs: [{ text }] })
const pageBreak: Block = { type: 'pageBreak' }
const signaturePage: Block = {
  type: 'signaturePage',
  signers: [
    { role: 'professional', label: 'Le Professionnel' },
    { role: 'clinic', label: 'La Clinique' },
  ],
}
const docOf = (blocks: Block[], initials = false): PdfDocument => ({
  title: 'Document',
  ...(initials
    ? { header: { text: 'En-tête', initialsFor: ['professional', 'clinic'] } }
    : {}),
  footer: { text: 'Pied' },
  blocks,
})

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
  const { bytes } = await renderPdf(doc, {})
  const cmaps = streams(bytes)
    .filter((s) => s.text.includes('begincmap'))
    .map((s) => s.text.toLowerCase())
    .join('\n')
  assertStringIncludes(cmaps, '<00a0>')
  assert(!cmaps.includes('202f'))
  assertEquals(notdefs(bytes), 0)
})

Deno.test('renderPdf: latin-ext and Vietnamese names render with no .notdef glyph', async () => {
  const names = 'Nguyễn Ștefan Łukasz Ğül Dvořák Ÿ'
  const doc: PdfDocument = {
    title: names,
    header: { text: `Contrat — ${names}`, initialsFor: ['professional'] },
    footer: { text: names },
    blocks: [
      { type: 'heading', level: 1, text: names },
      {
        type: 'paragraph',
        runs: [{ text: `${names}, ` }, { text: names, bold: true }],
      },
      { type: 'list', ordered: true, items: [[{ text: names }]] },
      {
        type: 'table',
        columns: [{ label: names, width: 50 }, { label: 'B', width: 50 }],
        rows: [[names, 'x']],
      },
      // Decomposed input (e + U+0302 + U+0303) is composed first.
      p('Nguye\u0302\u0303n'),
      {
        type: 'signaturePage',
        signers: [{ role: 'professional', label: names }],
      },
    ],
  }
  const { bytes } = await renderPdf(doc, {})
  assertEquals(notdefs(bytes), 0)
  // The check does see a character no embedded subset holds.
  const cjk = await renderPdf(docOf([p('漢字')]), {})
  assertEquals(notdefs(cjk.bytes), 2)
})

Deno.test('renderPdf: page breaks never add a blank page', async () => {
  const cases: [string, Block[], number][] = [
    [
      'paragraph, break, signature page',
      [p('Un'), pageBreak, signaturePage],
      2,
    ],
    ['signature page alone', [signaturePage], 1],
    ['a trailing break', [p('Un'), pageBreak], 1],
    ['a leading break', [pageBreak, p('Un')], 1],
    ['a repeated break', [p('Un'), pageBreak, pageBreak, p('Deux')], 2],
    [
      'a break between blocks',
      [p('Un'), pageBreak, p('Deux'), signaturePage],
      3,
    ],
  ]
  for (const [name, blocks, expected] of cases) {
    const withSigners = blocks.includes(signaturePage)
    const { bytes, pageCount, fields } = await renderPdf(
      docOf(blocks, withSigners),
      {},
    )
    const content = pages(bytes)
    assertEquals([pageCount, content.length], [expected, expected], name)
    content.forEach((page, i) =>
      assert(hasContent(page), `${name}: page ${i + 1}`)
    )
    if (withSigners) {
      // Every page's INITIALS boxes sit on a page with content.
      const initialled = fields.filter((f) => f.type === 'INITIALS')
      assertEquals(initialled.length, pageCount * 2, name)
      for (const f of initialled) assert(hasContent(content[f.page - 1]), name)
    }
  }
})

Deno.test('renderPdf: a heading right before the signature page moves with it', async () => {
  const heading: Block = { type: 'heading', level: 2, text: 'Engagement' }
  const { bytes, pageCount, fields } = await renderPdf(
    docOf([p('Un'), heading, signaturePage], true),
    {},
  )
  const [first, last] = pages(bytes)
  assertEquals(pageCount, 2)
  assert(!sizes(first).includes(12), 'the heading left on page 1')
  const onLast = sizes(last).filter((s) => !CHROME.has(s))
  assertEquals(onLast.slice(0, 2), [12, 16]) // the heading, then « Signatures »
  for (const f of fields.filter((f) => f.type !== 'INITIALS')) {
    assertEquals(f.page, 2)
  }

  // Headings too tall for the room above the signer boxes are refused.
  const tall: Block = { type: 'heading', level: 1, text: 'Titre '.repeat(50) }
  const error = await assertRejects(
    () => renderPdf(docOf([p('Un'), tall, signaturePage]), {}),
    PdfError,
  )
  assertEquals(error.code, 'invalid_document')
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

Deno.test('renderPdf: a document over a document-wide cap is document_too_large', async () => {
  const table = (rows: number): Block => ({
    type: 'table',
    columns: [{ label: 'A', width: 100 }],
    rows: Array.from({ length: rows }, () => ['a']),
  })
  const tables = Array.from(
    { length: MAX_DOCUMENT_TABLE_ROWS / MAX_TABLE_ROWS },
    () => table(MAX_TABLE_ROWS),
  )
  const rows = await assertRejects(
    () => renderPdf(docOf([...tables, table(1)]), {}),
    PdfError,
  )
  assertEquals(rows.code, 'document_too_large')
  const long = Array.from({ length: 41 }, () => p('x'.repeat(5000)))
  const text = await assertRejects(() => renderPdf(docOf(long), {}), PdfError)
  assertEquals(text.code, 'document_too_large')
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

/** A PNG with only its IHDR and IEND chunks: the header pdfkit would trust. */
const pngHeader = (width: number, height: number) => {
  const u32 = (
    n: number,
  ) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height)],
    ...[8, 6, 0, 0, 0, 0, 0, 0, 0], // depth, RGBA, …, CRC (unchecked)
    ...[0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
  ])
}

/** SOI, an APP0 segment, then a baseline frame header (SOF0). */
const jpegHeader = (width: number, height: number) =>
  new Uint8Array([
    ...[0xff, 0xd8, 0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46],
    ...[
      0xff,
      0xc0,
      0,
      11,
      8,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
    ],
    ...[1, 1, 0x11, 0],
  ])

Deno.test('renderPdf: images over 4000 px a side are refused before decoding', async () => {
  const doc: PdfDocument = {
    title: 'Image',
    footer: { text: 'Pied' },
    blocks: [{ type: 'image', assetKey: 'logo', width: 100 }],
  }
  for (
    const [name, bytes, code] of [
      ['PNG 5000 × 10', pngHeader(5000, 10), 'image_too_large'],
      ['PNG 10 × 4001', pngHeader(10, 4001), 'image_too_large'],
      ['PNG 0 × 10', pngHeader(0, 10), 'unsupported_image'],
      ['JPEG 5000 × 10', jpegHeader(5000, 10), 'image_too_large'],
      ['JPEG 10 × 65535', jpegHeader(10, 65535), 'image_too_large'],
      [
        'JPEG with no frame header',
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xda, 0, 2]),
        'unsupported_image',
      ],
    ] as const
  ) {
    const error = await assertRejects(
      () => renderPdf(doc, { logo: bytes }),
      PdfError,
      undefined,
      name,
    )
    assertEquals(error.code, code, name)
  }
})

Deno.test('renderPdf: an asset key is looked up among own keys only', async () => {
  const doc: PdfDocument = {
    title: 'Image',
    footer: { text: 'Pied' },
    blocks: [{ type: 'image', assetKey: 'constructor', width: 100 }],
  }
  const missing = await assertRejects(() => renderPdf(doc, {}), PdfError)
  assertEquals(missing.code, 'missing_asset')
  const rendered = await renderPdf(doc, { constructor: logo })
  const pdf = latin1.decode(rendered.bytes)
  assertEquals(pdf.match(/\/Subtype \/Image/g)?.length, 2) // logo + its alpha
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
