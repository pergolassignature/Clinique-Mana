import { useRef, useState } from 'react'
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
import { FormField } from '@/shared/ui/form-field'
import { StatusDot } from '@/shared/ui/status-dot'
import { toast } from '@/shared/ui/sonner'
import { Textarea } from '@/shared/ui/textarea'
import type { ClientConsentStatus, ConsentType } from '../../api/consents'
import {
  useCancelConsent,
  useClientConsents,
  useConsentTemplates,
  useConsentTypes,
  useResendConsent,
  useSendConsent,
  useSendConsentCopy,
  useWithdrawConsent,
} from '../../hooks/use-consents'
import { consentSendErrorMessage, consentStateLabel, signedOnText } from '../../lib/consents'

const S = 'modules.clients.consents'
const PENDING_OUTLINE = cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card max-sm:h-11')
const PENDING_GHOST = cn(softDisabledClasses, 'aria-disabled:hover:bg-transparent max-sm:h-11')

/**
 * A client's consents (Clients C5a, C5b): per consent of the clinic, its state (signed with the
 * version, « À signer de nouveau », pending with its last send, overdue, « Retiré le … », not
 * asked), the sealed PDF (one press downloads it), and the actions (`clients.manage`): « Envoyer »
 * (a consent not in force whose text is published: the database checks the client's language),
 * « Renvoyer », « Annuler la demande », « Retirer le consentement » (a note, CC-16) and « Envoyer
 * la copie signée » (the sealed PDF by email, CC-17). The record page's « Consentements » tab (C3)
 * mounts it; the list « Consentements à obtenir » opens it in a side sheet. Without the texts (a
 * load error), no « Envoyer » and the reason, never « Texte pas encore publié ».
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
  const byKey = new Map(consents.data.map((s) => [s.consentKey, s]))
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
              published={texts === null ? null : texts.some((tpl) => tpl.consentKey === type.key && tpl.published)}
            />
          ))}
      </ul>
    </div>
  )
}

/** The lines under a consent's state: when it was signed, withdrawn, sent; its copy. */
function detailLines(status: ClientConsentStatus | null, open: boolean, published: boolean | null): string[] {
  if (!status) return published === false ? [t(`${S}.notPublished`)] : []
  const lines: string[] = []
  if (open && status.lastSentAt) {
    let line = t(`${S}.sentOn`, { date: formatClinicDateShort(status.lastSentAt) })
    if (status.dueAt) line += `${t(`${S}.separator`)}${t(`${S}.dueOn`, { date: formatClinicDateShort(status.dueAt) })}`
    lines.push(line)
  } else if (status.signedAt) {
    lines.push(status.source === 'import' ? t(`${S}.imported`) : signedOnText(status.signedAt, status.versionLabel))
  }
  if (status.withdrawnAt) lines.push(t(`${S}.withdrawnOn`, { date: formatClinicDateShort(status.withdrawnAt) }))
  if (status.copySentAt) lines.push(t(`${S}.copySentOn`, { date: formatClinicDateShort(status.copySentAt) }))
  return lines
}

