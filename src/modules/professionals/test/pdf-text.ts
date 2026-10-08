import { inflateSync } from 'node:zlib'

/**
 * Reads back what a react-pdf (pdfkit) document draws, for tests (Node only; test-only, like the
 * pdfmake renderer's `streams()` in `supabase/functions/_shared/pdf/render.test.ts`): the text of
 * each page through each font's ToUnicode map, the fonts embedded and the images. pdfkit writes
 * plain objects (no object streams) and Flate streams, each glyph run a `TJ` of 2-byte codes.
 */

interface PdfObject {
  dict: string
  stream: Buffer | null
}

export interface PdfReading {
  /** Each page's text: one line per laid-out line, in drawing order. */
  pages: string[]
  /** `/BaseFont` of every font object (`ABCDEF+Raleway-Regular`, `Helvetica`…). */
  fonts: string[]
  /** How many image XObjects the document holds. */
  images: number
  /** Glyph code 0 (`.notdef`, a character no font had) drawn anywhere. */
  notdef: number
  /** Runs drawn outside their page's MediaBox (a layout bug: text no one sees). */
  offPage: number
  /** The document information dictionary's title, when set as a literal string. */
  title: string | null
}

/** Every `N 0 obj`: its dictionary, and its stream (inflated) read by `/Length`, never by searching binary data. */
function objects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1')
  const found = new Map<number, PdfObject>()
  const header = /(\d+) 0 obj\s*/g
  for (let match = header.exec(text); match; match = header.exec(text)) {
    const from = header.lastIndex
    const endobj = text.indexOf('endobj', from)
    const streamAt = text.indexOf('stream', from)
    if (streamAt < 0 || streamAt > endobj) {
      found.set(Number(match[1]), { dict: text.slice(from, endobj), stream: null })
      header.lastIndex = endobj
      continue
    }
    const dict = text.slice(from, streamAt)
    const start = streamAt + (text[streamAt + 6] === '\r' ? 8 : 7)
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0)
    const raw = pdf.subarray(start, start + length)
    found.set(Number(match[1]), { dict, stream: /\/FlateDecode/.test(dict) ? inflateSync(raw) : raw })
    header.lastIndex = start + length
  }
  return found
}

const ref = (dict: string, key: string): number | null => {
  const match = new RegExp(`/${key} (\\d+) 0 R`).exec(dict)
  return match ? Number(match[1]) : null
}

/** code → text, from a ToUnicode CMap (`bfchar` and both `bfrange` forms). */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>()
  // A ligature (Raleway's « fi », « ffi ») maps to several UTF-16 units, which pdfkit writes apart: <0066 0069>.
  const utf16 = (hex: string) => String.fromCharCode(...(hex.replace(/\s+/g, '').match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)))
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, value] of (block[1] ?? '').matchAll(/<([0-9a-f]+)>\s*<([0-9a-f\s]+)>/gi)) map.set(parseInt(code ?? '0', 16), utf16(value ?? ''))
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, from, to, rest] of (block[1] ?? '').matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]+>)/gi)) {
      const first = parseInt(from ?? '0', 16)
      const last = parseInt(to ?? '0', 16)
      if (rest?.startsWith('[')) {
        ;[...rest.matchAll(/<([0-9a-f]+)>/gi)].forEach(([, hex], i) => map.set(first + i, utf16(hex ?? '')))
      } else {
        const base = parseInt((rest ?? '<0>').slice(1, -1), 16)
        for (let code = first; code <= last; code++) map.set(code, String.fromCharCode(base + code - first))
      }
    }
  }
  return map
}

type Matrix = [number, number, number, number, number, number]

/** The operators the reader follows, in one pass over a content stream. */
const OPERATORS =
  /\[(?<array>(?:<[0-9a-f]*>|[-\d.\s])*)\]\s*TJ|(?<nums>-?[\d.]+(?:\s+-?[\d.]+){5})\s+(?<kind>cm|Tm)\b|\/(?<fontName>\S+)\s+[\d.]+\s+Tf|(?<![\w/])(?<single>q|Q)(?![\w])/gi

const numbers = (text: string | undefined): Matrix => (text ?? '').trim().split(/\s+/).map(Number) as Matrix

/** `a × b` for the PDF's row-vector 2×3 matrices (`cm` makes the new CTM `M × CTM`). */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

