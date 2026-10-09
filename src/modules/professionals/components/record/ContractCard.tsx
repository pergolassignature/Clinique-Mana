import { useId, useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { SignedDocumentDownloads } from '@/core/signing/components/SignedDocumentDownloads'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusDot } from '@/shared/ui/status-dot'
import type { ContractAction, ContractRequest, ContractSigner, ProfessionalContract } from '../../api/contracts'
import { useProfessionalContract, useSendContract, useSyncContract } from '../../hooks/use-contracts'
import { contractButtons, contractState, contractStateLabel, signerRoleLabel, type ContractState } from '../../lib/contract'
import { RefusalAlert } from '../compensation/DatedRowParts'
import { useRecordData } from './record-context'

const C = 'modules.professionals.contract'

/**
 * « Contrat de service » (top of Documents, Task 4d.3, A5.1, A10.9): the latest contract's state in
 * words, its dates in the clinic's time, each signer's progress and the template version it was
 * made from, with the actions that state allows (`lib/contract.ts`). Every reader of the record
 * sees the state (`get_professional_contract`, `professionals.view`); only those who may read the
 * contract (`professionals.compensation`: it prints the pay, P4-435) open the signed PDF or
 * synchronise, and only senders (`professionals.contracts.send` with `.compensation`) send.
 */
export function ContractCard() {
  const { record } = useRecordData()
  const { professional } = record
  const contract = useProfessionalContract(professional.id)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t(`${C}.title`)}</CardTitle>
        <CardDescription>{t(`${C}.description`, { firstName: professional.firstName })}</CardDescription>
      </CardHeader>
      <CardContent>
        {contract.isPending ? (
          <Loading />
        ) : contract.data === undefined ? (
          <LoadError
            message={moduleErrorMessage(contract.error, t(`${C}.loadError`), 'professionals')}
            retrying={contract.isFetching}
            onRetry={() => void contract.refetch()}
          />
        ) : contract.data === null ? null : (
          <ContractBody contract={contract.data} />
        )}
      </CardContent>
    </Card>
  )
}

/** « Envoyé le 8 oct. 2026 · Expire le 15 oct. 2026 », by state. */
function datesLine(state: ContractState, request: ContractRequest): string {
  const on = (key: 'prepared' | 'sent' | 'viewed' | 'expires' | 'signed' | 'rejected' | 'expired' | 'cancelled', date: string | null) => (date ? [t(`${C}.dates.${key}`, { date: formatClinicDateShort(date) })] : [])
  switch (state) {
    case 'sent':
      return [...on('sent', request.sentAt), ...on('expires', request.expiresAt)].join(' · ')
    case 'viewed':
      return [...on('sent', request.sentAt), ...on('viewed', request.viewedAt), ...on('expires', request.expiresAt)].join(' · ')
    case 'signed':
      return [...on('sent', request.sentAt), ...on('signed', request.completedAt)].join(' · ')
    case 'rejected':
      return [...on('sent', request.sentAt), ...on('rejected', request.rejectedAt)].join(' · ')
    case 'expired':
      return [...on('sent', request.sentAt), ...on('expired', request.expiredAt)].join(' · ')
    case 'cancelled':
      return [...on('sent', request.sentAt), ...on('cancelled', request.cancelledAt)].join(' · ')
    default:
      return on('prepared', request.createdAt).join(' · ')
  }
}

/** One signer's progress in words: « Signé le … », « Consulté le … », « Refusé le … », « En attente ». */
function signerProgress(signer: ContractSigner): string {
  if (signer.signedAt) return t(`${C}.signer.signed`, { date: formatClinicDateShort(signer.signedAt) })
  if (signer.rejectedAt) return t(`${C}.signer.rejected`, { date: formatClinicDateShort(signer.rejectedAt) })
  if (signer.viewedAt) return t(`${C}.signer.viewed`, { date: formatClinicDateShort(signer.viewedAt) })
  return t(`${C}.signer.pending`)
}

