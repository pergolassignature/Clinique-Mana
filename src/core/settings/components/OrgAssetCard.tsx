import { useRef, useState } from 'react'
import { t } from '@/i18n'
import type { Organization, OrgAssetKind } from '@/core/settings/organization/api'
import { ORG_ASSET_COLUMN, useRemoveOrgAsset, useUploadOrgAsset } from '@/core/settings/organization/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { previewErrorMessage, uploadErrorMessage } from '@/core/storage/errors'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { UPLOAD_PURPOSES } from '@/core/storage/purposes'
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

/** Each image's texts: `settings.identity.logo.*`, `settings.signatory.signature.*`. */
const TEXTS = { logo: 'settings.identity.logo', signature: 'settings.signatory.signature' } as const

const PREVIEW_BOX = 'flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card p-2'

/**
 * The image through its signed read URL; « Aucun logo. » without one, a line when it cannot be
 * signed or shown.
 *
 * - A failed background refetch keeps the image already shown: the error shows only without one.
 * - An image that fails to load (its 5-minute URL expired before the browser loaded it again)
 *   asks for a new URL, once per file; when that fails too, it says so.
 */
function AssetPreview({ fileId, alt, empty }: { fileId: string | null; alt: string; empty: string }) {
  const { data, error, refetch } = useSignedFileUrl(fileId)
  // The file a new URL was asked for, and the URL known not to load.
  const [retriedFor, setRetriedFor] = useState<string | null>(null)
  const [deadUrl, setDeadUrl] = useState<string | null>(null)
  if (fileId === null || (error && !data) || (data && data.url === deadUrl)) {
    return (
      <div className={PREVIEW_BOX}>
        <p className="text-center text-xs text-muted-foreground">{fileId === null ? empty : previewErrorMessage(error)}</p>
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

interface OrgAssetCardProps {
  organization: Organization
  kind: OrgAssetKind
}

/**
 * « Logo » (Identité légale) and « Image de signature » (Signataire): the image, and with the edit
 * permission an upload zone (« Remplacer » once there is one; a drop works too) and « Retirer »
 * after a confirmation. Read-only, the preview alone. An upload makes the new file the clinic's
 * (`set_org_asset`); the previous one is soft-deleted.
 *
 * Focus: after « Retirer » is confirmed it moves to the upload button (« Retirer » is going);
 * cancelled, it returns to « Retirer ».
 */
export function OrgAssetCard({ organization, kind }: OrgAssetCardProps) {
  const texts = TEXTS[kind]
  const { readOnly } = useSettingsSection()
  const fileId = organization[ORG_ASSET_COLUMN[kind]]
  const purpose = UPLOAD_PURPOSES[`org_${kind}`]
  const upload = useUploadOrgAsset(kind, t(`${texts}.saved`))
  const remove = useRemoveOrgAsset(kind, t(`${texts}.removed`))
  const uploadButton = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)

  return (
    <SettingsCard as="section" title={t(`${texts}.title`)} description={t(`${texts}.description`)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <AssetPreview fileId={fileId} alt={t(`${texts}.alt`)} empty={t(`${texts}.empty`)} />
        {!readOnly && (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <FileDropzone
              className="w-full"
              buttonLabel={fileId === null ? t('storage.dropzone.choose') : t(`${texts}.replace`)}
              hint={t(`${texts}.hint`, { size: formatMegabytes(purpose.maxBytes), side: formatPixels(purpose.maxImageSide) })}
              accept={purpose.mimeTypes}
              maxBytes={purpose.maxBytes}
              maxImageSide={purpose.maxImageSide}
              onUpload={async (file, mimeType, onStep) => {
                await upload.mutateAsync({ organizationId: organization.id, file, mimeType, onStep })
              }}
              errorMessage={uploadErrorMessage}
              buttonRef={uploadButton}
            />
            {fileId !== null && (
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
                    {t(`${texts}.remove`)}
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
                    <AlertDialogTitle>{t(`${texts}.removeConfirm.title`)}</AlertDialogTitle>
                    <AlertDialogDescription>{t(`${texts}.removeConfirm.body`)}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: 'destructive' })}
                      onClick={() => {
                        confirmed.current = true
                        remove.mutate()
                      }}
                    >
                      {t(`${texts}.removeConfirm.confirm`)}
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
