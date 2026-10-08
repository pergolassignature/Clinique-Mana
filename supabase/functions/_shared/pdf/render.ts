/**
 * The pdfmake renderer (P3-1, P3-19, ADR 0008): a `PdfDocument` → Letter PDF
 * bytes, its page count and its signing fields. Inter is embedded.
 *
 * Signing fields sit at fixed coordinates, never found by text anchors
 * (design §6.1):
 * - one initials box per `header.initialsFor` role in every page header,
 *   right-aligned;
 * - the signature page always starts a new page and, being the last block,
 *   is the last page; each signer gets a signature box and a date box at a
 *   fixed position.
 *
 * Rendering rules:
 * - the document is validated first (`checkDocument`);
 * - output is deterministic: a fixed creation date, so the same document and
 *   assets give the same bytes (the signing record holds the real dates);
 * - a heading is kept with the block that follows it (never alone at the
 *   bottom of a page);
 * - U+202F (narrow no-break space, absent from Inter) becomes U+00A0, and
 *   control characters other than line breaks become spaces;
 * - images are PNG or JPEG bytes from `assets`, handed to pdfmake as data URLs
 *   only. pdfmake's URL fetching and local file reads are both denied, so a
 *   document can never make the function fetch or read anything.
 *
 * This module imports the vendored pdfmake (`vendor/pdfmake.js`, ~1.2 MB):
 * only the functions that render PDFs may import it (CLAUDE.md §7). The model
 * (`model.ts`) and template filling (`template.ts`) do not.
 */
import { sniff } from '../storage.ts'
import { INTER_WOFF_BASE64 } from './fonts.ts'
import {
  type Block,
  checkDocument,
  type PdfAssets,
  type PdfDocument,
  PdfError,
  type RenderedPdf,
  type Run,
  type SignerRole,
  type SigningField,
} from './model.ts'
import pdfmake from './vendor/pdfmake.js'

type Content = Record<string, unknown>
/** What `pageBreakBefore` sees of a laid-out node. */
type Marked = { headlineLevel?: number }

const PAGE = { width: 612, height: 792 } // Letter, points
const MARGIN = { left: 72, top: 100, right: 72, bottom: 64 }
const CONTENT_HEIGHT = PAGE.height - MARGIN.top - MARGIN.bottom
const INITIALS = { top: 28, width: 64, height: 32, gap: 8 }
/** Signer `i`'s boxes start at `top + i * step` on the signature page. */
const SIGNER = { top: 190, step: 170, width: 288, height: 72 }
const DATE_BOX = { left: 384, width: 156, height: 36 }
const BOX_COLOR = '#8A8F98'
const TEXT_COLOR = '#1F2328'
const MUTED = '#5F6670'
// Fixed so that the output is byte-stable (see the module comment).
const CREATION_DATE = new Date('2026-01-01T00:00:00Z')

const STYLES = {
  h1: { font: 'InterSemiBold', fontSize: 16, margin: [0, 0, 0, 10] },
  h2: { font: 'InterSemiBold', fontSize: 12, margin: [0, 10, 0, 6] },
  h3: { font: 'InterSemiBold', fontSize: 10.5, margin: [0, 8, 0, 4] },
  p: { lineHeight: 1.3, margin: [0, 0, 0, 6] },
  list: { lineHeight: 1.3, margin: [12, 0, 0, 6] },
  table: { fontSize: 9, margin: [0, 4, 0, 10] },
  th: { font: 'InterSemiBold' },
  image: { margin: [0, 0, 0, 12] },
  signer: { font: 'InterSemiBold', fontSize: 11, lineHeight: 1.15 },
  caption: { fontSize: 7.5, color: MUTED },
  chrome: { fontSize: 8, color: MUTED },
}

let configured = false

/**
 * Registers Inter and the access policies on pdfmake's module-wide instance,
 * once per isolate (the fonts are decoded on first use, not at import).
 */
