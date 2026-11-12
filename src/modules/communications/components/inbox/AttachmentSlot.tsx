import type { AttachmentSlotProps } from '@pergolas-signature/email-ui'
import { Paperclip } from 'lucide-react'
import { t } from '@/i18n'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { cn } from '@/shared/lib/utils'
import { inboxMessageOf } from '../../lib/email-ui'

const V = 'modules.communications.inbox.thread'

/** « 12 ko », « 1,4 Mo ». */
function fileSize(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024 * 1024) return t(`${V}.sizeKb`, { size: String(Math.max(1, Math.round(bytes / 1024))) })
  return t(`${V}.sizeMb`, { size: (bytes / 1024 / 1024).toLocaleString('fr-CA', { maximumFractionDigits: 1 }) })
}

const chip = 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs sm:max-w-[20rem]'

/**
 * The kit's `slots.Attachment`: one file of an open message, as the sync left it. A stored copy
 * opens through a real link to its signed URL (a new tab, the click's own gesture); a copy still
 * being made says « copie en cours »; any other (too large, a type not kept, failed, purged) is
 * « dans Gmail seulement », with the thread in Gmail.
 */
export function AttachmentSlot({ attachment, message }: AttachmentSlotProps) {
  const inbox = inboxMessageOf(message)
  const file = inbox?.source.attachments.find((a) => a.id === attachment.id) ?? null
  const stored = file?.status === 'stored' ? file.stored_file_id : null
  const url = useSignedFileUrl(stored, { refresh: true })
  const name = file?.filename?.trim() || t(`${V}.unnamed`)
  const size = fileSize(file?.size_bytes ?? null)
  if (stored) {
    return url.data ? (
      <a href={url.data.url} target="_blank" rel="noopener noreferrer" className={cn(chip, 'text-link hover:bg-muted/60')}>
        <Paperclip aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{name}</span>
        {size && <span className="tabular shrink-0 text-muted-foreground">{size}</span>}
      </a>
    ) : (
      <span className={cn(chip, 'text-muted-foreground')}>
        <Paperclip aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    )
  }
  const pending = file?.status === 'pending'
  return (
    <span className={cn(chip, 'text-muted-foreground')}>
      <Paperclip aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
      <span className="shrink-0">· {pending ? t(`${V}.attachmentPending`) : t(`${V}.attachmentInGmail`)}</span>
      {!pending && inbox && (
        <a href={inbox.gmailUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-link underline-offset-[3px] hover:underline">
          {t(`${V}.openInGmailShort`)}
        </a>
      )}
    </span>
  )
}
