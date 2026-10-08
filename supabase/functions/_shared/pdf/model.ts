/**
 * The PDF document model (P3-19): a closed set of blocks, no HTML, shared by
 * the signing flow (Tasks 3.31–3.33) and the Phase 4c fiche. Template bodies
 * (`document_template_versions.body`) are stored in this shape.
 *
 * `checkDocument` validates a value against it, so a body read from the
 * database is checked before it reaches the renderer. Besides the shapes and
 * the size caps, it enforces the layout rules the fixed signing fields rely
 * on:
 * - at most one `signaturePage`, and it is the last block (its page is the
 *   last page);
 * - signer roles are unique, and every `header.initialsFor` role is a signer;
 * - every table row has one cell per column, and a table has ≤ 200 rows.
 *
 * Document-wide caps keep a render inside the edge CPU budget whatever the
 * template: ≤ 400 table rows in all and ≤ 200 000 characters of text in all
 * (title, header, footer and every block's text). Over either,
 * `document_too_large`.
 *
 * pdfmake-free: importing this module never pulls in the renderer.
 */
import { z } from 'zod'

/** Rows per table (plan Task 3.30). */
export const MAX_TABLE_ROWS = 200
/** Table rows across the whole document. */
export const MAX_DOCUMENT_TABLE_ROWS = 400
/** Characters (UTF-16 code units) of text across the whole document. */
export const MAX_DOCUMENT_TEXT = 200_000

/** Roles that sign a document (`document_template_versions.signers`). */
export const SIGNER_ROLES = ['professional', 'clinic', 'client'] as const

/** Who signs: one role per signer of a document. */
export type SignerRole = (typeof SIGNER_ROLES)[number]

const text = (max: number) => z.string().max(max)
const role = z.enum(SIGNER_ROLES)

const runSchema = z.strictObject({
  text: text(5000),
  bold: z.boolean().optional(),
})

const blockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: text(300),
  }),
  z.strictObject({
    type: z.literal('paragraph'),
    runs: z.array(runSchema).min(1).max(100),
  }),
  z.strictObject({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(z.array(runSchema).min(1).max(100)).min(1).max(200),
  }),
  z.strictObject({
    type: z.literal('table'),
    /** `width` is relative: each column gets its share of the content width. */
    columns: z.array(
      z.strictObject({
        label: text(200),
        width: z.number().positive().max(100),
      }),
    ).min(1).max(8),
    rows: z.array(z.array(text(500))).max(MAX_TABLE_ROWS),
  }),
  z.strictObject({
    type: z.literal('image'),
    /** Key into the assets passed to the renderer (never a URL or a path). */
    assetKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    /** Points; the image keeps its ratio and also fits the page height. */
    width: z.number().positive().max(468),
  }),
  z.strictObject({ type: z.literal('pageBreak') }),
  z.strictObject({
    type: z.literal('signaturePage'),
    signers: z.array(
      z.strictObject({ role, label: text(120) }),
    ).min(1).max(SIGNER_ROLES.length),
  }),
])

/** The document model, with the cross-block rules of the module comment. */
export const pdfDocumentSchema = z.strictObject({
  /** PDF metadata title. */
  title: text(200).min(1),
  /** Top of every page; `initialsFor` = the signer roles that initial each page. */
  header: z.strictObject({
    text: text(120),
    initialsFor: z.array(role).max(SIGNER_ROLES.length).optional(),
  }).optional(),
  /** Bottom of every page, followed by « Page x de y ». */
  footer: z.strictObject({ text: text(120) }),
  blocks: z.array(blockSchema).min(1).max(1000),
}).superRefine((doc, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message })
  const last = doc.blocks.length - 1
  let signers: SignerRole[] = []
  doc.blocks.forEach((block, i) => {
    if (block.type === 'table') {
      block.rows.forEach((row, r) => {
        if (row.length !== block.columns.length) {
          issue(['blocks', i, 'rows', r], 'one cell per column')
        }
      })
    }
    if (block.type === 'signaturePage') {
      if (i !== last) issue(['blocks', i], 'the signature page is last')
      signers = block.signers.map((s) => s.role)
      if (new Set(signers).size !== signers.length) {
        issue(['blocks', i, 'signers'], 'one signer per role')
      }
    }
  })
  const initials = doc.header?.initialsFor ?? []
  if (new Set(initials).size !== initials.length) {
    issue(['header', 'initialsFor'], 'one box per role')
  }
  if (initials.some((r) => !signers.includes(r))) {
    issue(['header', 'initialsFor'], 'every initialing role signs')
  }
})

