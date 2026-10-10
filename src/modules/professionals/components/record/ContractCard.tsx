import { useId, useRef, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { SignedDocumentDownloads } from '@/core/signing/components/SignedDocumentDownloads'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateShort, formatDateOnlyShort } from '@/shared/lib/timezone'
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
import type { ContractAction, ContractInForce, ContractRequest, ContractSigner, PaperContract, ProfessionalContract, SigningForm } from '../../api/contracts'
import { formTextRoot, useProfessionalContract, useSendContract, useSyncContract } from '../../hooks/use-contracts'
import { useDocumentDownload } from '../../hooks/use-documents'
import { canSendForm, contractButtons, contractState, contractStateLabel, signerRoleLabel, type ContractState } from '../../lib/contract'
import { RefusalAlert } from '../compensation/DatedRowParts'
import { DocumentPreview } from './DocumentPreview'
import { PaperContractDialog } from './PaperContractDialog'
import { useRecordData } from './record-context'
import { SigningPreviewDialog, type PreviewSource } from './SigningPreviewDialog'

const C = 'modules.professionals.contract'

/**
 * « Contrat de service » (top of Documents, Task 4d.3, A5.1, A10.9): the latest contract's state in
 * words, its dates in the clinic's time, each signer's progress and the template version it was
 * made from, with the actions that state allows (`lib/contract.ts`). Every reader of the record
 * sees the state (`get_professional_contract`, `professionals.view`); only those who may read the
 * contract (`professionals.compensation`: it prints the pay, P4-435) open the signed PDF or
 * synchronise, and only senders (`professionals.contracts.send` with `.compensation`) send.
 *
 * Once a contract is in force (P4-522: signed through Documenso, or on paper and uploaded, P4-520)
 * the card shows it first (« Contrat en vigueur »), then the request at work under « Nouveau
 * contrat » (a renewal, P4-524: the signed one stays in force until the new one is signed), then
 * « Contrats précédents » (P4-523), each with its PDF for compensation readers. The paper contract
 * is staff-only: « Mes documents » never shows a contract (P4-527).
 */
export function ContractCard() {
  const { record } = useRecordData()
  const { professional } = record
  const contract = useProfessionalContract(professional.id)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h4">{t(`${C}.title`)}</CardTitle>
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
          <ServiceContractBody contract={contract.data} />
        )}
      </CardContent>
    </Card>
  )
}

/** States in which nothing is at work: a paper contract may be recorded (P4-521). */
const SETTLED: readonly ContractState[] = ['none', 'rejected', 'expired', 'cancelled', 'abandoned']

