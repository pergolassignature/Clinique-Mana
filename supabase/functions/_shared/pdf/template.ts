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
 *   placeholder.
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
  | { ok: false; code: 'missing_variable' | 'unknown_variable'; path: string }
  | { ok: false; code: 'invalid_timezone' }

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

/** Fills `body` with `values` (module comment). The body is not mutated. */
export function fillTemplate(
  body: PdfDocument,
  variables: TemplateVariable[],
  values: Record<string, unknown>,
  timezone: string,
): FillResult {
  if (!isValidTimeZone(timezone)) return { ok: false, code: 'invalid_timezone' }

  const declared = new Set(variables.map((v) => v.path))
  let unknown: string | null = null
  mapTexts(body, (text) => {
    for (const [, raw] of text.matchAll(PLACEHOLDER)) {
      if (unknown === null && !declared.has(raw.trim())) unknown = raw.trim()
    }
    return text
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
    } else if (variable.required) {
      return { ok: false, code: 'missing_variable', path: variable.path }
    } else resolved.set(variable.path, '')
  }

  return {
    ok: true,
    document: mapTexts(
      body,
      (text) =>
        text.replace(
          PLACEHOLDER,
          (_, raw: string) => resolved.get(raw.trim())!,
        ),
    ),
  }
}