function ContractBody({ contract }: { contract: ProfessionalContract }) {
  const { record } = useRecordData()
  const { professional } = record
  const { can } = useAccess()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ContractAction | null>(null)
  const [journal, setJournal] = useState(false)
  const journalId = useId()
  const opener = useRef<HTMLButtonElement | null>(null)
  const send = useSendContract(professional.id, professional.firstName, { onErrorMessage: (message) => setRefusal(message) })
  const sync = useSyncContract(professional.id)
  const { request } = contract
  // A minute is enough: a send that died shows its retry once its claim is 10 minutes old.
  const now = useNow(60_000)
  const state = contractState(request, now)
  const status = contractStateLabel(request, now)
  const buttons = contractButtons(state, request, can)
  // The signed PDF's downloads (core, P4-500): the contract, the certificate and journal, the sealed proof.
  const signedFiles = buttons.some((b) => b.kind === 'pdf') && request?.signedFileId ? request : null
  const sends = buttons.some((b) => b.kind === 'action')
  const noTemplate = sends && contract.publishedVersion === null
  const pending = send.isPending || sync.isPending
  // « Renvoyer » writes to the next signer: the clinic once the professional has signed.
  const next = request?.signers.find((s) => s.signedAt === null && s.rejectedAt === null)
  const recipientOf = (action: ContractAction) => (action === 'resend' && next && next.role !== 'professional' ? next.name : professional.firstName)

  const confirm = (action: ContractAction) => {
    setRefusal(null)
    setConfirming(action)
  }
  const run = () => {
    if (confirming === null) return
    const action = confirming
    send.run(action, recipientOf(action))
    setConfirming(null)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <StatusDot tone={status.tone} />
            {status.label}
          </span>
          {request?.templateVersion != null && (
            <span className="text-xs text-muted-foreground">{t(`${C}.version`, { version: String(request.templateVersion) })}</span>
          )}
        </p>
        {request === null ? (
          <p className="text-xs text-muted-foreground">{t(`${C}.none`, { firstName: professional.firstName })}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{datesLine(state, request)}</p>
        )}
        {status.detail && <p className="text-xs text-muted-foreground">{status.detail}</p>}
        {state === 'rejected' && request?.rejectionReason && (
          <p className="mt-1 whitespace-pre-line border-l-2 border-border pl-2 text-sm text-foreground">
            <span className="text-muted-foreground">{t(`${C}.reason`)} </span>
            {request.rejectionReason}
          </p>
        )}
      </div>

      {request !== null && request.signers.length > 0 && state !== 'none' && (
        <ul aria-label={t(`${C}.signersLabel`)} className="divide-y divide-border-light border-y border-border-light text-sm">
          {request.signers.map((signer) => (
            <li key={signer.order} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="min-w-0">
                <span className="text-muted-foreground">{signerRoleLabel(signer.role)} · </span>
                <span className="font-medium text-foreground">{signer.name}</span>
              </span>
              <span className="text-xs text-muted-foreground">{signerProgress(signer)}</span>
            </li>
          ))}
        </ul>
      )}

      {noTemplate && (
        <p className="text-sm text-muted-foreground">
          {t(`${C}.noTemplate`)}{' '}
          {can('professionals.manage') || can('professionals.settings') ? (
            <GuardedNavLink to={`${SETTINGS_BASE_PATH}/contrats`} className="text-link underline-offset-[3px] hover:underline">
              {t(`${C}.noTemplateLink`)}
            </GuardedNavLink>
          ) : null}
        </p>
      )}
      {sends && !noTemplate && state === 'none' && !contract.clinicSigner && <p className="text-xs text-muted-foreground">{t(`${C}.noClinicSigner`)}</p>}
      {state === 'signed' && !request?.canRead && <p className="text-xs text-muted-foreground">{t(`${C}.restricted`)}</p>}
      {state === 'failed' && sends && <p className="text-xs text-muted-foreground">{t(`${C}.failedHelp`)}</p>}

      {refusal && <RefusalAlert message={refusal} />}

      {journal && request && (
        <div id={journalId} className="rounded-md border border-border-light p-3">
          <p className="mb-1 text-xs font-medium text-foreground">{t(`${C}.journal.title`)}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {request.sentAt && <li>{t(`${C}.journal.sent`, { date: formatClinicDateShort(request.sentAt) })}</li>}
            {request.signers.flatMap((s) => [
              ...(s.viewedAt ? [<li key={`${s.order}v`}>{t(`${C}.journal.viewed`, { name: s.name, date: formatClinicDateShort(s.viewedAt) })}</li>] : []),
              ...(s.signedAt ? [<li key={`${s.order}s`}>{t(`${C}.journal.signed`, { name: s.name, date: formatClinicDateShort(s.signedAt) })}</li>] : []),
            ])}
            {request.completedAt && <li>{t(`${C}.journal.completed`, { date: formatClinicDateShort(request.completedAt) })}</li>}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t(`${C}.journal.pdfNote`)}</p>
        </div>
      )}

      {signedFiles && (
        <SignedDocumentDownloads
          key={signedFiles.signedFileId}
          files={{
            title: signedFiles.title,
            completedAt: signedFiles.completedAt,
            signedFileId: signedFiles.signedFileId!,
            sourceFileId: signedFiles.sourceFileId,
            pageCount: signedFiles.pageCount,
          }}
          documentLabel={t(`${C}.actions.pdf`)}
          documentAriaLabel={t(`${C}.actions.pdfLabel`, { firstName: professional.firstName })}
        />
      )}

      {(buttons.some((b) => b.kind !== 'pdf') || state === 'signed') && (
        <div className="flex flex-wrap gap-2">
          {buttons.map((button) => {
            if (button.kind === 'pdf') return null
            if (button.kind === 'sync') {
              return (
                <Button
                  key="sync"
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-disabled={pending || undefined}
                  className={cn(softDisabledClasses)}
                  onClick={ignoreWhenInactive(pending, () => sync.mutate(request!.id))}
                >
                  {sync.isPending ? t(`${C}.actions.syncing`) : t(`${C}.actions.sync`)}
                </Button>
              )
            }
            const primary = button.action === 'send'
            const unavailable = noTemplate && button.action !== 'resend'
            return (
              <Button
                key={button.action}
                type="button"
                size="sm"
                variant={primary ? 'default' : 'outline'}
                aria-disabled={pending || unavailable || undefined}
                className={cn(softDisabledClasses)}
                onClick={(event) => {
                  if (pending || unavailable) return event.preventDefault()
                  opener.current = event.currentTarget
                  confirm(button.action)
                }}
              >
                {send.pendingAction === button.action ? t(`${C}.actions.working`) : button.label}
              </Button>
            )
          })}
          {state === 'signed' && request && (
            <Button type="button" size="sm" variant="outline" aria-expanded={journal} aria-controls={journal ? journalId : undefined} onClick={() => setJournal((open) => !open)}>
              {journal ? t(`${C}.actions.hideJournal`) : t(`${C}.actions.journal`)}
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        >
          {confirming !== null && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`${C}.confirm.${confirming}.title`, { firstName: recipientOf(confirming) })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(`${C}.confirm.${confirming}.body`, {
                    firstName: recipientOf(confirming),
                    version: String(contract.publishedVersion ?? ''),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <Button type="button" onClick={run}>
                  {t(`${C}.confirm.${confirming}.action`)}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
