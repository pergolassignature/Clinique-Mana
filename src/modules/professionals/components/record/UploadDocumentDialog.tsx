import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { rpcErrorHint } from '@/core/modules/errors'
import { uploadErrorMessage } from '@/core/storage/errors'
import { FileDropzone } from '@/shared/components/FileDropzone'
import type { UploadStep } from '@/shared/lib/files'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import type { DocumentType } from '../../api/parse'
import { useUploadDocument } from '../../hooks/use-documents'
import { DOCUMENT_MAX_IMAGE_SIDE } from '../../lib/constants'
import { defaultExpiry, expiryError, megabytesLabel, mimeListLabel, uploadableTypes } from '../../lib/documents'

const U = 'modules.professionals.documents.upload'

/** A refusal of a field typed in the dialog (HINT `expires_on`, `insurer`, `policy_number`). */
type FieldName = 'expiresOn' | 'insurer' | 'policyNumber'
const HINT_FIELD: Record<string, FieldName> = { expires_on: 'expiresOn', insurer: 'insurer', policy_number: 'policyNumber' }

/** A check of the dialog's fields that stopped the upload: said under its field, and in the zone. */
class FieldCheckError extends Error {}

/** A file already uploaded whose attach a field refused: attached again once the field is corrected. */
interface KeptFile {
  fileId: string
  file: File
  mimeType: string
}

