import DOMPurify from 'dompurify'

/*
 * A received email's HTML, made safe to show (CM2; PS Hub's flaws fixed, roadmap §2.4 bis):
 * - DOMPurify with a strict allowlist: no script, style sheet, form, frame, object or event
 *   attribute; links open in a new tab (`rel="noopener noreferrer"`);
 * - inline images (`cid:`) point at the attachment's signed URL from our storage (never a public
 *   bucket); an inline image not copied shows nothing;
 * - **remote images are held back** until the person asks (« Afficher les images »): a remote
 *   image tells its sender that the clinic opened the email, and from where (trackers);
 * - inline styles keep what does not break the host: no `position` overlays, no huge fonts or
 *   fixed widths.
 * The result is rendered in a sandboxed iframe without scripts (`SafeEmailHtml`).
 */

const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'mark', 'ol',
  'p', 'pre', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul',
]

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'style', 'width', 'height', 'align', 'valign', 'bgcolor', 'color', 'face', 'size',
  'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'dir', 'lang', 'target', 'rel',
]

/**
 * What may load something from outside in a style (a remote image tells the sender the mail was
 * opened): any function that takes an address or an image, and the escapes and comments that
 * could spell one (`\75rl(` is `url(`). The declaration is dropped whole.
 */
const STYLE_FETCH = /\\|\/\*|url\s*\(|expression\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|src\s*\(/
/** Properties whose only job is an image or an outside resource. */
const STYLE_IMAGE_PROPS = /^(?:background-image|list-style-image|border-image(?:-source)?|content|cursor|mask(?:-image)?|-webkit-mask(?:-image)?|-webkit-border-image|filter|behavior|-moz-binding)$/

/** Styles that would escape the message, drown the page or fetch from outside. */
function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const [rawProp, ...rest] = declaration.split(':')
      if (!rawProp || rest.length === 0) return false
      const prop = rawProp.trim().toLowerCase()
      const value = rest.join(':').trim().toLowerCase()
      if (STYLE_FETCH.test(declaration.toLowerCase()) || STYLE_IMAGE_PROPS.test(prop)) return false
      if (prop === 'position' && /fixed|absolute|sticky/.test(value)) return false
      if (prop === 'z-index') return false
      if (prop === 'font-size') {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (px && Number(px[1]) > 32) return false
      }
      if (prop === 'width' || prop === 'min-width') {
        const px = /^(\d+)px$/.exec(value)
        if (px && Number(px[1]) > 800) return false
        const pct = /^(\d+(?:\.\d+)?)%$/.exec(value)
        if (pct && Number(pct[1]) > 100) return false
        if (/\dv[wh]$/.test(value)) return false
      }
      return true
    })
    .join('; ')
}

export interface PreparedHtml {
  html: string
  /** Remote images were held back: « Afficher les images » would show them. */
  blockedImages: number
}

export interface PrepareOptions {
  /** `content_id` (without angle brackets) → the attachment's signed URL. */
  inlineImages: ReadonlyMap<string, string>
  /** Show remote images (the person asked). */
  showRemoteImages: boolean
}

/** The sanitized HTML of a message, its `cid:` images resolved and its remote images held back. */
export function prepareEmailHtml(raw: string, { inlineImages, showRemoteImages }: PrepareOptions): PreparedHtml {
  let blockedImages = 0
  const purify = DOMPurify()
  // A browser too old for DOMPurify gets the text only, escaped: never unsanitized HTML.
  if (!purify.isSupported) {
    const text = raw.replace(/<[^>]*>/g, ' ').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    return { html: `<p>${text}</p>`, blockedImages: 0 }
  }
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('style')) {
      const cleaned = cleanStyle(node.getAttribute('style') ?? '')
      if (cleaned) node.setAttribute('style', cleaned)
      else node.removeAttribute('style')
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? ''
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      } else {
        node.removeAttribute('href')
      }
    }
    if (node.tagName === 'IMG') {
      const src = (node.getAttribute('src') ?? '').trim()
      if (/^cid:/i.test(src)) {
        const id = src.slice(4).replace(/^<|>$/g, '')
        const url = inlineImages.get(id)
        if (url) node.setAttribute('src', url)
        else node.remove()
      } else if (/^https?:/i.test(src)) {
        if (!showRemoteImages) {
          blockedImages++
          node.removeAttribute('src')
          node.setAttribute('data-blocked', '')
          if (!node.getAttribute('alt')) node.setAttribute('alt', '')
        }
      } else if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) {
        node.remove()
      }
    }
  })
  const html = purify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-blocked'],
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|cid:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
  })
  return { html, blockedImages }
}

/** Whether HTML shows anything (an empty `<body>` shell falls back to the text part). */
export function htmlHasContent(html: string | null | undefined): boolean {
  if (!html) return false
  if (/<img\b/i.test(html)) return true
  return (
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&[a-z0-9#]+;/gi, 'x')
      .replace(/\s+/g, '')
      .length > 0
  )
}
