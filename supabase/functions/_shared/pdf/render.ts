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
 *   fixed position. The headings right before it move with it, above the
 *   boxes; when they do not fit there, `invalid_document`.
 *
 * Rendering rules:
 * - the document is validated first (`checkDocument`, with its size caps);
 * - output is deterministic: a fixed creation date, so the same document and
 *   assets give the same bytes (the signing record holds the real dates);
 * - no page is blank (every page carries initials): a `pageBreak` or the
 *   signature page starts a new page only when something is above it on the
 *   current one, so a break before the signature page, a repeated break or a
 *   trailing one adds nothing;
 * - a heading is kept with the block that follows it (never alone at the
 *   bottom of a page);
 * - text is NFC-normalised; U+202F (narrow no-break space, absent from Inter)
 *   becomes U+00A0, and control characters other than line breaks become
 *   spaces. pdfmake has no font fallback, so each run of text is split where
 *   the Inter subset that holds it changes (latin, latin-ext, vietnamese:
 *   `fonts.ts`); a character in none of them renders as `.notdef`;
 * - images are PNG or JPEG bytes from `assets`, at most 4000 px a side (read
 *   from the PNG header or the JPEG frame header, before any decoding),
 *   handed to pdfmake as data URLs only. pdfmake's URL fetching and local
 *   file reads are both denied, so a document can never make the function
 *   fetch or read anything.
 *
 * This module imports the vendored pdfmake (`vendor/pdfmake.js`, ~1.2 MB):
 * only the functions that render PDFs may import it (CLAUDE.md §7). The model
 * (`model.ts`) and template filling (`template.ts`) do not.
 */
import { toBase64 } from '../bytes.ts'
import { imageSize } from '../image-size.ts'
import { sniff } from '../storage.ts'
import {
  INTER_RANGES,
  INTER_SUBSETS,
  INTER_WOFF_BASE64,
  type InterSubset,
} from './fonts.ts'
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
interface NodeInfo {
  headlineLevel?: number
  /** True for a stack node: the document root is one (it spans every page). */
  stack: boolean
  /** Where the node's first line or image sits (points, top-left origin). */
  startPosition: { pageNumber: number; top: number }
  pageNumbers: number[]
}
/** The node lists pdfmake hands to `pageBreakBefore`. */
interface NodeQueries {
  getFollowingNodesOnPage(): NodeInfo[]
  getPreviousNodesOnPage(): NodeInfo[]
}

const PAGE = { width: 612, height: 792 } // Letter, points
const MARGIN = { left: 72, top: 100, right: 72, bottom: 64 }
const CONTENT_HEIGHT = PAGE.height - MARGIN.top - MARGIN.bottom
const INITIALS = { top: 28, width: 64, height: 32, gap: 8 }
/**
 * Signer `i`'s boxes start at `top + i * step` on the signature page, its
 * label `label` points above. The space above the first label holds the
 * page's title and the headings that moved with it.
 */
const SIGNER = { top: 250, step: 160, width: 288, height: 72, label: 34 }
const DATE_BOX = { left: 384, width: 156, height: 36 }
/** Room the « Signatures » title takes (16 pt line) before the first label. */
const SIGNATURES_TITLE_ROOM = 24
/** Largest PNG / JPEG width or height accepted, in pixels. */
const MAX_IMAGE_SIDE = 4000
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

/** The document styles' Inter families: their normal and bold weights. */
const FAMILIES = {
  Inter: [400, 700],
  InterSemiBold: [600, 700],
} as const
type Family = keyof typeof FAMILIES

/** The pdfmake font of `family` in `subset` (the latin one keeps the bare name). */
const fontName = (family: Family, subset: InterSubset) =>
  subset === 'latin' ? family : `${family}-${subset}`

let configured = false

/**
 * Registers Inter (every subset, both families) and the access policies on
 * pdfmake's module-wide instance, once per isolate. pdfkit parses a font
 * only when a document uses it.
 */
function configure(): void {
  if (configured) return
  const fonts: Record<string, { normal: string; bold: string }> = {}
  for (const subset of INTER_SUBSETS) {
    for (const [weight, base64] of Object.entries(INTER_WOFF_BASE64[subset])) {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      pdfmake.virtualfs.writeFileSync(`inter-${subset}-${weight}.woff`, bytes)
    }
    for (const [family, [normal, bold]] of Object.entries(FAMILIES)) {
      fonts[fontName(family as Family, subset)] = {
        normal: `inter-${subset}-${normal}.woff`,
        bold: `inter-${subset}-${bold}.woff`,
      }
    }
  }
  pdfmake.setFonts(fonts)
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy(() => false)
  configured = true
}

