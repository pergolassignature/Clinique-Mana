import { useMemo, useState } from 'react'
import { prepareEmailHtml, SafeEmailHtml } from '@pergolas-signature/email-render'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { emailSanitizeOptions } from '../../lib/email-html'

const V = 'modules.communications.inbox.thread'

/** Links inside the frame: the app's link blue. */
const LINK_COLOR = '#1d4ed8'
/** A one-line reply stays one line high (the package's default floor is 80 px). */
const MIN_HEIGHT = 40

interface MessageHtmlProps {
  /** The message's HTML as received: the frame sanitizes it, never twice. */
  html: string
  /** `content_id` (without angle brackets) → the attachment's signed URL. */
  inlineImages: ReadonlyMap<string, string>
}

/**
 * A received message's HTML in `@pergolas-signature/email-render`'s sandboxed frame (no scripts,
 * no referrer, links in a new tab and reachable by keyboard, a layout wider than the pane scaled
 * down to fit), its remote images held until « Afficher les images ».
 *
 * The frame gets the **raw** HTML and sanitizes it itself with the same options: sanitized HTML
 * passed in would be sanitized again, and that second pass would hold the inline images the first
 * one had resolved to their signed `https` URL. The count of held images comes from a separate
 * pass over the same raw HTML, only while they are held.
 */
export function MessageHtml({ html, inlineImages }: MessageHtmlProps) {
  const [showImages, setShowImages] = useState(false)
  // A dependency of the frame's own memo: a new object would sanitize again on every render.
  const sanitizeOptions = useMemo(() => emailSanitizeOptions(inlineImages, showImages), [inlineImages, showImages])
  const blockedImages = useMemo(
    () => (showImages ? 0 : prepareEmailHtml(html, sanitizeOptions).blockedImages),
    [html, sanitizeOptions, showImages],
  )

  return (
    <div className="space-y-2">
      {blockedImages > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {t(`${V}.imagesHeld`)}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setShowImages(true)}>
            {t(`${V}.showImages`)}
          </Button>
        </p>
      )}
      <SafeEmailHtml
        html={html}
        title={t('modules.communications.inbox.messageFrame')}
        sanitizeOptions={sanitizeOptions}
        linkColor={LINK_COLOR}
        minHeight={MIN_HEIGHT}
        className="block w-full"
        // In the tab order: a keyboard reaches the links inside the email.
        tabbable
      />
    </div>
  )
}
