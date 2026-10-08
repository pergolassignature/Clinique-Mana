import { assert, assertEquals } from '@std/assert'
import { referenceContract } from './fixtures/reference-contract.ts'
import { referenceFiche } from './fixtures/reference-fiche.ts'
import {
  type Block,
  checkDocument,
  MAX_DOCUMENT_TABLE_ROWS,
  MAX_DOCUMENT_TEXT,
  MAX_TABLE_ROWS,
  type PdfDocument,
} from './model.ts'

const doc = (blocks: unknown[], over: Record<string, unknown> = {}) => ({
  title: 'Document',
  footer: { text: 'Pied' },
  blocks,
  ...over,
})
const p: Block = { type: 'paragraph', runs: [{ text: 'Texte' }] }
const table = (rows: number) => ({
  type: 'table',
  columns: [{ label: 'A', width: 50 }, { label: 'B', width: 50 }],
  rows: Array.from({ length: rows }, (_, i) => [`a${i}`, `b${i}`]),
})
const signatures = (...roles: string[]) => ({
  type: 'signaturePage',
  signers: roles.map((role) => ({ role, label: role })),
})

/** The path of the refusal, or fails when the value is accepted. */
function refused(value: unknown): string {
  const result = checkDocument(value)
  assert(!result.ok, 'expected the document to be refused')
  assert(result.code === 'invalid_document', result.code)
  return result.path
}

Deno.test('checkDocument: the reference contract and fiche are valid', () => {
  for (const reference of [referenceContract, referenceFiche]) {
    const result = checkDocument(reference)
    assert(result.ok)
    assertEquals(result.document, reference)
  }
})

Deno.test(`checkDocument: a table takes ${MAX_TABLE_ROWS} rows, not one more`, () => {
  assert(checkDocument(doc([table(MAX_TABLE_ROWS)])).ok)
  assertEquals(refused(doc([p, table(MAX_TABLE_ROWS + 1)])), 'blocks.1.rows')
})

Deno.test(`checkDocument: ${MAX_DOCUMENT_TABLE_ROWS} table rows in all, not one more`, () => {
  const full = Array.from(
    { length: MAX_DOCUMENT_TABLE_ROWS / MAX_TABLE_ROWS },
    () => table(MAX_TABLE_ROWS),
  )
  assert(checkDocument(doc(full)).ok)
  assertEquals(checkDocument(doc([...full, table(1)])), {
    ok: false,
    code: 'document_too_large',
    limit: 'table_rows',
  })
})

Deno.test(`checkDocument: ${MAX_DOCUMENT_TEXT} characters of text in all, not one more`, () => {
  // Every text counts: title (8) + footer (4) + paragraphs + table cells.
  const run = (n: number) => ({
    type: 'paragraph',
    runs: [{ text: 'x'.repeat(n) }],
  })
  const fixed = 'Document'.length + 'Pied'.length +
    ['A', 'B', 'a0', 'b0'].join('').length
  const paragraphs = Array.from({ length: 39 }, () => run(5000))
  const rest = MAX_DOCUMENT_TEXT - fixed - 39 * 5000
  assert(checkDocument(doc([...paragraphs, run(rest), table(1)])).ok)
  assertEquals(checkDocument(doc([...paragraphs, run(rest + 1), table(1)])), {
    ok: false,
    code: 'document_too_large',
    limit: 'text',
  })
})

Deno.test('checkDocument: an unknown block type or property is refused', () => {
  assertEquals(
    refused(doc([{ type: 'html', html: '<p>x</p>' }])),
    'blocks.0.type',
  )
  assertEquals(
    refused(doc([{ ...p, html: '<b>x</b>' }])),
    'blocks.0',
  )
  assertEquals(refused({ ...doc([p]), script: 'x' }), '')
})

Deno.test('checkDocument: a table row needs one cell per column', () => {
  const short = { ...table(2), rows: [['a', 'b'], ['a']] }
  assertEquals(refused(doc([short])), 'blocks.0.rows.1')
})

Deno.test('checkDocument: an image names an asset key, never a URL or path', () => {
  const image = (assetKey: string) => ({ type: 'image', assetKey, width: 100 })
  assert(checkDocument(doc([image('logo')])).ok)
  for (const key of ['https://evil.test/x.png', '/etc/passwd', 'data:x', '']) {
    assertEquals(refused(doc([image(key)])), 'blocks.0.assetKey')
  }
  assertEquals(
    refused(doc([{ type: 'image', assetKey: 'logo', width: 900 }])),
    'blocks.0.width',
  )
})

Deno.test('checkDocument: the signature page is the last block, and the only one', () => {
  assert(checkDocument(doc([p, signatures('professional')])).ok)
  assertEquals(refused(doc([signatures('professional'), p])), 'blocks.0')
  assertEquals(
    refused(doc([signatures('clinic'), signatures('professional')])),
    'blocks.0',
  )
})

Deno.test('checkDocument: signer roles are known and unique', () => {
  assertEquals(
    refused(doc([p, signatures('professional', 'professional')])),
    'blocks.1.signers',
  )
  assertEquals(
    refused(doc([p, signatures('witness')])),
    'blocks.1.signers.0.role',
  )
  assertEquals(
    refused(doc([p, signatures('client', 'clinic', 'professional', 'client')])),
    'blocks.1.signers',
  )
})

Deno.test('checkDocument: every initialing role signs, once', () => {
  const header = (...initialsFor: string[]) => ({
    header: { text: 'En-tête', initialsFor },
  })
  assert(
    checkDocument(
      doc([p, signatures('professional', 'clinic')], header('professional')),
    ).ok,
  )
  assertEquals(
    refused(doc([p, signatures('clinic')], header('professional'))),
    'header.initialsFor',
  )
  assertEquals(refused(doc([p], header('clinic'))), 'header.initialsFor')
  assertEquals(
    refused(doc([p, signatures('clinic')], header('clinic', 'clinic'))),
    'header.initialsFor',
  )
})

Deno.test('checkDocument: texts are capped, and the path never echoes the input', () => {
  const secret = 'x'.repeat(5001)
  const path = refused(doc([{ type: 'paragraph', runs: [{ text: secret }] }]))
  assertEquals(path, 'blocks.0.runs.0.text')
  assertEquals(refused(doc([p], { title: '' })), 'title')
  assertEquals(refused(doc([])), 'blocks')
})

Deno.test('checkDocument: the parsed document is typed as a PdfDocument', () => {
  const result = checkDocument(doc([p]))
  assert(result.ok)
  const typed: PdfDocument = result.document
  assertEquals(typed.blocks, [p])
})
