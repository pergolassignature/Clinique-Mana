/**
 * Spike renderer (Task 3.29): the Task 3.30 model rendered with pdfmake 0.3
 * (Node build) inside Deno. Letter size, Inter, fixed signing boxes.
 *
 * Fields are placed at fixed coordinates, never found by text anchors (design
 * §6.1): one initials box per `initialsFor` role in every page header, and a
 * signature page whose boxes sit at fixed positions.
 */
import pdfmakeModule from 'pdfmake'
import { INTER_WOFF_BASE64 } from '../fonts.ts'
import type {
  Block,
  PdfDocument,
  RenderedPdf,
  Run,
  SigningField,
} from './model.ts'

// pdfmake ships no types for its Node build; this is the part we use.
interface Pdfmake {
  virtualfs: { writeFileSync(name: string, content: Uint8Array): void }
  setFonts(fonts: Record<string, Record<string, string>>): void
  setUrlAccessPolicy(allow: (url: string) => boolean): void
  setLocalAccessPolicy(allow: (path: string) => boolean): void
  createPdf(definition: Record<string, unknown>): {
    getBuffer(): Promise<Uint8Array>
  }
}
type Content = Record<string, unknown> | string

const pdfmake = pdfmakeModule as unknown as Pdfmake

export const PAGE = { width: 612, height: 792 } // Letter, points
const MARGIN = { left: 72, top: 100, right: 72, bottom: 64 }
const INITIALS = { top: 28, width: 64, height: 32, gap: 8 }
const SIGNER = { top: 190, step: 170, sigWidth: 288, sigHeight: 72 }
const DATE_BOX = { left: 384, width: 156, height: 36 }
const BOX_COLOR = '#8A8F98'
const TEXT_COLOR = '#1F2328'
const MUTED = '#5F6670'
// A fixed creation date keeps the output byte-stable (determinism check).
const EPOCH = new Date('2026-01-01T00:00:00Z')

let fontsReady = false

/** Registers Inter once per isolate (decoding is not done at import time). */
function ensureFonts(): void {
  if (fontsReady) return
  for (const [weight, base64] of Object.entries(INTER_WOFF_BASE64)) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    pdfmake.virtualfs.writeFileSync(`inter-${weight}.woff`, bytes)
  }
  pdfmake.setFonts({
    Inter: { normal: 'inter-400.woff', bold: 'inter-700.woff' },
    InterSemiBold: { normal: 'inter-600.woff', bold: 'inter-700.woff' },
  })
  // Documents never fetch a URL or read a file: assets arrive as bytes.
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy(() => false)
  fontsReady = true
}