function configure(): void {
  if (configured) return
  for (const [weight, base64] of Object.entries(INTER_WOFF_BASE64)) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    pdfmake.virtualfs.writeFileSync(`inter-${weight}.woff`, bytes)
  }
  pdfmake.setFonts({
    Inter: { normal: 'inter-400.woff', bold: 'inter-700.woff' },
    InterSemiBold: { normal: 'inter-600.woff', bold: 'inter-700.woff' },
  })
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy(() => false)
  configured = true
}

/** Narrow NBSP → NBSP; control characters but `\n` → space. */
const clean = (text: string) =>
  text.replace(
    /\u202F|[^\P{Cc}\n]/gu,
    (c) => (c === '\u202F' ? '\u00A0' : ' '),
  )

const runs = (items: Run[]) =>
  items.map((r) => ({ text: clean(r.text), bold: r.bold ?? false }))

/** The image as a data URL, or a PdfError when it is not PNG or JPEG. */
function dataUrl(key: string, bytes: Uint8Array | undefined): string {
  if (!bytes) throw new PdfError('missing_asset', `no asset « ${key} »`)
  const type = sniff(bytes)
  if (type !== 'png' && type !== 'jpeg') {
    throw new PdfError('unsupported_image', `asset « ${key} » is not PNG/JPEG`)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/${type};base64,${btoa(binary)}`
}

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
  role: SignerRole,
  type: SigningField['type'],
  page: number,
  [x, y, w, h]: [number, number, number, number],
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

/** The initials box of role number `i` of `count`, right-aligned in the header. */
function initialsBox(
  i: number,
  count: number,
): [number, number, number, number] {
  const right = PAGE.width - MARGIN.right
  const x = right - (count - i) * INITIALS.width -
    (count - i - 1) * INITIALS.gap
  return [x, INITIALS.top, INITIALS.width, INITIALS.height]
}

const signatureBox = (i: number): [number, number, number, number] => [
  MARGIN.left,
  SIGNER.top + i * SIGNER.step,
  SIGNER.width,
  SIGNER.height,
]
const dateBox = (i: number): [number, number, number, number] => [
  DATE_BOX.left,
  SIGNER.top + i * SIGNER.step,
  DATE_BOX.width,
  DATE_BOX.height,
]

/**
 * Keep-with-next marks, carried by pdfmake's free `headlineLevel` field into
 * `pageBreakBefore`: a heading that must not end a page, and the first node
 * of every other block (the page header and footer, also laid out on each
 * page, carry no mark).
 */
const KEEP_WITH_NEXT = 1
const BLOCK = 2

/** A heading is kept with what follows unless nothing (or a break) does. */
const keepsWithNext = (block: Block, next: Block | undefined) =>
  block.type === 'heading' && next !== undefined &&
  next.type !== 'pageBreak' && next.type !== 'signaturePage'

function blockContent(block: Block): Content[] {
  switch (block.type) {
    case 'heading':
      return [{ text: clean(block.text), style: `h${block.level}` }]
    case 'paragraph':
      return [{ text: runs(block.runs), style: 'p' }]
    case 'list':
      return [{
        [block.ordered ? 'ol' : 'ul']: block.items.map((item) => ({
          text: runs(item),
        })),
        style: 'list',
      }]
    case 'table': {
      const total = block.columns.reduce((sum, c) => sum + c.width, 0)
      return [{
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: block.columns.map((c) => `${(c.width / total) * 100}%`),
          body: [
            block.columns.map((c) => ({ text: clean(c.label), style: 'th' })),
            ...block.rows.map((row) => row.map(clean)),
          ],
        },
        layout: 'lightHorizontalLines',
        style: 'table',
      }]
    }
    case 'image':
      return [{
        image: block.assetKey,
        fit: [block.width, CONTENT_HEIGHT],
        style: 'image',
      }]
    case 'pageBreak':
      return [{ text: '', pageBreak: 'after' }]
    case 'signaturePage':
      return [
        { text: 'Signatures', style: 'h1', pageBreak: 'before' },
        ...block.signers.flatMap((signer, i) => {
          const [x, top] = signatureBox(i)
          return [
            {
              text: clean(signer.label),
              style: 'signer',
              absolutePosition: { x, y: top - 34 },
            },
            {
              canvas: [box(...signatureBox(i)), box(...dateBox(i))],
              absolutePosition: { x: 0, y: 0 },
            },
            {
              text: 'Signature',
              style: 'caption',
              absolutePosition: { x, y: top + SIGNER.height + 4 },
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

/** The page header: its text, and the initials boxes with their captions. */
function header(doc: PdfDocument, roles: SignerRole[]): Content[] {
  const boxes = roles.map((_, i) => initialsBox(i, roles.length))
  const textRight = boxes.length ? boxes[0][0] - 16 : PAGE.width - MARGIN.right
  return [
    ...(doc.header
      ? [{
        columns: [{
          width: textRight - MARGIN.left,
          text: clean(doc.header.text),
          style: 'chrome',
        }],
        absolutePosition: { x: MARGIN.left, y: 40 },
      }]
      : []),
    ...(boxes.length
      ? [{
        canvas: boxes.map((b) => box(...b)),
        absolutePosition: { x: 0, y: 0 },
      }]
      : []),
    ...boxes.map(([x]) => ({
      text: 'Initiales',
      style: 'caption',
      absolutePosition: { x, y: INITIALS.top + INITIALS.height + 3 },
    })),
  ]
}

/**
 * Renders `doc` with pdfmake (module comment). Throws `PdfError`:
 * `invalid_document` (with the model path), `missing_asset` or
 * `unsupported_image` (with the asset key).
 */
export async function renderPdf(
  doc: PdfDocument,
  assets: PdfAssets,
): Promise<RenderedPdf> {
  const check = checkDocument(doc)
  if (!check.ok) {
    throw new PdfError('invalid_document', `invalid document at ${check.path}`)
  }
  const document = check.document
  const { blocks } = document
  configure()

  const images: Record<string, string> = {}
  for (const block of blocks) {
    if (block.type === 'image' && !(block.assetKey in images)) {
      images[block.assetKey] = dataUrl(block.assetKey, assets[block.assetKey])
    }
  }
  const roles = document.header?.initialsFor ?? []
  const last = blocks[blocks.length - 1]
  const signers = last.type === 'signaturePage' ? last.signers : []
  let pageCount = 0

  const bytes = await pdfmake.createPdf({
    pageSize: 'LETTER',
    pageMargins: [MARGIN.left, MARGIN.top, MARGIN.right, MARGIN.bottom],
    info: {
      title: clean(document.title),
      creator: 'Clinique MANA',
      creationDate: CREATION_DATE,
    },
    images,
    defaultStyle: { font: 'Inter', fontSize: 10, color: TEXT_COLOR },
    styles: STYLES,
    header: () => header(document, roles),
    footer: (current: number, count: number) => {
      pageCount = count
      return {
        columns: [
          { width: '*', text: clean(document.footer.text), style: 'chrome' },
          {
            width: 'auto',
            text: `Page ${current} de ${count}`,
            style: 'chrome',
          },
        ],
        columnGap: 16,
        margin: [MARGIN.left, 24, MARGIN.right, 0],
      }
    },
    // A marked heading with no block after it on its page moves to the next.
    pageBreakBefore: (
      node: Marked,
      nodes: { getFollowingNodesOnPage(): Marked[] },
    ) =>
      node.headlineLevel === KEEP_WITH_NEXT &&
      !nodes.getFollowingNodesOnPage().some((n) => n.headlineLevel),
    content: blocks.flatMap((block, i) => {
      const [first, ...rest] = blockContent(block)
      const mark = keepsWithNext(block, blocks[i + 1]) ? KEEP_WITH_NEXT : BLOCK
      return [{ ...first, headlineLevel: mark }, ...rest]
    }),
  }).getBuffer()

  const fields: SigningField[] = []
  for (let page = 1; page <= pageCount; page++) {
    roles.forEach((role, i) =>
      fields.push(
        field(role, 'INITIALS', page, initialsBox(i, roles.length)),
      )
    )
  }
  signers.forEach(({ role }, i) =>
    fields.push(
      field(role, 'SIGNATURE', pageCount, signatureBox(i)),
      field(role, 'DATE', pageCount, dateBox(i)),
    )
  )
  return { bytes: new Uint8Array(bytes), pageCount, fields }
}
