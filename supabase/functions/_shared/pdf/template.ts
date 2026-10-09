/**
 * Fills a document template (`document_template_versions.body`) with its
 * variables, under the email rules (`../email/render.ts`), from the shared
 * formatter (`../format.ts`):
 * - a placeholder follows `PLACEHOLDER_SOURCE`, in any text of the document
 *   (title, header, footer, headings, runs, list items, table labels and
 *   cells, signer labels); each one must be a declared variable, otherwise
 *   `unknown_variable`;
 * - values are formatted by `kind` (`datetime` in the clinic timezone, `date`
 *   with no conversion, `url` only `https:`); a required value that is absent
 *   or unusable fails closed (`missing_variable`), an optional one is empty;
 * - an invalid clinic timezone fails (`invalid_timezone`) instead of throwing;
 * - the model has no markup, so nothing is escaped, but control characters
 *   in values (line breaks included) become spaces;
 * - values are inserted in a single pass: a value is never read as a
 *   placeholder;
 * - **block placeholders** (P4-433): a paragraph whose only run is exactly one
 *   placeholder (`{{pricing.annexe_a}}`, surrounding spaces allowed) whose
 *   path is a key of `blocks` is replaced by those blocks, which the caller
 *   built (tables, headings: what a text value cannot hold, such as one row
 *   per tier). They are inserted after filling, never filled themselves (the
 *   single-pass rule), and the renderer validates them with the rest. Such a
 *   path still has to be a declared variable (the database checks every
 *   placeholder); when `blocks` holds it, a missing value is not
 *   `missing_variable`: anywhere else in the text it reads as its value, or
 *   empty.
 *
 * pdfmake-free: callers render the result with `render.ts`, which validates it.
 */
import {
  formatValue,
  isValidTimeZone,
  PLACEHOLDER_SOURCE,
  type TemplateVariable,
  valueAt,
} from '../format.ts'
import type { Block, PdfDocument, Run } from './model.ts'

/** The filled document, or the first variable that prevented filling. */
export type FillResult =
  | { ok: true; document: PdfDocument }
  | FillError

const PLACEHOLDER = new RegExp(PLACEHOLDER_SOURCE, 'g')
/** Control characters (C0, DEL, C1) and the Unicode line/paragraph separators. */
const CONTROL = /[\p{Cc}\u2028\u2029]/gu

/** A copy of `doc` with every text passed through `map`. */
function mapTexts(
  doc: PdfDocument,
  map: (text: string) => string,
): PdfDocument {
  const runs = (items: Run[]) => items.map((r) => ({ ...r, text: map(r.text) }))
  const block = (b: Block): Block => {
    switch (b.type) {
      case 'heading':
        return { ...b, text: map(b.text) }
      case 'paragraph':
        return { ...b, runs: runs(b.runs) }
      case 'list':
        return { ...b, items: b.items.map(runs) }
      case 'table':
        return {
          ...b,
          columns: b.columns.map((c) => ({ ...c, label: map(c.label) })),
          rows: b.rows.map((row) => row.map(map)),
        }
      case 'signaturePage':
        return {
          ...b,
          signers: b.signers.map((s) => ({ ...s, label: map(s.label) })),
        }
      case 'image':
      case 'pageBreak':
        return { ...b }
    }
  }
  return {
    ...doc,
    title: map(doc.title),
    ...(doc.header
      ? { header: { ...doc.header, text: map(doc.header.text) } }
      : {}),
    footer: { ...doc.footer, text: map(doc.footer.text) },
    blocks: doc.blocks.map(block),
  }
}

/** Blocks a caller builds for a block placeholder, by variable path (module comment). */
export type BlockValues = Readonly<Record<string, readonly Block[]>>

const LONE_PLACEHOLDER = new RegExp(`^\\s*${PLACEHOLDER_SOURCE}\\s*$`)

