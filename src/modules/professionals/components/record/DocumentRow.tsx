import { Fragment, useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { t, type TranslationKey } from '@/i18n'
import { softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { StatusDot } from '@/shared/ui/status-dot'
import type { ProfessionalDocument } from '../../api/documents'
import type { DocumentType } from '../../api/parse'
import { useDocumentDownload } from '../../hooks/use-documents'
import {
  documentActions,
  documentStateLabel,
  documentStateTone,
  type DocumentAction,
  type DocumentPermissions,
  type DocumentViewer,
} from '../../lib/documents'

const D = 'modules.professionals.documents'

/** The actions a row hands to its panel (the dialogs and the preview live there). */
export type DocumentDialogAction = Exclude<DocumentAction, 'download'>

export interface DocumentRowProps {
  document: ProfessionalDocument
  /** Its type (its name, its rule); undefined for a type no longer in the catalogue. */
  type: DocumentType | undefined
  /** The clinic's date (`yyyy-MM-dd`). */
  today: string
  viewer: DocumentViewer
  /** The professional's first name (« Téléversé … par Marie »). */
  firstName: string
  can: DocumentPermissions
  /** Words before the state (« Nouveau document »): a renewal waiting under a valid one. */
  label?: string
  /** « Autres documents »: the row is named by its type. */
  showType?: boolean
  onAction: (action: DocumentDialogAction, document: ProfessionalDocument, opener: HTMLButtonElement) => void
}

/** Who sent it and when, in the viewer's words. */
function uploadedLine(document: ProfessionalDocument, viewer: DocumentViewer, firstName: string): string {
  const date = formatClinicDateShort(document.uploadedAt)
  // A consent signed through Documenso (P4-485): when she signed, not who uploaded.
  if (document.signatureRequestId !== null) return t(`${D}.lines.signedElectronically`, { date })
  if (viewer === 'self') return t(document.uploadedBySelf ? `${D}.lines.uploadedByYou` : `${D}.lines.uploadedForYou`, { date })
  return document.uploadedBySelf ? t(`${D}.lines.uploadedByProfessional`, { date, firstName }) : t(`${D}.lines.uploadedByClinic`, { date })
}

/** The review's line: « Vérifié le … par Julie Adjointe », « Refusé le … » (the reviewer's name reaches staff only). */
function reviewedLine(document: ProfessionalDocument): string | null {
  // A signed consent is verified by its signature, never by a reviewer.
  if (!document.reviewedAt || document.status === 'pending' || document.signatureRequestId !== null) return null
  const date = formatClinicDateShort(document.reviewedAt)
  const name = document.reviewedByName
  if (document.status === 'rejected') return name ? t(`${D}.lines.rejectedBy`, { date, name }) : t(`${D}.lines.rejectedOn`, { date })
  return name ? t(`${D}.lines.verifiedBy`, { date, name }) : t(`${D}.lines.verifiedOn`, { date })
}

const ACTION_LABEL: Record<DocumentAction, TranslationKey> = {
  preview: `${D}.actions.preview`,
  download: `${D}.actions.download`,
  verify: `${D}.actions.verify`,
  reject: `${D}.actions.reject`,
  redate: `${D}.actions.redate`,
  delete: `${D}.actions.delete`,
}

/**
 * One document: its state in words (dot + word), who sent it and when, the review, the
 * insurance's insurer and policy, a refusal's reason; then its actions. Inline: « Aperçu » (or
 * « Télécharger » for a Word file) and, on a pending one, « Vérifier » and « Refuser »; the rest
 * (Télécharger, Refuser a verified one, Modifier l'échéance, Supprimer) in « … ». Every button is
 * named with the document (several rows say « Aperçu »). « Télécharger » asks for a new URL at
 * each press (`useDocumentDownload`).
 */
export function DocumentRow({ document, type, today, viewer, firstName, can, label, showType = false, onAction }: DocumentRowProps) {
  const download = useDocumentDownload()
  const actions = documentActions(document, type, can)
  const state = documentStateLabel(document, today, viewer === 'self')
  const eSignedInForce = document.signatureRequestId !== null && document.status === 'verified' && !showType && !label
  const reviewed = reviewedLine(document)
  const inline: DocumentAction[] = []
  if (actions.includes('preview')) inline.push('preview')
  else if (actions.includes('download')) inline.push('download')
  if (document.status === 'pending') inline.push(...actions.filter((a) => a === 'verify' || a === 'reject'))
  // A menu holding « Télécharger » alone (a reader, the professional) is a button of its own.
  if (actions.length - inline.length === 1 && actions.includes('download') && !inline.includes('download')) inline.splice(1, 0, 'download')
  const menu = actions.filter((a) => !inline.includes(a))
  const name = t(`${D}.actions.documentName`, { type: type?.name ?? '', state })

  const press = (action: DocumentAction, opener: HTMLButtonElement) => {
    if (action !== 'download') return onAction(action, document, opener)
    if (document.file && !download.isPending) download.mutate(document.file.id)
  }

  const meta = [
    document.insurer && t(`${D}.lines.insurer`, { value: document.insurer }),
    document.policyNumber && t(`${D}.lines.policy`, { value: document.policyNumber }),
  ].filter(Boolean)

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        {eSignedInForce ? (
          // The card's state line already says « Signé le … · valide jusqu'au … »: the row names the file.
          <p className="text-xs text-muted-foreground">{t(`${D}.lines.signedPdf`)}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
              {showType && <span className="font-medium text-foreground">{type?.name}</span>}
              {label && <span className="font-medium text-foreground">{label}</span>}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot tone={documentStateTone(document, today)} />
                {state}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{[uploadedLine(document, viewer, firstName), reviewed].filter(Boolean).join(' · ')}</p>
          </>
        )}
        {meta.length > 0 && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{meta.join(' · ')}</p>}
        {document.status === 'rejected' && document.rejectionReason && (
          <p className="mt-1 whitespace-pre-line border-l-2 border-border pl-2 text-sm text-foreground [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">{t(`${D}.lines.reason`)} </span>
            {document.rejectionReason}
          </p>
        )}
        {!document.file && document.status !== 'rejected' && <p className="text-xs text-muted-foreground">{t(`${D}.lines.fileGone`)}</p>}
      </div>
      {(inline.length > 0 || menu.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 self-start">
          {inline.map((action) => {
            const pending = action === 'download' && download.isPending
            return (
              <Button
                key={action}
                type="button"
                size="sm"
                variant={action === 'verify' ? 'default' : 'outline'}
                aria-label={`${t(ACTION_LABEL[action])} : ${name}`}
                aria-disabled={pending || undefined}
                onClick={(event) => {
                  if (pending) event.preventDefault()
                  else press(action, event.currentTarget)
                }}
                className={softDisabledClasses}
              >
                {pending ? t(`${D}.actions.downloading`) : t(ACTION_LABEL[action])}
              </Button>
            )
          })}
          {menu.length > 0 && <RowMenu actions={menu} name={name} downloading={download.isPending} onPress={press} />}
        </div>
      )}
    </li>
  )
}

/**
 * « … »: the chosen action runs once the menu has closed and given focus back to its button, so a
 * dialog it opens returns focus there.
 */
function RowMenu({
  actions,
  name,
  downloading,
  onPress,
}: {
  actions: DocumentAction[]
  name: string
  downloading: boolean
  onPress: (action: DocumentAction, opener: HTMLButtonElement) => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const chosen = useRef<DocumentAction | null>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} type="button" variant="ghost" size="icon-sm" aria-label={t(`${D}.actions.more`, { name })}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const action = chosen.current
          chosen.current = null
          if (!action || !trigger.current) return
          event.preventDefault()
          trigger.current.focus()
          onPress(action, trigger.current)
        }}
      >
        {actions.map((action) => (
          <Fragment key={action}>
            {action === 'delete' && actions.length > 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action === 'download' && downloading}
              onSelect={() => (chosen.current = action)}
              className={cn(action === 'delete' && 'text-destructive focus:text-destructive')}
            >
              {t(ACTION_LABEL[action])}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
