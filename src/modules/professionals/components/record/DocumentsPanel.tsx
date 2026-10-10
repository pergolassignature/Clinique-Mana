import { useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { SectionGroup } from '@/shared/components/SectionHeading'
import { Card } from '@/shared/ui/card'
import type { ProfessionalDocument, ProfessionalDocuments } from '../../api/documents'
import type { DocumentType } from '../../api/parse'
import { groupDocuments, requiredSummary, type DocumentPermissions, type DocumentViewer } from '../../lib/documents'
import { DeleteDocumentDialog, RedateDocumentDialog, RejectDocumentDialog, VerifyDocumentDialog, type DocumentOwner } from './DocumentReviewDialogs'
import { DocumentPreview } from './DocumentPreview'
import { DocumentRow, type DocumentDialogAction } from './DocumentRow'
import { RequiredDocumentCard } from './RequiredDocumentCard'
import { focusAfterClose } from './status-dialog'
import { UploadDocumentDialog } from './UploadDocumentDialog'

const D = 'modules.professionals.documents'

type OpenDialog = { kind: 'upload'; type: DocumentType | null } | { kind: DocumentDialogAction; document: ProfessionalDocument }

interface DocumentsPanelProps {
  /** `get_professional_documents`'s payload (its `today` is the clinic's date). */
  data: ProfessionalDocuments
  /** The catalogue's document types, archived ones included (an old document keeps its type's name). */
  types: readonly DocumentType[]
  viewer: DocumentViewer
  owner: DocumentOwner
  can: DocumentPermissions
  /** A reviewer on another's record: an upload is verified at once (P4-401). */
  verifiedAtOnce: boolean
  /** Where focus goes when the button that opened a dialog is gone (the page's heading). */
  focusFallback: () => void
  /** Extra content of a required type's card (the record's image-consent signing, P4-485). */
  typeExtra?: (type: DocumentType) => ReactNode
  /** Staff: brings « Questionnaire et mises à jour » into view (a card's « Voir le questionnaire à réviser », P4-495). */
  onShowReview?: () => void
  /** The groups' heading level: `h3` under the record tab's h2 (default), `h2` under « Mes documents »' h1. */
  groupAs?: 'h2' | 'h3'
}

/**
 * The documents of one professional, the same for the Documents tab (staff) and « Mes documents »
 * (the professional), as two groups (overline headings, audit 2026-10-09 §2.4): « Documents
 * requis » (the summary « 2 sur 3 » beside the heading, one row per required active type in the
 * clinic's order, all in one card), then « Autres documents » (every other type, archived ones
 * included, newest first) with « Téléverser un document » beside its heading. The panel holds the one dialog open at a
 * time (upload, preview, verify, refuse, redate, delete); focus goes back to the button that
 * opened it, else to the page's heading.
 */
export function DocumentsPanel({ data, types, viewer, owner, can, verifiedAtOnce, focusFallback, typeExtra, onShowReview, groupAs = 'h3' }: DocumentsPanelProps) {
  const [open, setOpen] = useState<OpenDialog | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const { required, others } = groupDocuments(types, data)
  const summary = requiredSummary(required)
  const typeById = new Map(types.map((type) => [type.id, type]))
  const close = () => setOpen(null)
  const afterClose = (event: Event) => focusAfterClose(event, [opener.current], focusFallback)
  const onAction = (kind: DocumentDialogAction, document: ProfessionalDocument, button: HTMLButtonElement) => {
    opener.current = button
    setOpen({ kind, document })
  }
  const onUpload = (type: DocumentType | null, button: HTMLButtonElement) => {
    opener.current = button
    setOpen({ kind: 'upload', type })
  }
  const rowProps = { today: data.today, viewer, firstName: owner.firstName, can, onAction }

  return (
    // Two groups, 32 px apart (audit 2026-10-09 §2.3).
    <div className="flex flex-col gap-8">
      <SectionGroup
        as={groupAs}
        title={t(`${D}.required.title`)}
        action={
          summary.total > 0 && (
            <p className="text-xs tabular text-muted-foreground">
              {t(`${D}.required.summary`, { done: String(summary.done), total: String(summary.total) })}
              {/* Not in order yet, but waiting for the clinic (P4-495): the count is no failure. */}
              {summary.awaiting > 0 && ` · ${t(`${D}.required.awaiting`, { count: String(summary.awaiting) })}`}
            </p>
          )
        }
      >
        <Card className="min-w-0 divide-y divide-border">
          {required.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t(`${D}.required.none`)}</p>
          ) : (
            required.map((entry) => (
              <RequiredDocumentCard
                key={entry.type.id}
                entry={entry}
                {...rowProps}
                // The professional never uploads her image consent: she fills it in and signs it (P4-489).
                can={viewer === 'self' && entry.type.key === 'image_consent' ? { ...can, upload: false } : can}
                onUpload={(button) => onUpload(entry.type, button)}
                extra={typeExtra?.(entry.type)}
                onShowReview={onShowReview}
                headingAs={groupAs === 'h2' ? 'h3' : 'h4'}
              />
            ))
          )}
        </Card>
      </SectionGroup>

      <SectionGroup
        as={groupAs}
        title={t(`${D}.others.title`)}
        description={t(`${D}.others.description`)}
        action={
          can.upload && (
            <Button type="button" variant="outline" onClick={(event) => onUpload(null, event.currentTarget)}>
              <Upload aria-hidden />
              {t(`${D}.actions.uploadOther`)}
            </Button>
          )
        }
      >
        <Card className="min-w-0">
          {others.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t(`${D}.others.empty`)}</p>
          ) : (
            <ul aria-label={t(`${D}.others.title`)} className="divide-y divide-border-light px-4">
              {others.map((document) => (
                <DocumentRow key={document.id} document={document} type={typeById.get(document.typeId)} showType {...rowProps} />
              ))}
            </ul>
          )}
        </Card>
      </SectionGroup>

      {open?.kind === 'upload' && (
        <UploadDocumentDialog
          professionalId={owner.id}
          professionalName={viewer === 'staff' ? owner.name : null}
          today={data.today}
          type={open.type}
          types={types}
          self={viewer === 'self'}
          verifiedAtOnce={verifiedAtOnce}
          onClose={close}
          onCloseAutoFocus={afterClose}
        />
      )}
      {open?.kind === 'preview' && open.document.file && (
        <DocumentPreview file={open.document.file} typeName={typeById.get(open.document.typeId)?.name ?? ''} onClose={close} onCloseAutoFocus={afterClose} />
      )}
      {open && open.kind !== 'upload' && open.kind !== 'preview' && (
        <ReviewDialog kind={open.kind} document={open.document} type={typeById.get(open.document.typeId)} owner={owner} today={data.today} onClose={close} onCloseAutoFocus={afterClose} />
      )}
    </div>
  )
}

const REVIEW_DIALOGS = { verify: VerifyDocumentDialog, reject: RejectDocumentDialog, redate: RedateDocumentDialog, delete: DeleteDocumentDialog } as const

function ReviewDialog({ kind, ...props }: { kind: keyof typeof REVIEW_DIALOGS } & Parameters<typeof VerifyDocumentDialog>[0]) {
  const Dialog = REVIEW_DIALOGS[kind]
  return <Dialog {...props} />
}
