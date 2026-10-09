/**
 * The contract template's body in « Paramètres → Contrats » (Task 4d.3): the renderer's block model
 * (`supabase/functions/_shared/pdf/model.ts`, never HTML) read and written as a plain markup an
 * administrator can type, and its preview. Pure.
 *
 * The markup, one block per paragraph of lines (blank lines separate blocks):
 * - `# Titre`, `## Sous-titre`, `### Intertitre`: headings 1–3;
 * - `- élément` lines: a bulleted list; `1. élément` lines: a numbered list;
 * - `| a | b |` lines: a table, its first line the column labels (equal widths);
 * - `---`: a page break; `[[image logo 120]]`: an image of the clinic (`logo` or `signature`);
 * - anything else: a paragraph, its lines joined by a space; `**gras**` inside a paragraph or an item;
 * - a paragraph that would read as one of the forms above starts with `\` (written for it).
 * The title, the header (with its initials), the footer and the signature page are not in the
 * markup: the editor has a field for each, and they are kept as they are.
 *
 * `{{pricing.annexe_a}}` alone in a paragraph is Annexe A's block placeholder (P4-433): the
 * function puts the professional's tables there; the preview shows a sample.
 */

export type Run = { text: string; bold?: boolean }
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'table'; columns: { label: string; width: number }[]; rows: string[][] }
  | { type: 'image'; assetKey: string; width: number }
  | { type: 'pageBreak' }
  | { type: 'signaturePage'; signers: { role: string; label: string }[] }
export interface PdfBody {
  title: string
  header?: { text: string; initialsFor?: string[] }
  footer: { text: string }
  blocks: Block[]
}

/** The draft's first line until the text is validated (the migration's seed). */
export const VALIDATION_BANNER = 'Texte à faire valider par la direction avant publication'
/** Annexe A's block placeholder (P4-433). */
export const ANNEXE_PLACEHOLDER = '{{pricing.annexe_a}}'

/** A stored body as the model, or null when it is not one (the editor then shows it read-only). */
export function asBody(value: Record<string, unknown>): PdfBody | null {
  const body = value as Partial<PdfBody>
  if (typeof body.title !== 'string' || !body.footer || typeof body.footer.text !== 'string' || !Array.isArray(body.blocks)) return null
  return body as PdfBody
}

// --- Runs ---------------------------------------------------------------------------------------

const runsText = (runs: Run[]) => runs.map((r) => (r.bold ? `**${r.text}**` : r.text)).join('')

/** `a **b** c` → runs; an unclosed `**` stays as text. */
export function parseRuns(text: string): Run[] {
  const runs: Run[] = []
  const parts = text.split('**')
  // An even number of parts means an unclosed marker: the last one is text with its `**`.
  const closed = parts.length % 2 === 1 ? parts : [...parts.slice(0, -2), `${parts.at(-2)}**${parts.at(-1)}`]
  closed.forEach((part, i) => {
    if (part === '') return
    const bold = i % 2 === 1
    const last = runs.at(-1)
    if (last && Boolean(last.bold) === bold) last.text += part
    else runs.push(bold ? { text: part, bold: true } : { text: part })
  })
  return runs.length > 0 ? runs : [{ text: '' }]
}

// --- Body → markup -------------------------------------------------------------------------------

const BLOCK_START = /^(#{1,3} |- |\d+\. |\||---$|\[\[|\\)/

function blockMarkup(block: Block): string | null {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`
    case 'paragraph': {
      const text = runsText(block.runs)
      return BLOCK_START.test(text) ? `\\${text}` : text
    }
    case 'list':
      return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${runsText(item)}`).join('\n')
    case 'table':
      return [block.columns.map((c) => c.label), ...block.rows].map((row) => `| ${row.join(' | ')} |`).join('\n')
    case 'image':
      return `[[image ${block.assetKey} ${block.width}]]`
    case 'pageBreak':
      return '---'
    case 'signaturePage':
      return null
  }
}

