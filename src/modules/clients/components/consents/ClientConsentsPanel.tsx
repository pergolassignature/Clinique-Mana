import { useState } from 'react'
import { FileText } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useSignedDocumentDownload } from '@/core/signing/use-signed-download'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateShort } from '@/shared/lib/timezone'
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
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { toast } from '@/shared/ui/sonner'
import type { ClientConsentStatus, ConsentType } from '../../api/consents'
import { useCancelConsent, useClientConsents, useConsentTemplates, useConsentTypes, useResendConsent, useSendConsent } from '../../hooks/use-consents'
import { consentSendErrorMessage, consentStateLabel, signedOnText } from '../../lib/consents'

const S = 'modules.clients.consents'
const PENDING_OUTLINE = cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card max-sm:h-11')
const PENDING_GHOST = cn(softDisabledClasses, 'aria-disabled:hover:bg-transparent max-sm:h-11')

/**
 * A client's consents (Clients C5a): per consent of the clinic, its state (signed with the
 * version, « À signer de nouveau », pending with its last send, overdue, withdrawn, not asked),
 * the sealed PDF (one press downloads it), and the actions (`clients.manage`): « Envoyer » (a
 * consent not in force whose text is published: the database checks the client's language), « Renvoyer »,
 * « Annuler la demande ». The record page's « Consentements » tab (C3) mounts it; the list
 * « Consentements à obtenir » opens it in a side sheet. Without the texts (a load error), no
 * « Envoyer » and the reason, never « Texte pas encore publié ».
 */
export function ClientConsentsPanel({ clientId }: { clientId: string }) {
  const types = useConsentTypes()
  const consents = useClientConsents(clientId)
  const templates = useConsentTemplates()
  if (types.isError || consents.isError) {
    return (
      <LoadError
        message={t(`${S}.panelLoadError`)}
        retrying={types.isFetching || consents.isFetching}
        onRetry={() => {
          void types.refetch()
          void consents.refetch()
        }}
      />
    )
  }
  if (!types.data || !consents.data) return <Loading />
  const byKey = new Map(consents.data.status.map((s) => [s.consentKey, s]))
  const texts = templates.data ?? null
  return (
    <div className="space-y-2">
      {templates.isError && !texts && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t(`${S}.templatesError`)}
        </p>
      )}
      <ul className="divide-y divide-border-light">
        {types.data
          .filter((type) => type.isActive)
          .map((type) => (
            <ConsentRow
              key={type.key}
              clientId={clientId}
              type={type}
              status={byKey.get(type.key) ?? null}
              file={consents.data.files[type.key] ?? null}
              published={texts === null ? null : texts.some((tpl) => tpl.consentKey === type.key && tpl.published)}
            />
          ))}
      </ul>
    </div>
  )
}

function ConsentRow({
  clientId,
  type,
  status,
  file,
  published,
}: {
  clientId: string
  type: ConsentType
  status: ClientConsentStatus | null
  file: { fileId: string | null; source: 'app' | 'import' } | null
  /** Null while the texts are not known (loading or failed). */
  published: boolean | null
}) {
  const { can } = useAccess()
  const send = useSendConsent(clientId)
  const resend = useResendConsent(clientId)
  const cancel = useCancelConsent(clientId)
  const [confirming, setConfirming] = useState(false)
  const label = consentStateLabel(status?.state ?? null)
  const open = status?.state === 'pending' || status?.state === 'overdue'
  const busy = send.isPending || resend.isPending || cancel.isPending

  const outcome = (result: { signers: { sent: boolean }[] }) =>
    result.signers.every((s) => s.sent) ? toast.success(t(`${S}.sent`)) : toast.warning(t(`${S}.sentPartly`))
  const doSend = () => send.mutate(type.key, { onSuccess: outcome, onError: (e) => toast.error(consentSendErrorMessage(e)) })
  const doResend = () =>
    status?.requestId && resend.mutate(status.requestId, { onSuccess: outcome, onError: (e) => toast.error(consentSendErrorMessage(e)) })

  let detail: string | null = null
  if (status?.signedAt && !open) detail = file?.source === 'import' ? t(`${S}.imported`) : signedOnText(status.signedAt, status.versionLabel)
  else if (open && status?.lastSentAt) {
    detail = t(`${S}.sentOn`, { date: formatClinicDateShort(status.lastSentAt) })
    if (status.dueAt) detail += `${t(`${S}.separator`)}${t(`${S}.dueOn`, { date: formatClinicDateShort(status.dueAt) })}`
  } else if (!status && published === false) detail = t(`${S}.notPublished`)

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{type.name}</p>
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <StatusDot tone={label.tone} />
          {label.label}
        </p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {file?.fileId && <SignedPdfButton fileId={file.fileId} title={type.name} signedAt={status?.signedAt ?? null} />}
        {can('clients.manage') && open && (
          <>
            <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, doResend)} className={PENDING_OUTLINE}>
              {t(`${S}.resend`)}
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, () => setConfirming(true))} className={PENDING_GHOST}>
              {t(`${S}.cancel`)}
            </Button>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t(`${S}.cancel`)}</AlertDialogTitle>
                  <AlertDialogDescription>{t(`${S}.cancelConfirm`)}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => status?.requestId && !busy && cancel.mutate(status.requestId)}>{t(`${S}.cancel`)}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        {can('clients.manage') && !open && status?.state !== 'signed' && published === true && (
          <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, doSend)} className={PENDING_OUTLINE}>
            {t(`${S}.send`)}
          </Button>
        )}
      </div>
    </li>
  )
}

/** Downloads the sealed PDF in one press (read through a new `storage-sign` URL each time, never cached). */
function SignedPdfButton({ fileId, title, signedAt }: { fileId: string; title: string; signedAt: string | null }) {
  const { download, pendingKind } = useSignedDocumentDownload({ title, completedAt: signedAt, signedFileId: fileId, sourceFileId: null, pageCount: null })
  const busy = pendingKind !== null
  return (
    <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, () => download('sealed'))} className={PENDING_OUTLINE}>
      <FileText aria-hidden />
      {busy ? t('signing.downloads.working') : t(`${S}.openPdf`)}
    </Button>
  )
}
