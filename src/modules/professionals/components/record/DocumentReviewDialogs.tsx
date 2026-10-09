import { useRef, useState, type ReactNode, type Ref } from 'react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionalDocument } from '../../api/documents'
import type { DocumentType } from '../../api/parse'
import { useDeleteDocument, useRejectDocument, useSetDocumentExpiry, useVerifyDocument } from '../../hooks/use-documents'
import { expiryError, proposedExpiry } from '../../lib/documents'
import type { StatusDialogProps } from './status-dialog'
import { DialogCancel, DialogRefusal } from './StatusDialogParts'

const D = 'modules.professionals.documents'

/** The professional whose document it is. */
export interface DocumentOwner {
  id: string
  firstName: string
  /** « Marie Tremblay ». */
  name: string
}

export interface DocumentDialogProps extends StatusDialogProps {
  document: ProfessionalDocument
  /** Its type (its name and rule). */
  type: DocumentType | undefined
  owner: DocumentOwner
  /** The clinic's date (`yyyy-MM-dd`). */
  today: string
}

/** HINTs of a decision taken elsewhere meanwhile (decided, deleted, one's own record): « Fermer » only. */
const FINAL_HINTS = new Set(['status', 'document'])

/**
 * The refusal state every review dialog shares: a field's own refusal goes under it (`fieldHint`),
 * anything else above the buttons, and a decision taken elsewhere leaves « Fermer » only.
 */
function useRefusal(fieldHint: string | null) {
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<{ message: string; final: boolean } | null>(null)
  const onErrorMessage = (message: string, error: unknown) => {
    const hint = rpcErrorHint(error)
    if (fieldHint !== null && hint === fieldHint) setFieldError(message)
    else setRefusal({ message, final: hint != null && FINAL_HINTS.has(hint) })
  }
  const clear = () => {
    setFieldError(null)
    setRefusal(null)
  }
  return { fieldError, setFieldError, refusal, onErrorMessage, clear }
}

interface ReviewDialogFrameProps {
  title: string
  description: string
  pending: boolean
  refusal: { message: string; final: boolean } | null
  confirmLabel: string
  pendingLabel: string
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
  children?: ReactNode
}

