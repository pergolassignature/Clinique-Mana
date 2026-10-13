import { useState } from 'react'
import { FileText } from 'lucide-react'
import { t } from '@/i18n'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { saveBlob } from '@/shared/lib/files'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import type { Delivery } from '../api/invoices'
import { previewDocument, type DocumentKind } from '../api/queue'

const D = 'modules.billing.invoice.delivery'

/** A stored document's PDF, opened through a signed URL (P3-33); nothing until it is stored. */
export function PdfLink({ fileId, label }: { fileId: string | null; label: string }) {
  const url = useSignedFileUrl(fileId)
  if (!fileId || !url.data) return null
  return (
    <a
      href={url.data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-link underline-offset-[3px] hover:underline"
    >
      <FileText aria-hidden className="size-4" />
      {label}
    </a>
  )
}

/** « Aperçu PDF »: the document rendered now (a draft too), saved by the browser. */
export function PreviewButton({ kind, id }: { kind: DocumentKind; id: string }) {
  const [pending, setPending] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={pending || undefined}
      onClick={() => {
        if (pending) return
        setPending(true)
        previewDocument(kind, id)
          .then(({ blob, filename }) => saveBlob(blob, filename))
          .catch(() => toast.error(t('modules.billing.invoice.previewError')))
          .finally(() => setPending(false))
      }}
    >
      {t('modules.billing.invoice.preview')}
    </Button>
  )
}

/** What happened to a document's last delivery, in plain French (« il faut toujours être clair »). */
export function deliveryText(delivery: Delivery | undefined): string | null {
  if (!delivery) return null
  if (delivery.status === 'pending' || delivery.status === 'sending') return t(`${D}.pending`)
  if (delivery.status === 'failed') return t(`${D}.failed`)
  if (delivery.emailStatus === 'sent') return t(`${D}.sent`, { date: formatClinicDateTime(delivery.finishedAt ?? delivery.createdAt) })
  if (delivery.emailStatus === 'failed') return t(`${D}.emailFailed`)
  return t(`${D}.${delivery.skipReason ?? 'not_requested'}`)
}