function ConsentRow({
  clientId,
  type,
  status,
  published,
}: {
  clientId: string
  type: ConsentType
  status: ClientConsentStatus | null
  /** Null while the texts are not known (loading or failed). */
  published: boolean | null
}) {
  const { can } = useAccess()
  const send = useSendConsent(clientId)
  const resend = useResendConsent(clientId)
  const cancel = useCancelConsent(clientId)
  const [dialog, setDialog] = useState<'cancel' | 'withdraw' | 'copy' | null>(null)
  const label = consentStateLabel(status?.state ?? null)
  const open = status?.state === 'pending' || status?.state === 'overdue'
  const busy = send.isPending || resend.isPending || cancel.isPending
  const manage = can('clients.manage')

  const outcome = (result: { signers: { sent: boolean }[] }) =>
    result.signers.every((s) => s.sent) ? toast.success(t(`${S}.sent`)) : toast.warning(t(`${S}.sentPartly`))
  const doSend = () => send.mutate(type.key, { onSuccess: outcome, onError: (e) => toast.error(consentSendErrorMessage(e)) })
  const doResend = () =>
    status?.requestId && resend.mutate(status.requestId, { onSuccess: outcome, onError: (e) => toast.error(consentSendErrorMessage(e)) })

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{type.name}</p>
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <StatusDot tone={label.tone} />
          {label.label}
        </p>
        {detailLines(status, open, published).map((line) => (
          <p key={line} className="text-xs text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {status?.fileId && <SignedPdfButton fileId={status.fileId} title={type.name} signedAt={status.signedAt} />}
        {manage && status?.fileId && status.consentId && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog('copy')} className="max-sm:h-11">
            {t(`${S}.copy.action`)}
          </Button>
        )}
        {manage && open && (
          <>
            <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, doResend)} className={PENDING_OUTLINE}>
              {t(`${S}.resend`)}
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, () => setDialog('cancel'))} className={PENDING_GHOST}>
              {t(`${S}.cancel`)}
            </Button>
            <AlertDialog open={dialog === 'cancel'} onOpenChange={(next) => !next && setDialog(null)}>
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
        {manage && !open && status?.state !== 'signed' && published === true && (
          <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, doSend)} className={PENDING_OUTLINE}>
            {t(`${S}.send`)}
          </Button>
        )}
        {manage && status?.inForce && status.consentId && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDialog('withdraw')} className="max-sm:h-11">
            {t(`${S}.withdraw.action`)}
          </Button>
        )}
      </div>
      {dialog === 'withdraw' && status?.consentId && (
        <WithdrawDialog clientId={clientId} consentId={status.consentId} name={type.name} onClose={() => setDialog(null)} />
      )}
      {dialog === 'copy' && status?.consentId && (
        <CopyDialog clientId={clientId} consentId={status.consentId} name={type.name} onClose={() => setDialog(null)} />
      )}
    </li>
  )
}

/** « Retirer le consentement »: the note (3 to 500 characters), then the database's answer where the person acted. */
function WithdrawDialog({ clientId, consentId, name, onClose }: { clientId: string; consentId: string; name: string; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const withdraw = useWithdrawConsent(clientId, { onErrorMessage: setRefusal })
  const pending = withdraw.isPending

  const confirm = () => {
    setFieldError(null)
    setRefusal(null)
    const text = note.trim()
    const problem = text.length < 3 ? t(`${S}.withdraw.noteRequired`) : text.length > 500 ? t(`${S}.withdraw.noteTooLong`) : null
    if (problem) {
      setFieldError(problem)
      field.current?.focus()
      return
    }
    withdraw.mutate({ consentId, note: text }, { onSuccess: onClose })
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <AlertDialogContent
        aria-busy={pending || undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          field.current?.focus()
        }}
      >
        <form
          noValidate
          className="grid gap-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending) confirm()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${S}.withdraw.title`, { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${S}.withdraw.description`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <FormField label={t(`${S}.withdraw.note`)} help={t(`${S}.withdraw.noteHelp`)} required error={fieldError ?? undefined}>
            {(props) => <Textarea {...props} ref={field} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} />}
          </FormField>
          {refusal && (
            <p role="alert" className="text-sm text-destructive">
              {refusal}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" aria-disabled={pending || undefined} onClick={ignoreWhenInactive(pending)} className={softDisabledClasses}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
            >
              {pending ? t(`${S}.withdraw.pending`) : t(`${S}.withdraw.confirm`)}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** « Envoyer la copie signée »: confirmed first (it emails a client), then one toast with the outcome. */
function CopyDialog({ clientId, consentId, name, onClose }: { clientId: string; consentId: string; name: string; onClose: () => void }) {
  const copy = useSendConsentCopy(clientId)
  const pending = copy.isPending
  const doCopy = () =>
    copy.mutate(consentId, {
      onSuccess: (result) => {
        const sent = result.recipients.filter((r) => r.sent).length
        if (sent === result.recipients.length) toast.success(t(`${S}.copy.sent`))
        else if (sent > 0) toast.warning(t(`${S}.copy.sentPartly`))
        else toast.error(t(`${S}.copy.notSent`))
        onClose()
      },
      onError: (error) => {
        toast.error(consentSendErrorMessage(error, t(`${S}.copy.error`)))
        onClose()
      },
    })
  return (
    <AlertDialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <AlertDialogContent aria-busy={pending || undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${S}.copy.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${S}.copy.description`, { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel aria-disabled={pending || undefined} onClick={ignoreWhenInactive(pending)} className={softDisabledClasses}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <Button
            type="button"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, doCopy)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}
          >
            {pending ? t(`${S}.copy.pending`) : t(`${S}.copy.confirm`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