/** The blocks before the signature page, as markup. */
export function bodyToMarkup(body: PdfBody): string {
  return body.blocks
    .map(blockMarkup)
    .filter((m): m is string => m !== null)
    .join('\n\n')
}

// --- Markup → body ------------------------------------------------------------------------------

const HEADING = /^(#{1,3}) (.*)$/
const BULLET = /^- (.*)$/
const NUMBERED = /^\d+\. (.*)$/
const IMAGE = /^\[\[image ([a-z][a-z0-9_]{0,39}) (\d{1,3})\]\]$/

/** Splits the markup into blocks of lines (blank lines separate them). */
function chunks(markup: string): string[][] {
  const out: string[][] = []
  let current: string[] = []
  for (const raw of markup.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      if (current.length > 0) out.push(current)
      current = []
    } else current.push(line)
  }
  if (current.length > 0) out.push(current)
  return out
}

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

function chunkBlocks(lines: string[]): Block[] {
  const first = (lines[0] ?? '').trim()
  if (lines.length === 1 && first === '---') return [{ type: 'pageBreak' }]
  const image = lines.length === 1 ? IMAGE.exec(first) : null
  if (image?.[1] && image[2]) return [{ type: 'image', assetKey: image[1], width: Math.min(468, Math.max(1, Number(image[2]))) }]
  const heading = HEADING.exec(first)
  if (heading?.[1] && heading[2] !== undefined) {
    // A heading is one line; the lines after it are a paragraph.
    const rest = lines.slice(1)
    return [{ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() }, ...(rest.length > 0 ? chunkBlocks(rest) : [])]
  }
  if (lines.every((l) => BULLET.test(l.trim()))) {
    return [{ type: 'list', ordered: false, items: lines.map((l) => parseRuns(BULLET.exec(l.trim())?.[1] ?? '')) }]
  }
  if (lines.every((l) => NUMBERED.test(l.trim()))) {
    return [{ type: 'list', ordered: true, items: lines.map((l) => parseRuns(NUMBERED.exec(l.trim())?.[1] ?? '')) }]
  }
  if (lines.every((l) => l.trim().startsWith('|'))) {
    const [head = [''], ...rows] = lines.map(tableCells)
    const width = Math.floor(100 / head.length)
    return [
      {
        type: 'table',
        columns: head.map((label) => ({ label, width })),
        // One cell per column: missing cells are empty, extra ones dropped.
        rows: rows.map((row) => head.map((_, i) => row[i] ?? '')),
      },
    ]
  }
  const text = lines.map((l) => l.trim()).join(' ')
  return [{ type: 'paragraph', runs: parseRuns(text.startsWith('\\') ? text.slice(1) : text) }]
}

/**
 * The body with `markup` as its blocks; the title, header, footer and signature page come from
 * `base` (with the editor's fields applied by the caller).
 */
export function markupToBody(markup: string, base: PdfBody): PdfBody {
  const signature = base.blocks.filter((b) => b.type === 'signaturePage')
  return { ...base, blocks: [...chunks(markup).flatMap(chunkBlocks), ...signature] }
}

// --- Checks the editor shows before the database refuses -------------------------------------------

/** The draft still carries the « à faire valider » line: publishing is not offered (Mise en service 11). */
export const hasValidationBanner = (markup: string) => markup.includes(VALIDATION_BANNER)

/** Annexe A's placeholder is alone in a paragraph somewhere (otherwise no table is printed). */
export const hasAnnexePlaceholder = (markup: string) => chunks(markup).some((lines) => lines.length === 1 && lines[0]?.trim() === ANNEXE_PLACEHOLDER)

const PLACEHOLDER = /\{\{([^{}\r\n]*)\}\}/g

/** The placeholders of `texts` that are not declared variables (the database would refuse them). */
export function unknownPlaceholders(texts: string[], declared: readonly string[]): string[] {
  const known = new Set(declared)
  const unknown = new Set<string>()
  for (const text of texts) {
    for (const [, raw = ''] of text.matchAll(PLACEHOLDER)) if (!known.has(raw.trim())) unknown.add(raw.trim())
  }
  return [...unknown]
}