/** A regex character class body for `subset`'s ranges. */
const charClass = (subset: InterSubset) =>
  INTER_RANGES[subset]
    .map(([from, to]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`)
    .join('')
const LATIN_ONLY = new RegExp(`^[${charClass('latin')}]*$`, 'u')
const SUBSET_OF = INTER_SUBSETS.map((subset) =>
  [subset, new RegExp(`[${charClass(subset)}]`, 'u')] as const
)

/** The first subset holding `char` (latin when none does: `.notdef`). */
const subsetOf = (char: string): InterSubset =>
  SUBSET_OF.find(([, holds]) => holds.test(char))?.[0] ?? 'latin'

/** NFC; narrow NBSP → NBSP; control characters but `\n` → space. */
const clean = (text: string) =>
  text.normalize('NFC').replace(
    /\u202F|[^\P{Cc}\n]/gu,
    (c) => (c === '\u202F' ? '\u00A0' : ' '),
  )

/** One inline of text; `font` is set only outside the latin subset. */
type Piece = { text: string; font?: string }

/** `value`, cleaned and split where its Inter subset changes. */
function pieces(value: string, family: Family): Piece[] {
  const text = clean(value)
  if (LATIN_ONLY.test(text)) return [{ text }]
  const out: Piece[] = []
  let subset: InterSubset = 'latin'
  let run = ''
  const flush = () => {
    if (!run) return
    out.push(
      subset === 'latin' ? { text: run } : {
        text: run,
        font: fontName(family, subset),
      },
    )
  }
  for (const char of text) {
    const next = subsetOf(char)
    if (next !== subset) {
      flush()
      run = ''
      subset = next
    }
    run += char
  }
  flush()
  return out
}

/** A node's `text`: a plain string when it is all latin. */
function textOf(value: string, family: Family): string | Piece[] {
  const parts = pieces(value, family)
  return parts.length === 1 && !parts[0].font ? parts[0].text : parts
}

const runs = (items: Run[]) =>
  items.flatMap((r) =>
    pieces(r.text, 'Inter').map((p) => ({ ...p, bold: r.bold ?? false }))
  )

/**
 * The image as a data URL, or a PdfError when it is not PNG or JPEG or is
 * over `MAX_IMAGE_SIDE` pixels a side (checked before pdfkit decodes it).
 */
function dataUrl(key: string, bytes: Uint8Array | undefined): string {
  if (!bytes) throw new PdfError('missing_asset', `no asset « ${key} »`)
  const type = sniff(bytes)
  if (type !== 'png' && type !== 'jpeg') {
    throw new PdfError('unsupported_image', `asset « ${key} » is not PNG/JPEG`)
  }
  const size = imageSize(type, bytes)
  if (!size || size.width === 0 || size.height === 0) {
    throw new PdfError('unsupported_image', `asset « ${key} »: no image size`)
  }
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
    throw new PdfError(
      'image_too_large',
      `asset « ${key} » is over ${MAX_IMAGE_SIDE} px a side`,
    )
  }
  return `data:image/${type};base64,${toBase64(bytes)}`
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
 * Layout marks (bit flags), carried by pdfmake's free `headlineLevel` field
 * into `pageBreakBefore` on the first node of each block. The page header
 * and footer and the nodes inside a block carry none.
 */
const BLOCK = 1
/** A heading that must not end a page. */
const KEEP = 2
/** Starts a new page, unless nothing is above it on the current one. */
const BREAK = 4
/** The signature page's title (its position is checked after layout). */
const SIGNATURES = 8

/** A block that is laid out (a `pageBreak` becomes a mark on the next one). */
type Placed = Exclude<Block, { type: 'pageBreak' }>

/**
 * The blocks to lay out, with their marks (module comment):
 * - a `pageBreak` marks the next block BREAK; with nothing after it, it is
 *   dropped, and repeated ones count once;
 * - the signature page breaks, together with the headings right before it
 *   (the first of them carries BREAK);
 * - every other heading is KEEP, unless nothing follows it or what follows
 *   breaks (moving the heading would then leave it alone on a page).
 */
function placeBlocks(blocks: Block[]): { block: Placed; mark: number }[] {
  const placed: { block: Placed; mark: number }[] = []
  let breakNext = false
  for (const block of blocks) {
    if (block.type === 'pageBreak') {
      breakNext = true
      continue
    }
    placed.push({ block, mark: BLOCK | (breakNext ? BREAK : 0) })
    breakNext = false
  }
  const last = placed.length - 1
  let pageStart = placed.length // first block of the signature page
  if (placed[last].block.type === 'signaturePage') {
    pageStart = last
    while (pageStart > 0 && placed[pageStart - 1].block.type === 'heading') {
      pageStart--
    }
    placed[pageStart].mark |= BREAK
    placed[last].mark |= SIGNATURES
  }
  placed.forEach((item, i) => {
    if (
      item.block.type === 'heading' && i < last && i < pageStart &&
      !(placed[i + 1].mark & BREAK)
    ) {
      item.mark |= KEEP
    }
  })
  return placed
}

/**
 * True when `node` puts something in the body of `page`: it starts there
 * between the margins, or comes from an earlier page. The document root (a
 * stack spanning every page) and the header and footer do not count.
 */
const inBody = (node: NodeInfo, page: number) =>
  !node.stack && (
    node.startPosition.pageNumber < page ||
    (node.startPosition.top >= MARGIN.top - 0.5 &&
      node.startPosition.top < PAGE.height - MARGIN.bottom)
  )

/**
 * pdfmake content for one block. `imageNames` maps an asset key to the name
 * its data URL is registered under.
 */
function blockContent(
  block: Placed,
  imageNames: Map<string, string>,
): Content[] {
  switch (block.type) {
    case 'heading':
      return [{
        text: textOf(block.text, 'InterSemiBold'),
        style: `h${block.level}`,
      }]
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
            block.columns.map((c) => ({
              text: textOf(c.label, 'InterSemiBold'),
              style: 'th',
            })),
            // A bare array would be a stack of paragraphs: wrap the pieces.
            ...block.rows.map((row) =>
              row.map((cell) => {
                const text = textOf(cell, 'Inter')
                return typeof text === 'string' ? text : { text }
              })
            ),
          ],
        },
        layout: 'lightHorizontalLines',
        style: 'table',
      }]
    }
    case 'image':
      return [{
        image: imageNames.get(block.assetKey),
        fit: [block.width, CONTENT_HEIGHT],
        style: 'image',
      }]
    case 'signaturePage':
      return [
        { text: 'Signatures', style: 'h1' },
        ...block.signers.flatMap((signer, i) => {
          const [x, top] = signatureBox(i)
          return [
            {
              text: textOf(signer.label, 'InterSemiBold'),
              style: 'signer',
              absolutePosition: { x, y: top - SIGNER.label },
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
          text: textOf(doc.header.text, 'Inter'),
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
 * `invalid_document` (with the model path, or when the headings before the
 * signature page do not fit above its boxes), `document_too_large` (with the
 * cap), `missing_asset`, `unsupported_image` or `image_too_large` (with the
 * asset key).
 */
export async function renderPdf(
  doc: PdfDocument,
  assets: PdfAssets,
): Promise<RenderedPdf> {
  const check = checkDocument(doc)
  if (!check.ok) {
    throw check.code === 'document_too_large'
      ? new PdfError(
        'document_too_large',
        `document over the ${check.limit} cap`,
      )
      : new PdfError('invalid_document', `invalid document at ${check.path}`)
  }
  const document = check.document
  const { blocks } = document
  configure()

  // Assets are read by own key only, and registered with pdfmake under
  // generated names: pdfkit caches images in a plain object, where a key
  // such as `constructor` would find Object.prototype's.
  const imageNames = new Map<string, string>()
  const images: Record<string, string> = {}
  for (const block of blocks) {
    if (block.type !== 'image' || imageNames.has(block.assetKey)) continue
    const key = block.assetKey
    const name = `image${imageNames.size}`
    images[name] = dataUrl(
      key,
      Object.hasOwn(assets, key) ? assets[key] : undefined,
    )
    imageNames.set(key, name)
  }
  const roles = document.header?.initialsFor ?? []
  const last = blocks[blocks.length - 1]
  const signers = last.type === 'signaturePage' ? last.signers : []
  let pageCount = 0
  /** Where the « Signatures » title ended up (points from the page top). */
  let signaturesTop: number | null = null

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
          {
            width: '*',
            text: textOf(document.footer.text, 'Inter'),
            style: 'chrome',
          },
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
    // pdfmake asks once per node, in order, with every earlier break applied:
    // a BREAK block moves when something is above it on its page; a KEEP
    // heading moves when no block follows it there (and something is above
    // it, or moving would only leave a blank page).
    pageBreakBefore: (node: NodeInfo, nodes: NodeQueries) => {
      const mark = node.headlineLevel ?? 0
      let moves = false
      if (mark & (BREAK | KEEP)) {
        const page = node.startPosition.pageNumber
        moves = nodes.getPreviousNodesOnPage().some((n) => inBody(n, page)) &&
          ((mark & BREAK) !== 0 ||
            !nodes.getFollowingNodesOnPage().some((n) =>
              ((n.headlineLevel ?? 0) & BLOCK) !== 0
            ))
      }
      if (mark & SIGNATURES) {
        signaturesTop = moves ? MARGIN.top : node.startPosition.top
      }
      return moves
    },
    content: placeBlocks(blocks).flatMap(({ block, mark }) => {
      const [first, ...rest] = blockContent(block, imageNames)
      return [{ ...first, headlineLevel: mark }, ...rest]
    }),
  }).getBuffer()

  // The title and the headings moved with it must end above the first label.
  if (
    signaturesTop !== null &&
    signaturesTop + SIGNATURES_TITLE_ROOM > SIGNER.top - SIGNER.label
  ) {
    throw new PdfError(
      'invalid_document',
      'the headings before the signature page do not fit above its boxes',
    )
  }

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
