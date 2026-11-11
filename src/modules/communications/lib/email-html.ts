import type { SanitizeOptions } from '@pergolas-signature/email-render'

/*
 * A received email's HTML is sanitized and rendered by `@pergolas-signature/email-render` (shared
 * with PS Hub, pinned in package.json, upgraded by a deliberate PR). What stays here is the
 * clinic's own reading choices, as that package's options:
 * - inline images (`cid:`) point at the attachment's signed URL from our storage (never a public
 *   bucket); an inline image not copied shows nothing;
 * - **remote images are held back** until the person asks (« Afficher les images »): a remote
 *   image tells its sender that the clinic opened the email, and from where (trackers);
 * - no inline style may fetch from outside (`url(…)`, `image-set(…)`, escapes…), even once the
 *   images are shown: a CSS fetch is not the image the person asked for;
 * - a fixed width up to 800 px is kept (the reading pane is wide), wider is dropped.
 */

/** The widest inline `width` / `min-width` kept as written. */
const MAX_INLINE_WIDTH_PX = 800

/** The package's options for one message: its `cid:` images resolved, its remote images held or shown. */
export function emailSanitizeOptions(inlineImages: ReadonlyMap<string, string>, showRemoteImages: boolean): SanitizeOptions {
  // No prototype: a `cid:` is the sender's text, and `cid:constructor` must find nothing.
  const resolved: Record<string, string> = Object.create(null)
  for (const [contentId, url] of inlineImages) resolved[contentId] = url
  return {
    inlineImages: resolved,
    remoteImages: showRemoteImages ? 'show' : 'hold',
    styleFetch: 'block',
    maxInlineWidthPx: MAX_INLINE_WIDTH_PX,
  }
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