// --- Preview ------------------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The French labels the preview's sample Annexe A uses (a real one comes from the professional's grid). */
export interface PreviewText {
  annexeSample: { caption: string; columns: string[]; rows: string[][] }
  initials: string
  signature: string
  date: string
  page: string
}

/**
 * A self-contained HTML page of the body with every placeholder replaced by its sample (escaped,
 * never markup), shown in a sandboxed iframe (`sandbox=""`: no script, no navigation). It is a
 * reading aid, not the PDF: page breaks are rules, the initials box sits in the header once.
 */
export function previewHtml(body: PdfBody, samples: Readonly<Record<string, string>>, text: PreviewText): string {
  const fill = (value: string) =>
    escapeHtml(value).replace(/\{\{([^{}\r\n]*)\}\}/g, (match, raw: string) => {
      const sample = samples[raw.trim()]
      return sample === undefined ? `<mark>${match}</mark>` : `<span class="v">${escapeHtml(sample)}</span>`
    })
  const runs = (items: Run[]) => items.map((r) => (r.bold ? `<strong>${fill(r.text)}</strong>` : fill(r.text))).join('')
  const table = (columns: string[], rows: string[][]) =>
    `<table><thead><tr>${columns.map((c) => `<th>${fill(c)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((row) => `<tr>${row.map((c) => `<td>${fill(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`
  const html = body.blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `<h${block.level}>${fill(block.text)}</h${block.level}>`
        case 'paragraph':
          if (block.runs.length === 1 && block.runs[0]?.text.trim() === ANNEXE_PLACEHOLDER) {
            return `<p class="note">${escapeHtml(text.annexeSample.caption)}</p>${table(text.annexeSample.columns, text.annexeSample.rows)}`
          }
          return `<p>${runs(block.runs)}</p>`
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul'
          return `<${tag}>${block.items.map((item) => `<li>${runs(item)}</li>`).join('')}</${tag}>`
        }
        case 'table':
          return table(
            block.columns.map((c) => c.label),
            block.rows,
          )
        case 'image':
          return `<p class="note">[${escapeHtml(block.assetKey)}]</p>`
        case 'pageBreak':
          return '<hr>'
        case 'signaturePage':
          return `<hr><h2>Signatures</h2>${block.signers
            .map(
              (s) =>
                `<div class="sig"><p><strong>${fill(s.label)}</strong></p><div class="boxes"><span class="box wide">${escapeHtml(text.signature)}</span><span class="box">${escapeHtml(text.date)}</span></div></div>`,
            )
            .join('')}`
      }
    })
    .join('')
  const initials = (body.header?.initialsFor ?? []).length > 0 ? `<span class="box small">${escapeHtml(text.initials)}</span>` : ''
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><style>
body{font:13px/1.5 system-ui,sans-serif;color:#222;margin:0;padding:24px;background:#fff}
header,footer{display:flex;justify-content:space-between;align-items:center;color:#666;font-size:11px}
header{border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:16px}footer{border-top:1px solid #ddd;padding-top:8px;margin-top:24px}
h1{font-size:20px}h2{font-size:16px}h3{font-size:14px}table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border-bottom:1px solid #ddd;text-align:left;padding:4px 6px;vertical-align:top}th{border-bottom:2px solid #222}
.v{background:#eef6f4;border-radius:2px}mark{background:#fde2e2}.note{color:#666;font-style:italic}
.box{display:inline-block;border:1px solid #888;padding:12px 8px 2px;font-size:10px;color:#666;min-width:80px}.box.wide{min-width:240px}.box.small{min-width:56px}
.boxes{display:flex;gap:16px}.sig{margin:16px 0}hr{border:0;border-top:1px dashed #bbb;margin:24px 0}
</style></head><body><header><span>${fill(body.header?.text ?? '')}</span>${initials}</header>${html}<footer><span>${fill(body.footer.text)}</span><span>${escapeHtml(
    text.page,
  )}</span></footer></body></html>`
}