/** The shared frame: title, description, fields, the refusal, « Annuler » and the one action. */
function ReviewDialogFrame({ title, description, pending, refusal, confirmLabel, pendingLabel, destructive = false, onConfirm, onClose, onCloseAutoFocus, children }: ReviewDialogFrameProps) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent
        aria-busy={pending || undefined}
        // Focus starts on the field to fill (the date, the reason), else on « Annuler ».
        onOpenAutoFocus={(event) => {
          const field = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('input, textarea')
          if (!field) return
          event.preventDefault()
          field.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          noValidate
          className="grid gap-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending && !refusal?.final) onConfirm()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {children}
          <DialogRefusal message={refusal?.message} />
          <AlertDialogFooter>
            <DialogCancel saving={pending} nothingToConfirm={Boolean(refusal?.final)} />
            {!refusal?.final && (
              <Button
                type="submit"
                variant={destructive ? 'destructive' : 'default'}
                aria-disabled={pending || undefined}
                onClick={ignoreWhenInactive(pending)}
                className={cn(softDisabledClasses, destructive ? 'aria-disabled:hover:bg-destructive' : 'aria-disabled:hover:bg-primary')}
              >
                {pending ? pendingLabel : confirmLabel}
              </Button>
            )}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The last valid day field of « Vérifier » and « Modifier l'échéance ». */
function ExpiryField({ value, onChange, error, help, inputRef }: { value: string; onChange: (value: string) => void; error: string | null; help?: string; inputRef: Ref<HTMLInputElement> }) {
  return (
    <FormField label={t(`${D}.verify.expiresOn`)} help={help} required error={error ?? undefined}>
      {(field) => (
        <Input {...field} ref={inputRef} type="date" value={value} min="2000-01-01" max="2100-12-31" onChange={(event) => onChange(event.target.value)} className="max-w-[12rem] tabular" />
      )}
    </FormField>
  )
}

/**
 * « Vérifier » (`professionals.documents.review`, never on one's own record): the document becomes
 * valid; for a type with a rule, with its last valid day (the one given at upload, else the rule's
 * default), which the reviewer corrects if the document says otherwise (P4-2). A past day is said
 * before confirming: the document will read « Expiré ».
 */
export function VerifyDocumentDialog({ document, type, owner, today, onClose, onCloseAutoFocus }: DocumentDialogProps) {
  const withExpiry = type !== undefined && type.expiryRule !== 'none'
  const [expiresOn, setExpiresOn] = useState(() => (type && withExpiry ? (proposedExpiry(document, type, today) ?? '') : ''))
  const dateInput = useRef<HTMLInputElement>(null)
  const state = useRefusal('expires_on')
  const verify = useVerifyDocument({ onErrorMessage: state.onErrorMessage })
  const pending = verify.isPending

  const confirm = () => {
    state.clear()
    if (withExpiry) {
      const problem = expiryError(expiresOn)
      if (problem) {
        state.setFieldError(problem)
        dateInput.current?.focus()
        return
      }
    }
    verify.mutate({ professionalId: owner.id, documentId: document.id, expiresOn: withExpiry ? expiresOn : null }, { onSuccess: onClose })
  }

  return (
    <ReviewDialogFrame
      title={t(`${D}.verify.title`, { type: type?.name ?? '' })}
      description={t(`${D}.verify.body`, { name: owner.name })}
      pending={pending}
      refusal={state.refusal}
      confirmLabel={t(`${D}.verify.confirm`)}
      pendingLabel={t(`${D}.verify.pending`)}
      onConfirm={confirm}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {withExpiry && (
        <div className="space-y-2">
          <ExpiryField value={expiresOn} onChange={setExpiresOn} error={state.fieldError} help={t(`${D}.verify.expiresOnHelp`)} inputRef={dateInput} />
          {expiresOn !== '' && expiresOn < today && expiryError(expiresOn) === null && <p className="text-sm text-foreground">{t(`${D}.verify.pastNote`)}</p>}
        </div>
      )}
    </ReviewDialogFrame>
  )
}

/**
 * « Refuser » (`professionals.documents.review`): the reason (1–1000 characters) is kept for the
 * professional and, for a file she sent herself, emailed to her (P4-451); the file leaves the
 * record at once (P4-404). The dialog says which before confirming.
 */
export function RejectDocumentDialog({ document, type, owner, onClose, onCloseAutoFocus }: DocumentDialogProps) {
  const [reason, setReason] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  const state = useRefusal('reason')
  const reject = useRejectDocument({ onErrorMessage: state.onErrorMessage })
  const pending = reject.isPending

  const confirm = () => {
    state.clear()
    const text = reason.trim()
    const problem = text === '' ? t(`${D}.reject.reasonRequired`) : text.length > 1000 ? t(`${D}.reject.reasonTooLong`) : null
    if (problem) {
      state.setFieldError(problem)
      field.current?.focus()
      return
    }
    reject.mutate({ professionalId: owner.id, documentId: document.id, reason: text, firstName: owner.firstName }, { onSuccess: onClose })
  }

  return (
    <ReviewDialogFrame
      title={t(`${D}.reject.title`, { type: type?.name ?? '' })}
      description={`${t(`${D}.reject.fileRemoved`)} ${document.uploadedBySelf ? t(`${D}.reject.emailed`, { firstName: owner.firstName }) : t(`${D}.reject.notEmailed`)}`}
      pending={pending}
      refusal={state.refusal}
      confirmLabel={t(`${D}.reject.confirm`)}
      pendingLabel={t(`${D}.reject.pending`)}
      destructive
      onConfirm={confirm}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <FormField label={t(`${D}.reject.reason`)} required error={state.fieldError ?? undefined}>
        {(props) => <Textarea {...props} ref={field} value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={1000} />}
      </FormField>
    </ReviewDialogFrame>
  )
}

/** « Modifier l'échéance » (`professionals.documents.review`, audited): the last valid day of a type with a rule. */
export function RedateDocumentDialog({ document, type, owner, today, onClose, onCloseAutoFocus }: DocumentDialogProps) {
  const [expiresOn, setExpiresOn] = useState(() => (type ? (proposedExpiry(document, type, today) ?? '') : ''))
  const dateInput = useRef<HTMLInputElement>(null)
  const state = useRefusal('expires_on')
  const redate = useSetDocumentExpiry({ onErrorMessage: state.onErrorMessage })
  const pending = redate.isPending

  const confirm = () => {
    state.clear()
    const problem = expiryError(expiresOn)
    if (problem) {
      state.setFieldError(problem)
      dateInput.current?.focus()
      return
    }
    redate.mutate({ professionalId: owner.id, documentId: document.id, expiresOn }, { onSuccess: onClose })
  }

  return (
    <ReviewDialogFrame
      title={t(`${D}.redate.title`, { type: type?.name ?? '' })}
      description={t(`${D}.redate.body`)}
      pending={pending}
      refusal={state.refusal}
      confirmLabel={t(`${D}.redate.confirm`)}
      pendingLabel={t(`${D}.redate.pending`)}
      onConfirm={confirm}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <ExpiryField value={expiresOn} onChange={setExpiresOn} error={state.fieldError} inputRef={dateInput} />
    </ReviewDialogFrame>
  )
}

/** « Supprimer » (`professionals.documents.delete`): the row goes (the history keeps it), its file is purged 30 days later. */
export function DeleteDocumentDialog({ document, type, owner, onClose, onCloseAutoFocus }: DocumentDialogProps) {
  const state = useRefusal(null)
  const remove = useDeleteDocument({ onErrorMessage: state.onErrorMessage })
  return (
    <ReviewDialogFrame
      title={t(`${D}.delete.title`)}
      description={t(`${D}.delete.body`, { type: type?.name ?? '', name: owner.name })}
      pending={remove.isPending}
      refusal={state.refusal}
      confirmLabel={t(`${D}.delete.confirm`)}
      pendingLabel={t(`${D}.delete.pending`)}
      destructive
      onConfirm={() => {
        state.clear()
        remove.mutate({ professionalId: owner.id, documentId: document.id }, { onSuccess: onClose })
      }}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
