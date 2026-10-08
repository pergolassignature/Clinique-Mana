/**
 * The body language staff write email templates in.
 *
 * - Paragraphs are separated by a blank line; a single line break stays a
 *   line break inside its paragraph.
 * - `**bold**` (within one line).
 * - Lines starting with `- ` form a bullet list.
 *
 * Nothing else is interpreted: no links, no HTML. `<`, `>`, `&` and quotes are
 * always escaped, so template text can never inject markup. `{{ … }}`
 * placeholders pass through untouched; `render.ts` fills them afterwards, so a
 * value is never read as markup either.
 */
import { BODY_TEXT } from './tokens.ts'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** HTML-escapes text for element content and for quoted attribute values alike. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

type Block = { kind: 'paragraph' | 'list'; lines: string[] }

const BULLET = /^- (.*)$/
const BOLD = /\*\*(.+?)\*\*/g

/** Blocks of trimmed lines: blank lines split paragraphs; runs of `- ` lines are lists. */
function parse(text: string): Block[] {
  const blocks: Block[] = []
  for (const chunk of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let current = null as Block | null
    for (const raw of chunk.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      const item = BULLET.exec(line)
      const kind = item ? 'list' : 'paragraph'
      if (current?.kind !== kind) {
        current = { kind, lines: [] }
        blocks.push(current)
      }
      current.lines.push(item ? item[1] : line)
    }
  }
  return blocks
}

const P_STYLE = `margin:0 0 16px;${BODY_TEXT}`
const UL_STYLE = `margin:0 0 16px;padding:0 0 0 24px;${BODY_TEXT}`
const LI_STYLE = 'margin:0 0 4px'

/** One line, escaped, with `**bold**` as `<strong>`. */
const inlineHtml = (line: string) =>
  escapeHtml(line).replace(BOLD, '<strong style="font-weight:600">$1</strong>')

/** Template text → inline-styled HTML (`<p>`, `<ul>`, `<strong>`, `<br>`), every character escaped. */
export function toHtml(text: string): string {
  return parse(text)
    .map((block) =>
      block.kind === 'list'
        ? `<ul style="${UL_STYLE}">${
          block.lines.map((l) =>
            `<li style="${LI_STYLE}">${inlineHtml(l)}</li>`
          ).join('')
        }</ul>`
        : `<p style="${P_STYLE}">${
          block.lines.map(inlineHtml).join('<br>')
        }</p>`
    )
    .join('')
}

/** Template text → the plain-text part: same blocks, `- ` bullets, bold markers removed. */
export function toText(text: string): string {
  return parse(text)
    .map((block) =>
      block.lines
        .map((l) => (block.kind === 'list' ? '- ' : '') + l.replace(BOLD, '$1'))
        .join('\n')
    )
    .join('\n\n')
}