function toDataUrl(bytes: Uint8Array): string {
  const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg'
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

const runs = (items: Run[]) =>
  items.map((r) => ({ text: r.text, bold: r.bold ?? false }))

const box = (x: number, y: number, w: number, h: number) => ({
  type: 'rect',
  x,
  y,
  w,
  h,
  lineWidth: 0.75,
  lineColor: BOX_COLOR,
})

const pct = (value: number, total: number) =>
  Math.round((value / total) * 1e6) / 1e4

function field(
  role: string,
  type: SigningField['type'],
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
): SigningField {
  return {
    role,
    type,
    page,
    x: pct(x, PAGE.width),
    y: pct(y, PAGE.height),
    width: pct(w, PAGE.width),
    height: pct(h, PAGE.height),
  }
}

/** Left edge of the initials box of role number `index`, right-aligned. */
function initialsX(index: number, count: number): number {
  const right = PAGE.width - MARGIN.right
  return right - (count - index) * INITIALS.width -
    (count - index - 1) * INITIALS.gap
}

function blockContent(block: Block, signerFields: SignerSlot[]): Content[] {
  switch (block.type) {
    case 'heading':
      return [{ text: block.text, style: `h${block.level}` }]
    case 'paragraph':
      return [{ text: runs(block.runs), style: 'p' }]
    case 'list':
      return [{
        [block.ordered ? 'ol' : 'ul']: block.items.map((item) => ({
          text: runs(item),
        })),
        style: 'list',
      }]
    case 'table':
      return [{
        table: {
          headerRows: 1,
          widths: block.columns.map((c) => `${c.width}%`),
          body: [
            block.columns.map((c) => ({ text: c.label, style: 'th' })),
            ...block.rows,
          ],
        },
        layout: 'lightHorizontalLines',
        style: 'table',
      }]
    case 'image':
      return [{ image: block.assetKey, width: block.width, style: 'image' }]
    case 'pageBreak':
      return [{ text: '', pageBreak: 'after' }]
    case 'signaturePage':
      return [
        { text: 'Signatures', style: 'h1', pageBreak: 'before' },
        ...block.signers.flatMap((signer, i) => {
          const top = SIGNER.top + i * SIGNER.step
          signerFields.push({ role: signer.role, top })
          return [
            {
              text: signer.label,
              style: 'signer',
              absolutePosition: { x: MARGIN.left, y: top - 22 },
            },
            {
              canvas: [
                box(MARGIN.left, top, SIGNER.sigWidth, SIGNER.sigHeight),
                box(DATE_BOX.left, top, DATE_BOX.width, DATE_BOX.height),
              ],
              absolutePosition: { x: 0, y: 0 },
            },
            {
              text: 'Signature',
              style: 'caption',
              absolutePosition: {
                x: MARGIN.left,
                y: top + SIGNER.sigHeight + 4,
              },
            },
            {
              text: 'Date',
              style: 'caption',
              absolutePosition: {
                x: DATE_BOX.left,
                y: top + DATE_BOX.height + 4,
              },
            },
          ]
        }),
      ]
  }
}

interface SignerSlot {
  role: string
  top: number
}

/** Renders `doc` to PDF bytes, with its page count and signing fields. */
export async function renderWithPdfmake(
  doc: PdfDocument,
  assets: Record<string, Uint8Array>,
  options: { compress?: boolean } = {},
): Promise<RenderedPdf> {
  ensureFonts()
  const roles = doc.header?.initialsFor ?? []
  const signerSlots: SignerSlot[] = []
  const content = doc.blocks.flatMap((b) => blockContent(b, signerSlots))
  let pageCount = 0

  const bytes = await pdfmake.createPdf({
    pageSize: 'LETTER',
    pageMargins: [MARGIN.left, MARGIN.top, MARGIN.right, MARGIN.bottom],
    compress: options.compress ?? true,
    info: { title: doc.title, creator: 'Clinique MANA', creationDate: EPOCH },
    images: Object.fromEntries(
      Object.entries(assets).map(([key, value]) => [key, toDataUrl(value)]),
    ),
    defaultStyle: { font: 'Inter', fontSize: 10, color: TEXT_COLOR },
    styles: {
      h1: {
        font: 'InterSemiBold',
        fontSize: 16,
        margin: [0, 0, 0, 10],
      },
      h2: { font: 'InterSemiBold', fontSize: 12, margin: [0, 10, 0, 6] },
      h3: { font: 'InterSemiBold', fontSize: 10.5, margin: [0, 8, 0, 4] },
      p: { lineHeight: 1.3, margin: [0, 0, 0, 6] },
      list: { lineHeight: 1.3, margin: [12, 0, 0, 6] },
      table: { fontSize: 9, margin: [0, 4, 0, 10] },
      th: { font: 'InterSemiBold' },
      image: { margin: [0, 0, 0, 12] },
      signer: { font: 'InterSemiBold', fontSize: 11 },
      caption: { fontSize: 7.5, color: MUTED },
      header: { fontSize: 8, color: MUTED },
    },
    header: () => [
      ...(doc.header
        ? [{
          text: doc.header.text,
          style: 'header',
          absolutePosition: { x: MARGIN.left, y: 40 },
        }]
        : []),
      ...(roles.length
        ? [
          {
            canvas: roles.map((_, i) =>
              box(
                initialsX(i, roles.length),
                INITIALS.top,
                INITIALS.width,
                INITIALS.height,
              )
            ),
            absolutePosition: { x: 0, y: 0 },
          },
          ...roles.map((_, i) => ({
            text: 'Initiales',
            style: 'caption',
            absolutePosition: {
              x: initialsX(i, roles.length),
              y: INITIALS.top + INITIALS.height + 3,
            },
          })),
        ]
        : []),
    ],
    footer: (current: number, count: number) => {
      pageCount = count
      return {
        columns: [
          { text: doc.footer.text, style: 'header' },
          {
            text: `Page ${current} de ${count}`,
            style: 'header',
            alignment: 'right',
          },
        ],
        margin: [MARGIN.left, 24, MARGIN.right, 0],
      }
    },
    content,
  }).getBuffer()

  const fields: SigningField[] = []
  for (let page = 1; page <= pageCount; page++) {
    roles.forEach((role, i) =>
      fields.push(
        field(
          role,
          'INITIALS',
          page,
          initialsX(i, roles.length),
          INITIALS.top,
          INITIALS.width,
          INITIALS.height,
        ),
      )
    )
  }
  for (const slot of signerSlots) {
    fields.push(
      field(
        slot.role,
        'SIGNATURE',
        pageCount,
        MARGIN.left,
        slot.top,
        SIGNER.sigWidth,
        SIGNER.sigHeight,
      ),
      field(
        slot.role,
        'DATE',
        pageCount,
        DATE_BOX.left,
        slot.top,
        DATE_BOX.width,
        DATE_BOX.height,
      ),
    )
  }
  return { bytes: new Uint8Array(bytes), pageCount, fields }
}
