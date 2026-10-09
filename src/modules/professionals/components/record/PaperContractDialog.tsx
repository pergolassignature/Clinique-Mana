import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { uploadErrorMessage } from '@/core/storage/errors'
import { FileDropzone } from '@/shared/components/FileDropzone'
import type { UploadStep } from '@/shared/lib/files'
import { getClinicDateString } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import { PAPER_CONTRACT_MAX_BYTES, PAPER_CONTRACT_MIME } from '../../api/contracts'
import { useRecordPaperContract } from '../../hooks/use-contracts'
import { PAPER_EARLIEST, paperSignedOnError } from '../../lib/contract'
import { megabytesLabel } from '../../lib/documents'

const P = 'modules.professionals.contract.paper'

/** A check of the date that stopped the upload: said under the field, and in the zone. */
class DateCheckError extends Error {}

interface PaperContractDialogProps {
  professionalId: string
  firstName: string
  /** « Remplacer » a paper contract in force (the old one goes to « Contrats précédents »). */
  replace: boolean
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Téléverser un contrat signé » / « Remplacer » (P4-520, P4-521, P4-523): the signature date (a
 * calendar date, from 2000 to the clinic's today), then the PDF, dropped or chosen, sent through
 * the storage pipeline and recorded (`record_professional_paper_contract`, which checks them
 * again). The date is checked before anything is sent; a refusal of it (HINT `signed_on`) shows
 * under it, anything else in the zone. While the file is sent the dialog stays open.
 */
export function PaperContractDialog({ professionalId, firstName, replace, onClose, onCloseAutoFocus }: PaperContractDialogProps) {
  const today = getClinicDateString(new Date())
  const [signedOn, setSignedOn] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dateInput = useRef<HTMLInputElement>(null)
  const record = useRecordPaperContract()
  const busy = record.isPending

  const send = async (file: File, mimeType: string, onStep: (step: UploadStep) => void) => {
    const problem = paperSignedOnError(signedOn, today)
    setError(problem)
    if (problem) {
      dateInput.current?.focus()
      throw new DateCheckError(problem)
    }
    try {
      await record.mutateAsync({ professionalId, file, mimeType, signedOn: signedOn.trim(), onStep })
    } catch (failure) {
      if (rpcErrorHint(failure) === 'signed_on') {
        const message = uploadErrorMessage(failure)
        setError(message)
        throw new DateCheckError(message)
      }
      throw failure
    }
    toast.success(t(replace ? 'modules.professionals.contract.toasts.paperReplaced' : 'modules.professionals.contract.toasts.paperRecorded'))
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t(replace ? `${P}.replaceTitle` : `${P}.title`)}</DialogTitle>
          <DialogDescription>{t(`${P}.description`, { firstName })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5">
          {replace && <p className="text-sm text-muted-foreground">{t(`${P}.replaceNote`)}</p>}
          <FormField label={t(`${P}.signedOn`)} help={t(`${P}.signedOnHelp`)} required error={error ?? undefined}>
            {(field) => (
              <Input
                {...field}
                ref={dateInput}
                type="date"
                value={signedOn}
                min={PAPER_EARLIEST}
                max={today}
                onChange={(event) => {
                  setSignedOn(event.target.value)
                  setError(null)
                }}
                readOnly={busy}
                className="max-w-[12rem] tabular"
              />
            )}
          </FormField>
          <p className="text-sm text-muted-foreground">{t(`${P}.dateFirst`)}</p>
          <FileDropzone
            buttonLabel={t(`${P}.choose`)}
            hint={t(`${P}.hint`, { size: megabytesLabel(PAPER_CONTRACT_MAX_BYTES) })}
            accept={PAPER_CONTRACT_MIME}
            maxBytes={PAPER_CONTRACT_MAX_BYTES}
            onUpload={send}
            errorMessage={(failure) => (failure instanceof DateCheckError ? failure.message : uploadErrorMessage(failure))}
          />
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