interface UploadDocumentDialogProps {
  professionalId: string
  /** « Le document s'ajoute au dossier de Marie Tremblay » (staff); null on « Mes documents ». */
  professionalName: string | null
  /** The clinic's date (the default end date, the earliest one accepted). */
  today: string
  /** The type, fixed (a card's « Téléverser »), or null to choose among `types`. */
  type: DocumentType | null
  /** The catalogue's types (archived ones are left out). */
  types: readonly DocumentType[]
  /** The professional's own upload (`professional_self_document`, always pending). */
  self: boolean
  /** A reviewer on another's record: the document is verified at once (P4-401). */
  verifiedAtOnce: boolean
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Téléverser » (Tasks 4c.3, 4c.6): the type (chosen, or fixed by the card), its last valid day for
 * a type with a rule (proposed from the clinic's date: the next March 31, P4-412, or 12 months;
 * editable), the insurer and policy number for the insurance (optional), then the file: dropped or
 * chosen, checked here against the type's files and size, sent through the storage pipeline and
 * attached (`attach_professional_document`, which checks them again). The fields are checked
 * before anything is sent. A refusal of a field shows under it; anything else in the zone, worded
 * as the storage functions' (`uploadErrorMessage`). While a file is sent the dialog stays open.
 *
 * A file the database refused on a field (the date, HINT `expires_on`; the insurer) is already
 * uploaded: it is kept, and « Joindre ce fichier » attaches it again once the field is corrected,
 * without sending it again (it stays staged a day). Another file, or another type, drops it.
 */
export function UploadDocumentDialog({ professionalId, professionalName, today, type: fixedType, types, self, verifiedAtOnce, onClose, onCloseAutoFocus }: UploadDocumentDialogProps) {
  // The professional fills in and signs her image consent online, never uploads it (P4-489).
  const choices = uploadableTypes(types).filter((x) => !(self && x.key === 'image_consent'))
  const [typeId, setTypeId] = useState(fixedType?.id ?? '')
  const type = fixedType ?? choices.find((x) => x.id === typeId) ?? null
  const [expiresOn, setExpiresOn] = useState(fixedType ? (defaultExpiry(fixedType.expiryRule, today) ?? '') : '')
  const [insurer, setInsurer] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [kept, setKept] = useState<KeptFile | null>(null)
  const [keptError, setKeptError] = useState<string | null>(null)
  // Remounts the zone on « Joindre ce fichier », so its message about the earlier try goes away.
  const [zoneKey, setZoneKey] = useState(0)
  const dateInput = useRef<HTMLInputElement>(null)
  const upload = useUploadDocument()
  const { can } = useAccess()
  // An admin who practises uploads to her own file as staff (still pending): the RPC checks `.manage` first (P4-464).
  const selfPurpose = self && !can('professionals.manage')
  const busy = upload.isPending
  const withExpiry = type !== null && type.expiryRule !== 'none'
  const insurance = type?.key === 'insurance'

  const chooseType = (id: string) => {
    setTypeId(id)
    const next = choices.find((x) => x.id === id)
    setExpiresOn(next ? (defaultExpiry(next.expiryRule, today) ?? '') : '')
    setErrors({})
    setKept(null)
    setKeptError(null)
  }

  /** The fields' own checks, before the file goes anywhere. */
  const checkFields = (): Partial<Record<FieldName, string>> => {
    const found: Partial<Record<FieldName, string>> = {}
    const dateProblem = withExpiry ? expiryError(expiresOn, { min: today }) : null
    if (dateProblem) found.expiresOn = dateProblem
    if (insurance && insurer.trim().length > 120) found.insurer = t(`${U}.fieldTooLong`)
    if (insurance && policyNumber.trim().length > 120) found.policyNumber = t(`${U}.fieldTooLong`)
    return found
  }

  /**
   * Checks the fields, then uploads `file` (or attaches `uploadedFileId` again) and attaches it. A
   * field's refusal shows under the field and keeps the uploaded file for « Joindre ce fichier ».
   */
  const submit = async (file: File, mimeType: string, { onStep, uploadedFileId }: { onStep?: (step: UploadStep) => void; uploadedFileId?: string }) => {
    if (!type) return
    const found = checkFields()
    setErrors(found)
    setKeptError(null)
    const first = Object.values(found)[0]
    if (first) {
      if (found.expiresOn) dateInput.current?.focus()
      throw new FieldCheckError(first)
    }
    let uploaded = uploadedFileId ?? null
    try {
      await upload.mutateAsync({
        professionalId,
        typeKey: type.key,
        file,
        mimeType,
        expiresOn: withExpiry ? expiresOn.trim() : null,
        insurer: insurance ? insurer.trim() || null : null,
        policyNumber: insurance ? policyNumber.trim() || null : null,
        self: selfPurpose,
        onStep,
        uploadedFileId,
        onUploaded: (fileId) => {
          uploaded = fileId
        },
      })
    } catch (error) {
      const field = HINT_FIELD[rpcErrorHint(error) ?? '']
      if (field) {
        const message = uploadErrorMessage(error)
        setErrors({ [field]: message })
        setKept(uploaded ? { fileId: uploaded, file, mimeType } : null)
        if (field === 'expiresOn') dateInput.current?.focus()
        throw new FieldCheckError(message)
      }
      setKept(null)
      throw error
    }
    toast.success(t(self ? 'modules.professionals.documents.toasts.uploadedSelf' : verifiedAtOnce ? 'modules.professionals.documents.toasts.uploaded' : 'modules.professionals.documents.toasts.uploadedPending'))
    onClose()
  }

  const send = (file: File, mimeType: string, onStep: (step: UploadStep) => void) => submit(file, mimeType, { onStep })

  /** « Joindre ce fichier »: the kept file, attached again with the fields as corrected. */
  const attachKept = async () => {
    if (!kept || busy) return
    setZoneKey((key) => key + 1)
    try {
      await submit(kept.file, kept.mimeType, { uploadedFileId: kept.fileId })
    } catch (error) {
      // A field's refusal is already under the field; anything else (the staged file gone…) here.
      if (!(error instanceof FieldCheckError)) setKeptError(uploadErrorMessage(error))
    }
  }

  const title = fixedType ? t(`${U}.title`, { type: fixedType.name }) : t(`${U}.titleAny`)
  const note = t(self ? `${U}.reviewedLaterSelf` : verifiedAtOnce ? `${U}.verifiedAtOnce` : `${U}.reviewedLater`)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{professionalName ? t(`${U}.description`, { name: professionalName }) : t(`${U}.descriptionSelf`)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5">
          {!fixedType && (
            <FormField label={t(`${U}.type`)} required>
              {(field) => (
                <Select {...field} value={typeId} onChange={(event) => chooseType(event.target.value)} disabled={busy}>
                  <option value="">{t(`${U}.typePlaceholder`)}</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {withExpiry && (
            <FormField label={t(`${U}.expiresOn`)} help={t(`${U}.expiresOnHelp`)} required error={errors.expiresOn}>
              {(field) => (
                <Input
                  {...field}
                  ref={dateInput}
                  type="date"
                  value={expiresOn}
                  min={today}
                  max="2100-12-31"
                  onChange={(event) => setExpiresOn(event.target.value)}
                  readOnly={busy}
                  className="max-w-[12rem] tabular"
                />
              )}
            </FormField>
          )}
          {insurance && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <FormField label={t(`${U}.insurer`)} error={errors.insurer}>
                {(field) => <Input {...field} value={insurer} onChange={(event) => setInsurer(event.target.value)} maxLength={120} autoComplete="off" readOnly={busy} />}
              </FormField>
              <FormField label={t(`${U}.policyNumber`)} error={errors.policyNumber}>
                {(field) => <Input {...field} value={policyNumber} onChange={(event) => setPolicyNumber(event.target.value)} maxLength={120} autoComplete="off" readOnly={busy} />}
              </FormField>
            </div>
          )}
          {type ? (
            <>
              <p className="text-sm text-muted-foreground">{note}</p>
              {kept && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
                  <p className="min-w-0 flex-1 break-words text-sm">{t(`${U}.kept`, { name: kept.file.name })}</p>
                  <Button type="button" size="sm" aria-disabled={busy || undefined} onClick={() => void attachKept()}>
                    {t(`${U}.attachKept`)}
                  </Button>
                </div>
              )}
              {keptError && (
                <p role="alert" className="text-sm text-destructive">
                  {keptError}
                </p>
              )}
              <FileDropzone
                key={`${type.id}:${zoneKey}`}
                buttonLabel={t(kept ? `${U}.chooseAnother` : `${U}.choose`)}
                hint={t(`${U}.hint`, { types: mimeListLabel(type.acceptedMime), size: megabytesLabel(type.maxBytes) })}
                accept={type.acceptedMime}
                maxBytes={type.maxBytes}
                maxImageSide={DOCUMENT_MAX_IMAGE_SIDE}
                onUpload={send}
                errorMessage={(error) => (error instanceof FieldCheckError ? error.message : uploadErrorMessage(error))}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(`${U}.chooseTypeFirst`)}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