export function readPdf(pdf: Buffer): PdfReading {
  const all = objects(pdf)
  const get = (id: number | null) => (id === null ? undefined : all.get(id))
  const catalog = [...all.values()].find((o) => /\/Type \/Catalog/.test(o.dict))
  const kids = /\/Kids \[([^\]]*)\]/.exec(get(ref(catalog?.dict ?? '', 'Pages'))?.dict ?? '')?.[1] ?? ''
  const pageIds = [...kids.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]))

  let notdef = 0
  let offPage = 0
  const pages = pageIds.map((pageId) => {
    const page = get(pageId)?.dict ?? ''
    const height = Number(/\/MediaBox \[\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s*\]/.exec(page)?.[1] ?? 0)
    const resourcesId = ref(page, 'Resources')
    const resources = resourcesId !== null ? (get(resourcesId)?.dict ?? '') : page
    const fontDict = /\/Font <<([^>]*)>>/.exec(resources)?.[1] ?? ''
    const maps = new Map<string, Map<number, string> | null>()
    for (const [, name, id] of fontDict.matchAll(/\/(\S+) (\d+) 0 R/g)) {
      const cmap = get(ref(get(Number(id))?.dict ?? '', 'ToUnicode'))?.stream
      maps.set(name ?? '', cmap ? toUnicode(cmap.toString('latin1')) : null)
    }
    const content = get(ref(page, 'Contents'))?.stream?.toString('latin1') ?? ''
    // A little interpreter of what pdfkit writes: the transform stack (q, Q, cm) and the text
    // matrix (Tm) place each run (TJ); a run that continues the previous one on its baseline (one
    // laid-out line, split where the font changes) is joined to it.
    const lines: string[] = []
    let font: Map<number, string> | null = null
    let ctm: Matrix = [1, 0, 0, 1, 0, 0]
    let tm: Matrix = [1, 0, 0, 1, 0, 0]
    const stack: Matrix[] = []
    let lastY: number | null = null
    // Where the last run ended: pdfkit moves past each run with a pure translation (`1 0 0 1 dx 0
    // cm`) right after it, so a run that starts there continues the same line (a font change),
    // while one elsewhere at the same height is another column.
    let lastRunX = 0
    let lastEnd: number | null = null
    let awaitingAdvance = false
    for (const op of content.matchAll(OPERATORS)) {
      const { array, nums, kind, fontName, single } = op.groups ?? {}
      if (single === 'q') stack.push(ctm)
      else if (single === 'Q') ctm = stack.pop() ?? ctm
      else if (kind === 'cm') {
        const m = numbers(nums)
        if (awaitingAdvance && m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[5] === 0) {
          lastEnd = lastRunX + m[4]
          awaitingAdvance = false
        }
        ctm = multiply(m, ctm)
      }
      else if (kind === 'Tm') tm = numbers(nums)
      else if (fontName !== undefined) font = maps.get(fontName) ?? null
      else if (array !== undefined) {
        let run = ''
        for (const [, hex] of array.matchAll(/<([0-9a-f]*)>/gi)) {
          if (font) {
            for (const code of hex?.match(/.{4}/g) ?? []) {
              const value = parseInt(code, 16)
              if (value === 0) notdef++
              run += font.get(value) ?? '\ufffd'
            }
          } else {
            // A standard font (WinAnsi): one byte per character.
            for (const code of hex?.match(/.{2}/g) ?? []) run += String.fromCharCode(parseInt(code, 16))
          }
        }
        const [, , , , x, rawY] = multiply(tm, ctm)
        const y = Math.round(rawY * 10) / 10
        if (y < 0 || y > height) offPage++
        if (y === lastY && lastEnd !== null && Math.abs(x - lastEnd) < 1 && lines.length > 0) lines[lines.length - 1] += run
        else lines.push(run)
        lastY = y
        lastRunX = x
        lastEnd = null
        awaitingAdvance = true
      }
    }
    return lines.join('\n')
  })

  const objectsList = [...all.values()]
  const info = objectsList.find((o) => /\/Producer/.test(o.dict))?.dict ?? ''
  const titleRef = ref(info, 'Title')
  const titleObject = titleRef !== null ? get(titleRef)?.dict.trim() : undefined
  return {
    pages,
    fonts: objectsList.flatMap((o) => (/\/Type \/Font\b/.test(o.dict) ? [/\/BaseFont \/(\S+)/.exec(o.dict)?.[1] ?? ''] : [])),
    images: objectsList.filter((o) => /\/Subtype \/Image\b/.test(o.dict)).length,
    notdef,
    offPage,
    title: titleObject ? decodeLiteral(titleObject) : null,
  }
}

/** A PDF literal string `(…)`, or a UTF-16BE one with its byte order mark, as text. */
function decodeLiteral(literal: string): string | null {
  const body = /^\(([\s\S]*)\)$/.exec(literal)?.[1]
  if (body === undefined) return null
  const bytes = body.replace(/\\([()\\])/g, '$1')
  if (bytes.startsWith('þÿ')) {
    let out = ''
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1))
    return out
  }
  return bytes
}