/** The path of a paragraph that is a block placeholder of `blocks`, else null. */
function blockPath(block: Block, blocks: BlockValues): string | null {
  if (block.type !== 'paragraph' || block.runs.length !== 1) return null
  const match = LONE_PLACEHOLDER.exec(block.runs[0].text)
  const path = match?.[1].trim()
  return path !== undefined && Object.hasOwn(blocks, path) ? path : null
}

/** The failures shared by `fillTemplate` and `fillTexts`. */
type FillError =
  | { ok: false; code: 'missing_variable' | 'unknown_variable'; path: string }
  | { ok: false; code: 'invalid_timezone' }

/**
 * Checks every text `scan` visits against the declared variables, then
 * formats the values: a function that fills one text, or the first failure.
 */
function prepare(
  scan: (visit: (text: string) => void) => void,
  variables: TemplateVariable[],
  values: Record<string, unknown>,
  timezone: string,
  blockPaths: ReadonlySet<string> = new Set(),
): { ok: true; fill: (text: string) => string } | FillError {
  if (!isValidTimeZone(timezone)) return { ok: false, code: 'invalid_timezone' }

  const declared = new Set(variables.map((v) => v.path))
  let unknown: string | null = null
  scan((text) => {
    for (const [, raw] of text.matchAll(PLACEHOLDER)) {
      if (unknown === null && !declared.has(raw.trim())) unknown = raw.trim()
    }
  })
  if (unknown !== null) {
    return { ok: false, code: 'unknown_variable', path: unknown }
  }

  const resolved = new Map<string, string>()
  for (const variable of variables) {
    const formatted = formatValue(
      variable,
      valueAt(values, variable.path),
      { timezone },
    )
    if (formatted !== null) {
      resolved.set(variable.path, formatted.replace(CONTROL, ' '))
    } else if (variable.required && !blockPaths.has(variable.path)) {
      return { ok: false, code: 'missing_variable', path: variable.path }
    } else resolved.set(variable.path, '')
  }
  return {
    ok: true,
    fill: (text) =>
      text.replace(PLACEHOLDER, (_, raw: string) => resolved.get(raw.trim())!),
  }
}

/**
 * Fills `body` with `values`, then puts `blocks` in place of their block
 * placeholders (module comment). The body is not mutated.
 */
export function fillTemplate(
  body: PdfDocument,
  variables: TemplateVariable[],
  values: Record<string, unknown>,
  timezone: string,
  blocks: BlockValues = {},
): FillResult {
  const prepared = prepare(
    (visit) =>
      mapTexts(body, (text) => {
        visit(text)
        return text
      }),
    variables,
    values,
    timezone,
    new Set(Object.keys(blocks)),
  )
  if (!prepared.ok) return prepared
  const document = mapTexts(body, prepared.fill)
  return {
    ok: true,
    document: {
      ...document,
      // mapTexts keeps the blocks' order: each is matched with its unfilled self.
      blocks: document.blocks.flatMap((block, i) => {
        const path = blockPath(body.blocks[i], blocks)
        return path === null ? [block] : blocks[path].map((b) => ({ ...b }))
      }),
    },
  }
}

/**
 * Fills plain strings (a version's Documenso email subject and message,
 * whose placeholders the database checks like the body's) under the same
 * rules as `fillTemplate`. The strings themselves keep their line breaks;
 * control characters are removed from values only. A path of `blocks` (the
 * body's block placeholders) is never `missing_variable` here either: in a
 * text it reads as its value, or empty.
 */
export function fillTexts<K extends string>(
  texts: Record<K, string>,
  variables: TemplateVariable[],
  values: Record<string, unknown>,
  timezone: string,
  blocks: BlockValues = {},
): { ok: true; texts: Record<K, string> } | FillError {
  const entries = Object.entries(texts) as [K, string][]
  const prepared = prepare(
    (visit) => entries.forEach(([, text]) => visit(text)),
    variables,
    values,
    timezone,
    new Set(Object.keys(blocks)),
  )
  if (!prepared.ok) return prepared
  return {
    ok: true,
    texts: Object.fromEntries(
      entries.map(([key, text]) => [key, prepared.fill(text)]),
    ) as Record<K, string>,
  }
}
