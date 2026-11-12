import { useMemo } from 'react'
import type { MessageHtmlProps } from '@pergolas-signature/email-ui'
import { t } from '@/i18n'
import { useSignedFileUrls } from '@/core/storage/hooks'
import { htmlHasContent } from '../../lib/email-html'
import { inboxMessageOf } from '../../lib/email-ui'
import { MessageHtml } from './MessageHtml'

const V = 'modules.communications.inbox.thread'

/**
 * The kit's `slots.MessageHtml`: one half of a message's body (the reply, or the quoted part), as
 * received. That message's own inline images resolve to signed URLs of their stored copies (two
 * messages may share a Content-ID with different pictures); remote images wait for « Afficher les
 * images » (`MessageHtml`, which sanitizes: the kit hands RAW HTML). A body purged after 24 months,
 * or one that came empty, says so instead.
 */
export function MessageBodySlot({ html, className, message, part }: MessageHtmlProps) {
  const source = inboxMessageOf(message)?.source
  const inline = useMemo(
    () => (source?.attachments ?? []).filter((a) => a.content_id && a.stored_file_id && a.status === 'stored'),
    [source],
  )
  const { urls } = useSignedFileUrls(inline.map((a) => a.stored_file_id as string))
  const inlineImages = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of inline) {
      const url = urls.get(a.stored_file_id as string)
      if (url && a.content_id) map.set(a.content_id, url)
    }
    return map
  }, [inline, urls])

  if (part === 'reply' && source?.body_purged) return <p className="text-sm text-muted-foreground">{t(`${V}.purged`)}</p>
  if (!htmlHasContent(html)) {
    return part === 'reply' ? <p className="text-sm text-muted-foreground">{message.snippet || t(`${V}.noBody`)}</p> : null
  }
  return <MessageHtml html={html} inlineImages={inlineImages} className={className} />
}