/** A document to render (`document_template_versions.body` once filled). */
export type PdfDocument = z.infer<typeof pdfDocumentSchema>
/** One block of a document. */
export type Block = PdfDocument['blocks'][number]
/** A run of text in a paragraph or list item. */
export type Run = z.infer<typeof runSchema>

/**
 * A signing field for Documenso: position and size in percent of the page,
 * origin top-left (Documenso's convention); `page` starts at 1.
 */
export interface SigningField {
  role: SignerRole
  type: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME'
  page: number
  x: number
  y: number
  width: number
  height: number
}

/** Image bytes (PNG or JPEG) by `assetKey`. */
export type PdfAssets = Record<string, Uint8Array>

/** A rendered document and where its signing fields are. */
export interface RenderedPdf {
  bytes: Uint8Array
  pageCount: number
  fields: SigningField[]
}

/**
 * A PDF renderer. pdfmake (`render.ts`) is the one implementation; Gotenberg
 * is the fidelity fallback behind the same interface (ADR 0008).
 */
export interface PdfRenderer {
  render(doc: PdfDocument, assets: PdfAssets): Promise<RenderedPdf>
}

/** Why a document could not be rendered. */
export type PdfErrorCode =
  | 'invalid_document'
  | 'document_too_large'
  | 'missing_asset'
  | 'unsupported_image'
  | 'image_too_large'
  | 'asset_unavailable'

/**
 * A rendering failure. The message names a model path or an asset key at
 * most, never document text (which may hold personal data).
 */
export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode, message: string) {
    super(message)
    this.name = 'PdfError'
  }
}

/**
 * The validation outcome: the parsed document, the first issue's path, or
 * the document-wide cap that was exceeded.
 */
export type DocumentCheck =
  | { ok: true; document: PdfDocument }
  | { ok: false; code: 'invalid_document'; path: string }
  | { ok: false; code: 'document_too_large'; limit: 'table_rows' | 'text' }

/** Table rows and text length of a (parsed) document, for the caps. */
function documentSize(doc: PdfDocument): { rows: number; text: number } {
  let rows = 0
  let text = doc.title.length + (doc.header?.text.length ?? 0) +
    doc.footer.text.length
  const runs = (items: Run[]) => {
    for (const r of items) text += r.text.length
  }
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
        text += block.text.length
        break
      case 'paragraph':
        runs(block.runs)
        break
      case 'list':
        block.items.forEach(runs)
        break
      case 'table':
        rows += block.rows.length
        for (const c of block.columns) text += c.label.length
        for (const row of block.rows) {
          for (const cell of row) text += cell.length
        }
        break
      case 'signaturePage':
        for (const s of block.signers) text += s.label.length
        break
      case 'image':
      case 'pageBreak':
        break
    }
  }
  return { rows, text }
}

/**
 * Validates `value` as a `PdfDocument` (module comment). On failure, `path`
 * is the first issue's location (`blocks.12.rows`), never the input; a
 * well-formed document over a document-wide cap names the cap (`limit`).
 */
export function checkDocument(value: unknown): DocumentCheck {
  const result = pdfDocumentSchema.safeParse(value)
  if (!result.success) {
    return {
      ok: false,
      code: 'invalid_document',
      path: result.error.issues[0].path.join('.'),
    }
  }
  const size = documentSize(result.data)
  if (size.rows > MAX_DOCUMENT_TABLE_ROWS) {
    return { ok: false, code: 'document_too_large', limit: 'table_rows' }
  }
  if (size.text > MAX_DOCUMENT_TEXT) {
    return { ok: false, code: 'document_too_large', limit: 'text' }
  }
  return { ok: true, document: result.data }
}
