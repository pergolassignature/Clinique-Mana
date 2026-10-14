/**
 * Pasting a formatted text (Word, Google Docs, a web page) into the shared editor's « Texte du
 * document » (CC-21): the clipboard's HTML read as the editor's markup (`markup.ts`), so a text
 * written elsewhere keeps its paragraphs, headings, bold and lists instead of arriving as one block.
 * Pure (a DOMParser, no network, nothing executed: the parsed document is never attached).
 *
 * - `h1`–`h6`: `#`, `##`, `###` (deeper levels are `###`);
 * - `ul` / `ol` and Word's list paragraphs (`MsoListParagraph`, `mso-list`): `-` or `1.` items, the
 *   bullet Word types itself (`mso-list:Ignore`) dropped;
 * - `table`: `| a | b |` lines, the first row the column labels;
 * - `b`, `strong`, a `font-weight` of bold or 600+: `**gras**` (Google Docs' `font-weight:normal`
 *   wrapper is not bold);
 * - everything else: paragraphs; Word's comments, `o:p`, styles and scripts are ignored.
 */

const BLOCK_START = /^(#{1,3} |- |\d+\. |\||---$|\[\[|\\)/
const IGNORED = new Set(['STYLE', 'SCRIPT', 'META', 'LINK', 'TITLE', 'HEAD', 'O:P', 'XML', 'TEMPLATE', 'NOSCRIPT'])
const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'PRE', 'HR'])

type Run = { text: string; bold: boolean }

const styleOf = (el: Element) => (el.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '')

function boldOf(el: Element, inherited: boolean): boolean {
  const weight = /font-weight:([a-z0-9]+)/.exec(styleOf(el))?.[1]
  if (weight) return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600
  if (el.tagName === 'B' || el.tagName === 'STRONG') return true
  return inherited
}

/** Word's own bullet or number (`<span style="mso-list:Ignore">`), never text of the item. */
const isWordBullet = (el: Element) => /mso-list:ignore/.test(styleOf(el))

