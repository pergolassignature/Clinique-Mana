import { t } from '@/i18n'
import { previewErrorMessage } from '@/core/storage/errors'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { Loading } from '@/shared/components/LoadState'
import { softDisabledClasses } from '@/shared/components/soft-disabled'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import type { DocumentFile } from '../../api/documents'
import { useDocumentDownload } from '../../hooks/use-documents'
import { fileSizeLabel, isPreviewable } from '../../lib/documents'
import { useImageRetry } from '../use-image-retry'

const P = 'modules.professionals.documents.preview'

interface DocumentPreviewProps {
  file: DocumentFile
  /** The type's name: the sheet's title. */
  typeName: string
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Aperçu » (Task 4c.3): the file in a sheet, an image or a PDF, through a 5-minute signed URL
 * (`storage-sign`, P3-20, P3-33; the core hook keeps it 240 s at most and drops it 30 s after the
 * sheet closes). An image whose URL has expired asks for a new one once (`useImageRetry`). A Word
 * file is not shown: « Télécharger ». « Télécharger » asks for its own URL at each press.
 */
export function DocumentPreview({ file, typeName, onClose, onCloseAutoFocus }: DocumentPreviewProps) {
  const previewable = isPreviewable(file.mimeType)
  const signed = useSignedFileUrl(previewable ? file.id : null)
  const image = useImageRetry(file.id, signed.data?.url, signed.refetch)
  const download = useDocumentDownload()
  const url = signed.data?.url

  let body
  if (!previewable) body = <p className="text-sm text-muted-foreground">{t(`${P}.notPreviewable`)}</p>
  else if (signed.isPending) body = <Loading />
  else if (!url || image.dead) body = <p className="text-sm text-muted-foreground">{signed.error ? previewErrorMessage(signed.error) : t('storage.preview.unavailable')}</p>
  else if (file.mimeType === 'application/pdf') {
    body = (
      <div className="flex h-full min-h-[60vh] flex-col gap-2">
        <iframe src={url} title={t(`${P}.frameTitle`, { file: file.name })} className="min-h-[60vh] w-full flex-1 rounded-md border border-border" />
        <p className="text-xs text-muted-foreground">{t(`${P}.fallback`)}</p>
      </div>
    )
  } else {
    body = <img src={url} alt={t(`${P}.imageAlt`, { type: typeName })} onError={image.onError} className="mx-auto max-h-[70vh] max-w-full rounded-md border border-border object-contain" />
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-[720px]" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle>{typeName}</SheetTitle>
          <SheetDescription className="break-all">{t(`${P}.description`, { file: file.name, size: fileSizeLabel(file.sizeBytes) })}</SheetDescription>
        </SheetHeader>
        <SheetBody>{body}</SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="outline">
              {t('common.close')}
            </Button>
          </SheetClose>
          <Button
            type="button"
            aria-disabled={download.isPending || undefined}
            className={softDisabledClasses}
            onClick={() => !download.isPending && download.mutate(file.id)}
          >
            {download.isPending ? t('modules.professionals.documents.actions.downloading') : t('modules.professionals.documents.actions.download')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
