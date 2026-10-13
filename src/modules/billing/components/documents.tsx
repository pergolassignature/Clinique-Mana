import { useState } from 'react'
import { FileText } from 'lucide-react'
import { t } from '@/i18n'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { saveBlob } from '@/shared/lib/files'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import { previewDocument, type DocumentKind } from '../api/queue'

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
