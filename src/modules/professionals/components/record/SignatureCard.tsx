import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { previewErrorMessage, uploadErrorMessage } from '@/core/storage/errors'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { FileDropzone } from '@/shared/components/FileDropzone'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatMegabytes, formatPixels } from '@/shared/lib/files'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { SIGNATURE_PURPOSE } from '../../api/record'
import { useRemoveSignature, useUploadSignature } from '../../hooks/use-professional-mutations'
import { useRecordData } from './record-context'

const S = 'modules.professionals.record.identity.signature'
const PREVIEW_BOX = 'flex h-24 w-48 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card p-2'

/**
 * The signature through its signed read URL (`professionals.manage` reads it); a line without one,
 * or when it cannot be signed or shown (a URL that expired before the browser loaded it asks for a
 * new one once).
 */
function SignaturePreview({ fileId, alt }: { fileId: string | null; alt: string }) {
  const { data, error, refetch } = useSignedFileUrl(fileId)
  const [retriedFor, setRetriedFor] = useState<string | null>(null)
  const [deadUrl, setDeadUrl] = useState<string | null>(null)
  if (fileId === null || (error && !data) || (data && data.url === deadUrl)) {
    return (
      <div className={PREVIEW_BOX}>
        <p className="text-center text-xs text-muted-foreground">{fileId === null ? t(`${S}.empty`) : previewErrorMessage(error)}</p>
      </div>
    )
  }
  if (!data) return <Skeleton className={PREVIEW_BOX} />
  const onError = () => {
    if (retriedFor === fileId) return setDeadUrl(data.url)
    setRetriedFor(fileId)
    void refetch().then((result) => {
      if (result.isError) setDeadUrl(data.url)
    })
  }
  return (
    <div className={PREVIEW_BOX}>
      <img src={data.url} alt={alt} loading="lazy" decoding="async" onError={onError} className="max-h-full max-w-full object-contain" />
    </div>
  )
}

/**
 * « Signature des reçus » (R-86), in « Identité et permis » for `professionals.manage`: the image
 * her receipts print above her name, an upload zone (« Remplacer » once there is one) and
 * « Retirer » after a confirmation. Read-only (the permission lost while open), the preview alone.
 * Focus: after « Retirer » is confirmed it moves to the upload button; cancelled, back to « Retirer ».
 */
export function SignatureCard({ readOnly }: { readOnly: boolean }) {
  const { record } = useRecordData()
  const { id, firstName, lastName, signatureFileId } = record.professional
  const name = `${firstName} ${lastName}`
  const upload = useUploadSignature()
  const remove = useRemoveSignature()
  const uploadButton = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)

  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.title`)} description={t(`${S}.description`)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <SignaturePreview fileId={signatureFileId} alt={t(`${S}.alt`, { name })} />
        {!readOnly && (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <FileDropzone
              className="w-full"
              buttonLabel={signatureFileId === null ? t('storage.dropzone.choose') : t(`${S}.replace`)}
              hint={t(`${S}.hint`, { size: formatMegabytes(SIGNATURE_PURPOSE.maxBytes), side: formatPixels(SIGNATURE_PURPOSE.maxImageSide) })}
              accept={SIGNATURE_PURPOSE.mimeTypes}
              maxBytes={SIGNATURE_PURPOSE.maxBytes}
              maxImageSide={SIGNATURE_PURPOSE.maxImageSide}
              onUpload={async (file, mimeType, onStep) => {
                await upload.mutateAsync({ id, file, mimeType, onStep })
              }}
              errorMessage={uploadErrorMessage}
              buttonRef={uploadButton}
            />
            {signatureFileId !== null && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-disabled={remove.isPending || undefined}
                    className={cn(softDisabledClasses, 'aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground')}
                    onClick={ignoreWhenInactive(remove.isPending, () => {
                      confirmed.current = false
                    })}
                  >
                    {t(`${S}.remove`)}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  onCloseAutoFocus={(event) => {
                    if (!confirmed.current) return
                    event.preventDefault()
                    uploadButton.current?.focus()
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t(`${S}.removeConfirm.title`)}</AlertDialogTitle>
                    <AlertDialogDescription>{t(`${S}.removeConfirm.body`, { name })}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: 'destructive' })}
                      onClick={() => {
                        confirmed.current = true
                        remove.mutate({ id })
                      }}
                    >
                      {t(`${S}.removeConfirm.confirm`)}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