/** The service contract: the contract in force, the request at work, the previous contracts (P4-525). */
function ServiceContractBody({ contract }: { contract: ProfessionalContract }) {
  const { record } = useRecordData()
  const { professional } = record
  const { can } = useAccess()
  const now = useNow(60_000)
  const [paperDialog, setPaperDialog] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const inForceId = useId()
  const renewalId = useId()
  const { current, previous, request } = contract
  const sender = canSendForm('service_contract', can)
  // « Téléverser un contrat signé » when nothing is in force, « Remplacer » a paper one; never while
  // a contract is being sent or waits for a signature (one live contract, P4-521).
  const paperAction =
    sender && SETTLED.includes(contractState(request, now)) && (current === null || current.kind === 'paper') ? (current === null ? 'upload' : 'replace') : null
  const paperButton = paperAction && (
    <Button
      type="button"
      variant="outline"
      aria-label={paperAction === 'replace' ? t(`${C}.actions.replacePaperLabel`, { firstName: professional.firstName }) : undefined}
      onClick={(event) => {
        opener.current = event.currentTarget
        setPaperDialog(true)
      }}
    >
      {paperAction === 'upload' ? t(`${C}.actions.uploadPaper`) : t(`${C}.actions.replacePaper`)}
    </Button>
  )

  return (
    <div className="space-y-5">
      {current === null ? (
        <SigningBody form="service_contract" contract={contract} extraActions={paperButton} />
      ) : (
        <>
          <section aria-labelledby={inForceId} className="space-y-2">
            <h5 id={inForceId} className="text-sm font-semibold text-foreground">
              {t(`${C}.inForce.title`)}
            </h5>
            {current.kind === 'signed' ? <SigningBody form="service_contract" contract={{ ...contract, request: current.request }} /> : <PaperContractView paper={current} />}
          </section>
          {(request !== null || sender) && (
            <section aria-labelledby={request !== null ? renewalId : undefined} className="space-y-2 border-t border-border-light pt-4">
              {request !== null && (
                <>
                  <h5 id={renewalId} className="text-sm font-semibold text-foreground">
                    {t(`${C}.renewal.title`)}
                  </h5>
                  <p className="text-xs text-muted-foreground">{t(`${C}.renewal.help`)}</p>
                </>
              )}
              <SigningBody form="service_contract" contract={contract} inForce extraActions={paperButton} />
            </section>
          )}
        </>
      )}
      {previous.length > 0 && <PreviousContracts previous={previous} />}
      {paperDialog && (
        <PaperContractDialog
          professionalId={professional.id}
          firstName={professional.firstName}
          replace={current?.kind === 'paper'}
          onClose={() => setPaperDialog(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        />
      )}
    </div>
  )
}

/**
 * A paper contract (P4-520): « Signé hors application le … » (a calendar date), who uploaded it
 * and when, then « Aperçu » and « Télécharger » for compensation readers (a URL signed at each
 * press, P4-455); the others read why not.
 */
function PaperContractView({ paper, compact = false }: { paper: PaperContract; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const download = useDocumentDownload()
  const date = formatDateOnlyShort(paper.signedOn)
  const uploaded = formatClinicDateShort(paper.uploadedAt)
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          {!compact && <StatusDot tone="success" />}
          {t(compact ? `${C}.previous.paper` : `${C}.inForce.paper`, { date })}
        </p>
        <p className="text-xs text-muted-foreground">
          {paper.uploadedByName ? t(`${C}.inForce.uploaded`, { date: uploaded, name: paper.uploadedByName }) : t(`${C}.inForce.uploadedNoName`, { date: uploaded })}
        </p>
      </div>
      {paper.file ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t(`${C}.actions.openPaperLabel`, { date })}
            onClick={(event) => {
              opener.current = event.currentTarget
              setOpen(true)
            }}
          >
            {t(`${C}.actions.openPaper`)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t(`${C}.actions.downloadPaperLabel`, { date })}
            aria-disabled={download.isPending || undefined}
            className={softDisabledClasses}
            onClick={ignoreWhenInactive(download.isPending, () => download.mutate(paper.file!.id))}
          >
            {t(`${C}.actions.downloadPaper`)}
          </Button>
        </div>
      ) : (
        !paper.canRead && <p className="text-xs text-muted-foreground">{t(`${C}.restricted`)}</p>
      )}
      {open && paper.file && (
        <DocumentPreview
          file={paper.file}
          typeName={t(`${C}.inForce.paperDocument`)}
          onClose={() => setOpen(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        />
      )}
    </div>
  )
}

/** « Contrats précédents (n) » (P4-523): folded; each earlier contract with its PDF, never deleted. */
function PreviousContracts({ previous }: { previous: readonly ContractInForce[] }) {
  const { record } = useRecordData()
  const [open, setOpen] = useState(false)
  const listId = useId()
  return (
    <div className="space-y-2 border-t border-border-light pt-4">
      <Button type="button" size="sm" variant="ghost" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((value) => !value)}>
        {open ? t(`${C}.previous.hide`) : t(`${C}.previous.show`, { count: String(previous.length) })}
      </Button>
      {open && (
        <ul id={listId} aria-label={t(`${C}.previous.label`)} className="divide-y divide-border-light border-y border-border-light">
          {previous.map((entry) => (
            <li key={entry.kind === 'signed' ? entry.request.id : entry.id} className="space-y-2 py-3">
              {entry.kind === 'paper' ? (
                <PaperContractView paper={entry} compact />
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">
                    {t(`${C}.previous.signed`, { date: entry.request.completedAt ? formatClinicDateShort(entry.request.completedAt) : '' })}
                    {entry.request.templateVersion != null && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`${C}.version`, { version: String(entry.request.templateVersion) })}</span>
                    )}
                  </p>
                  {entry.request.canRead && entry.request.signedFileId ? (
                    <SignedDocumentDownloads
                      key={entry.request.signedFileId}
                      files={{
                        title: entry.request.title,
                        completedAt: entry.request.completedAt,
                        signedFileId: entry.request.signedFileId,
                        sourceFileId: entry.request.sourceFileId,
                        pageCount: entry.request.pageCount,
                      }}
                      documentLabel={t(`${C}.actions.pdf`)}
                      documentAriaLabel={t(`${C}.actions.pdfLabel`, { firstName: record.professional.firstName })}
                    />
                  ) : (
                    !entry.request.canRead && <p className="text-xs text-muted-foreground">{t(`${C}.restricted`)}</p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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

/**
 * A form's signing state and actions (the contract's card; the image consent's part of its
 * required-document card, P4-485): the words come from the form's own root (`formTextRoot`) where
 * they name the document, from the contract's where they do not.
 */
export function SigningBody({
  form,
  contract,
  inForce = false,
  extraActions = null,
}: {
  form: SigningForm
  contract: ProfessionalContract
  /** The service contract has a contract in force: `request` is a renewal, or null (« Préparer un nouveau contrat », P4-524). */
  inForce?: boolean
  /** More buttons in the actions' row (« Téléverser un contrat signé », « Remplacer », P4-521). */
  extraActions?: ReactNode
}) {
  const { record } = useRecordData()
  const { professional } = record
  const { can } = useAccess()
  const F = formTextRoot(form)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ContractAction | null>(null)
  // P4-502: « Préparer le contrat », « Régénérer » and « Voir le contrat envoyé » open the PDF first.
  const [preview, setPreview] = useState<PreviewSource | null>(null)
  const [journal, setJournal] = useState(false)
  const journalId = useId()
  const opener = useRef<HTMLButtonElement | null>(null)
  const send = useSendContract(professional.id, professional.firstName, { onErrorMessage: (message) => setRefusal(message) }, form)
  const sync = useSyncContract(professional.id)
  const { request } = contract
  // A minute is enough: a send that died shows its retry once its claim is 10 minutes old.
  const now = useNow(60_000)
  const state = contractState(request, now)
  const status = contractStateLabel(request, now, form)
  const buttons = contractButtons(state, request, can, form, inForce)
  // A contract in force and nothing at work: no state to tell, only « Préparer un nouveau contrat ».
  const idle = inForce && request === null
  // The confirmation's words; the image consent's renewal after a signature has its own.
  const confirmText = (action: ContractAction, part: 'title' | 'body' | 'action', values?: Record<string, string>) =>
    form === 'image_consent'
      ? t(`modules.professionals.imageConsent.confirm.${state === 'signed' || action === 'renew' ? 'renew' : action}.${part}`, values)
      : t(`${C}.confirm.${action}.${part}`, values)
  // The signed PDF's downloads (core, P4-500): the document, the certificate and journal, the sealed
  // proof; the image consent's once signed and readable (its renewal is the card's action).
  const signedFiles =
    request?.signedFileId && (buttons.some((b) => b.kind === 'pdf') || (form === 'image_consent' && state === 'signed' && request.canRead)) ? request : null
  const sends = buttons.some((b) => b.kind === 'action')
  const noTemplate = sends && contract.publishedVersion === null
  const pending = send.isPending || sync.isPending
  // « Renvoyer » writes to the next signer: the clinic once the professional has signed.
  const next = request?.signers.find((s) => s.signedAt === null && s.rejectedAt === null)
  const recipientOf = (action: ContractAction) => (action === 'resend' && next && next.role !== 'professional' ? next.name : professional.firstName)

  const confirm = (action: ContractAction) => {
    setRefusal(null)
    // « Renvoyer » sends at once; « Préparer un nouveau contrat » says first that the signed one stays (P4-524).
    if (action === 'resend' || action === 'renew') setConfirming(action)
    else setPreview({ kind: 'prepare', action, key: send.previewKey(action) })
  }
  const closePreview = () => {
    if (preview?.kind === 'prepare') send.releaseKey(preview.action)
    setPreview(null)
  }
  const sendPreviewed = () => {
    if (preview?.kind !== 'prepare') return
    send.run(preview.action, recipientOf(preview.action))
    setPreview(null)
  }
  // « Voir le contrat envoyé »: the source PDF the send stored, while it waits for signatures, for
  // its readers only (the request's view permission; storage-sign decides again).
  const sentSource =
    (state === 'sent' || state === 'viewed') && request?.canRead && request.sourceFileId
      ? { fileId: request.sourceFileId, pageCount: request.pageCount, signers: request.signers }
      : null
  const run = () => {
    if (confirming === null) return
    const action = confirming
    setConfirming(null)
    if (action === 'renew') setPreview({ kind: 'prepare', action, key: send.previewKey(action) })
    else send.run(action, recipientOf(action))
  }

  return (
    <div className="space-y-3">
      {!idle && (
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
          <p className="text-xs text-muted-foreground">{t(`${F}.none`, { firstName: professional.firstName })}</p>
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
      )}

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
          {t(`${F}.noTemplate`)}{' '}
          {can('professionals.manage') || can('professionals.settings') ? (
            <GuardedNavLink to={`${SETTINGS_BASE_PATH}/contrats`} className="text-link underline-offset-[3px] hover:underline">
              {t(`${C}.noTemplateLink`)}
            </GuardedNavLink>
          ) : null}
        </p>
      )}
      {form === 'service_contract' && sends && !noTemplate && state === 'none' && !inForce && !contract.clinicSigner && (
        <p className="text-xs text-muted-foreground">{t(`${C}.noClinicSigner`)}</p>
      )}
      {form === 'service_contract' && state === 'signed' && !request?.canRead && <p className="text-xs text-muted-foreground">{t(`${C}.restricted`)}</p>}
      {form === 'image_consent' && state === 'signed' && <p className="text-xs text-muted-foreground">{t('modules.professionals.imageConsent.signedHelp')}</p>}
      {state === 'failed' && sends && <p className="text-xs text-muted-foreground">{t(`${F}.failedHelp`)}</p>}

      {refusal && <RefusalAlert message={refusal} />}

      {journal && request && (
        <div id={journalId} className="rounded-md border border-border-light p-3">
          <p className="mb-1 text-xs font-medium text-foreground">{t(`${C}.journal.title`)}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {request.sentAt && <li>{t(`${C}.journal.sent`, { date: formatClinicDateShort(request.sentAt) })}</li>}
            {request.signers.flatMap((s) => [
              ...(s.viewedAt ? [<li key={`${s.order}v`}>{t(`${F}.journal.viewed`, { name: s.name, date: formatClinicDateShort(s.viewedAt) })}</li>] : []),
              ...(s.signedAt ? [<li key={`${s.order}s`}>{t(`${C}.journal.signed`, { name: s.name, date: formatClinicDateShort(s.signedAt) })}</li>] : []),
            ])}
            {request.completedAt && <li>{t(`${F}.journal.completed`, { date: formatClinicDateShort(request.completedAt) })}</li>}
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
          documentLabel={form === 'image_consent' ? t('modules.professionals.imageConsent.actions.pdf') : t(`${C}.actions.pdf`)}
          documentAriaLabel={
            form === 'image_consent'
              ? t('modules.professionals.imageConsent.actions.pdfLabel', { firstName: professional.firstName })
              : t(`${C}.actions.pdfLabel`, { firstName: professional.firstName })
          }
        />
      )}

      {(buttons.some((b) => b.kind !== 'pdf') || state === 'signed' || sentSource || extraActions) && (
        <div className="flex flex-wrap gap-2">
          {buttons.map((button) => {
            if (button.kind === 'pdf') return null
            if (button.kind === 'sync') {
              return (
                <Button
                  key="sync"
                  type="button"
                  variant="outline"
                  aria-disabled={pending || undefined}
                  className={cn(softDisabledClasses)}
                  onClick={ignoreWhenInactive(pending, () => sync.mutate(request!.id))}
                >
                  {sync.isPending ? t(`${C}.actions.syncing`) : t(`${C}.actions.sync`)}
                </Button>
              )
            }
            const primary = (button.action === 'send' || button.action === 'renew') && !(form === 'image_consent' && state === 'signed')
            const unavailable = noTemplate && button.action !== 'resend'
            return (
              <Button
                key={button.action}
                type="button"
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
          {sentSource && (
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                opener.current = event.currentTarget
                setPreview({ kind: 'sent', ...sentSource })
              }}
            >
              {t(`${F}.actions.viewSent`)}
            </Button>
          )}
          {state === 'signed' && request && (
            <Button type="button" variant="outline" aria-expanded={journal} aria-controls={journal ? journalId : undefined} onClick={() => setJournal((open) => !open)}>
              {journal ? t(`${C}.actions.hideJournal`) : t(`${C}.actions.journal`)}
            </Button>
          )}
          {extraActions}
        </div>
      )}

      <SigningPreviewDialog
        form={form}
        professionalId={professional.id}
        firstName={professional.firstName}
        version={preview?.kind === 'sent' ? (request?.templateVersion ?? null) : contract.publishedVersion}
        source={preview}
        onClose={closePreview}
        onSend={sendPreviewed}
        onRefresh={() => preview?.kind === 'prepare' && setPreview({ ...preview, key: send.previewKey(preview.action, true) })}
        onFailed={() => preview?.kind === 'prepare' && send.releaseKey(preview.action)}
        note={
          form === 'image_consent' && state === 'signed'
            ? t('modules.professionals.imageConsent.confirm.renew.body', { firstName: professional.firstName, version: String(contract.publishedVersion ?? '') })
            : inForce
              ? t(`${C}.preview.inForceNote`)
              : undefined
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          opener.current?.focus()
        }}
      />

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
                <AlertDialogTitle>{confirmText(confirming, 'title', { firstName: recipientOf(confirming) })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmText(confirming, 'body', {
                    firstName: recipientOf(confirming),
                    version: String(contract.publishedVersion ?? ''),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <Button type="button" onClick={run}>
                  {confirmText(confirming, 'action')}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