function runsOf(node: Node, bold: boolean, out: Run[]) {
  if (node.nodeType === 3) {
    out.push({ text: node.textContent ?? '', bold })
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  if (IGNORED.has(el.tagName) || isWordBullet(el)) return
  if (el.tagName === 'BR') {
    out.push({ text: ' ', bold })
    return
  }
  const inner = boldOf(el, bold)
  for (const child of Array.from(el.childNodes)) runsOf(child, inner, out)
}

/** Runs as one markup line: spaces collapsed, `**` around bold words (spaces kept outside them). */
function lineOf(runs: Run[]): string {
  const merged: Run[] = []
  for (const run of runs) {
    // Runs of spaces collapse; a French non-breaking space alone (« : ») stays one.
    const text = run.text.replace(/\s+/g, (space) => (/^\u00a0+$/.test(space) ? '\u00a0' : ' '))
    const last = merged.at(-1)
    if (last && last.bold === run.bold) last.text += text
    else merged.push({ text, bold: run.bold })
  }
  const line = merged
    .map((r) => {
      if (!r.bold || r.text.trim() === '') return r.text
      const lead = /^\s*/.exec(r.text)?.[0] ?? ''
      const trail = /\s*$/.exec(r.text)?.[0] ?? ''
      return `${lead}**${r.text.trim()}**${trail}`
    })
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim()
  return line
}

const plain = (el: Element) => {
  const runs: Run[] = []
  runsOf(el, false, runs)
  return lineOf(runs.map((r) => ({ ...r, bold: false })))
}
const inline = (el: Element) => {
  const runs: Run[] = []
  runsOf(el, false, runs)
  return lineOf(runs)
}

/** A paragraph that would read as a heading, a list or a table starts with `\` (markup.ts). */
const paragraph = (text: string) => (BLOCK_START.test(text) ? `\\${text}` : text)

/** Word's list paragraph: its class or its `mso-list` style (not the bullet span's « Ignore »). */
function wordList(el: Element): { ordered: boolean } | null {
  const style = styleOf(el)
  const listed = /msolistparagraph/i.test(el.getAttribute('class') ?? '') || (/mso-list:/.test(style) && !/mso-list:ignore/.test(style))
  if (!listed) return null
  const bullet = Array.from(el.querySelectorAll('span')).find(isWordBullet)?.textContent ?? ''
  return { ordered: /^\s*\(?[0-9a-z]{1,3}[.)]/i.test(bullet) }
}

class Out {
  blocks: string[] = []
  private list: { ordered: boolean; items: string[] } | null = null
  private pending: Run[] = []

  item(ordered: boolean, text: string) {
    this.flushText()
    if (text === '') return
    if (!this.list || this.list.ordered !== ordered) {
      this.flushList()
      this.list = { ordered, items: [] }
    }
    this.list.items.push(text)
  }
  block(text: string) {
    this.flushText()
    this.flushList()
    if (text.trim() !== '') this.blocks.push(text)
  }
  text(runs: Run[]) {
    this.flushList()
    this.pending.push(...runs)
  }
  flushText() {
    if (this.pending.length === 0) return
    const line = lineOf(this.pending)
    this.pending = []
    if (line !== '') {
      this.flushList()
      this.blocks.push(paragraph(line))
    }
  }
  flushList() {
    if (!this.list) return
    const { ordered, items } = this.list
    this.list = null
    this.blocks.push(items.map((text, i) => `${ordered ? `${i + 1}.` : '-'} ${text}`).join('\n'))
  }
  done(): string {
    this.flushText()
    this.flushList()
    return this.blocks.join('\n\n')
  }
}

function walk(parent: Element, out: Out) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) {
      if ((node.textContent ?? '').trim() !== '') out.text([{ text: node.textContent ?? '', bold: false }])
      continue
    }
    if (node.nodeType !== 1) continue
    const el = node as Element
    const tag = el.tagName
    if (IGNORED.has(tag)) continue
    if (/^H[1-6]$/.test(tag)) {
      const text = plain(el)
      if (text !== '') out.block(`${'#'.repeat(Math.min(3, Number(tag[1])))} ${text}`)
      continue
    }
    if (tag === 'UL' || tag === 'OL') {
      for (const li of Array.from(el.querySelectorAll('li'))) {
        const copy = li.cloneNode(true) as Element
        copy.querySelectorAll('ul, ol').forEach((nested) => nested.remove())
        out.item(li.closest('ol, ul')?.tagName === 'OL', inline(copy))
      }
      continue
    }
    if (tag === 'TABLE') {
      const rows = Array.from(el.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th, td')).map((cell) => plain(cell).replace(/\|/g, '/')))
        .filter((cells) => cells.some((c) => c !== ''))
      if (rows.length > 0) out.block(rows.map((cells) => `| ${cells.join(' | ')} |`).join('\n'))
      continue
    }
    if (tag === 'HR') continue
    if (tag === 'BR') {
      out.flushText()
      continue
    }
    const listed = tag === 'P' || tag === 'DIV' ? wordList(el) : null
    if (listed) {
      out.item(listed.ordered, inline(el))
      continue
    }
    const hasBlocks = Array.from(el.children).some((child) => BLOCKS.has(child.tagName))
    if (hasBlocks) {
      // A wrapper (Google Docs' `<b>`, a `<div>` of paragraphs): its own weight applies to what it holds.
      out.flushText()
      walk(el, out)
      out.flushText()
      continue
    }
    if (BLOCKS.has(tag)) {
      const text = inline(el)
      if (text !== '') out.block(paragraph(text))
      continue
    }
    // Inline content at the top level (a `<span>`, a `<b>`): part of the current paragraph.
    const runs: Run[] = []
    runsOf(el, false, runs)
    out.text(runs)
  }
}

/** The clipboard's HTML as markup, or null when it holds no text (the browser then pastes as usual). */
export function htmlToMarkup(html: string): string | null {
  // Word wraps its HTML in comments (`<!--StartFragment-->`) and conditional blocks: the parser drops them.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = new Out()
  walk(doc.body, out)
  const markup = out.done().trim()
  return markup === '' ? null : markup
}
