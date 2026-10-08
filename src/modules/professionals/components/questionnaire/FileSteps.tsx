import { useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { FileText } from 'lucide-react'
import { t } from '@/i18n'
import { uploadFile, UploadSendError } from '@/core/storage/api'
import { FunctionCallError } from '@/core/supabase/functions'
import { uploadErrorMessage } from '@/core/storage/errors'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { FileDropzone } from '@/shared/components/FileDropzone'
import type { UploadStep } from '@/shared/lib/files'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { isRefusal } from '../../hooks/use-my-submission'
import { nextMarch31, sectionFileId } from '../../lib/questionnaire'
import { insuranceSchema, type InsuranceValues } from '../../schemas/questionnaire'
import { StepActions, StepAlert, StepForm } from './StepParts'
import { refusalTarget, useStepForm, type StepContext } from './use-step-form'

const F = 'modules.professionals.questionnaire.files'

/**
 * The staged uploads of the questionnaire (P4-177, P4-306): purpose `professional_submission_file`,
 * the submission as subject. The caps are `private.assert_submission_file`'s, stricter than the
 * purpose's (10 MB, PDF / JPEG / PNG, 4000 px).
 */
export const SUBMISSION_FILE = { purpose: 'professional_submission_file', subjectType: 'professional_submission' } as const
export const PHOTO_LIMITS = { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 5_242_880, maxImageSide: 4000 } as const
export const INSURANCE_LIMITS = { mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 10_485_760, maxImageSide: 4000 } as const

/**
 * The French text of a failed upload (the storage functions), or of the draft save that records it
 * (already reported by the autosave: a refusal's message, the connection, or « not saved »).
 */
const fileErrorMessage = (error: unknown) =>
  error instanceof FunctionCallError || error instanceof UploadSendError ? uploadErrorMessage(error) : refusalTarget(error, []).message

/**
 * Uploads a file for the submission, then records it in the section (with `extra` fields: the
 * insurance's expiry). A refused record throws, so the dropzone shows why.
 */
function useSubmissionUpload(ctx: StepContext, section: 'photo' | 'insurance', extra: () => Record<string, unknown> = () => ({})) {
  return async (file: File, mimeType: string, onStep: (step: UploadStep) => void) => {
    const { fileId } = await uploadFile({ ...SUBMISSION_FILE, subjectId: ctx.submission.id, file, mimeType, onStep })
    const outcome = await ctx.autosave.save(section, { file_id: fileId, ...extra() })
    if (!outcome.ok) throw outcome.error
  }
}

/**
 * « Retirer »: the section no longer names the file (the staged file expires by itself, P4-331).
 * Once removed, focus goes to the dropzone's button (this one is gone).
 */
function RemoveFileButton({
  ctx,
  section,
  label,
  onRemoved,
  focusAfter,
}: {
  ctx: StepContext
  section: 'photo' | 'insurance'
  label: string
  onRemoved: (message: string | null) => void
  focusAfter: RefObject<HTMLButtonElement | null>
}) {
  const [pending, setPending] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-disabled={pending || undefined}
      onClick={async () => {
        if (pending) return
        setPending(true)
        const outcome = await ctx.autosave.save(section, { file_id: null })
        setPending(false)
        onRemoved(outcome.ok ? null : fileErrorMessage(outcome.error))
        if (outcome.ok) focusAfter.current?.focus()
      }}
    >
      {pending ? t(`${F}.removing`) : label}
    </Button>
  )
}

/** « Photo » (required, P4-173): JPEG or PNG, 5 MB at most, shown as the fiche will show it. */
export function PhotoStep({ ctx }: { ctx: StepContext }) {
  const fileId = sectionFileId(ctx.autosave.answered, 'photo')
  const preview = useSignedFileUrl(fileId)
  const [pending, setPending] = useState(false)
  const [alert, setAlert] = useState<string | null>(null)
  const dropzoneButton = useRef<HTMLButtonElement>(null)
  const upload = useSubmissionUpload(ctx, 'photo')

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if (!fileId) {
      setAlert(t(`${F}.photoRequired`))
      dropzoneButton.current?.focus()
      return
    }
    setPending(true)
    // Only what this press sends (or waits for) counts: an earlier refused save is said elsewhere.
    const outcome = await ctx.autosave.flush('photo')
    setPending(false)
    if (outcome.ok) ctx.next()
    else setAlert(fileErrorMessage(outcome.error))
  }

  return (
    <StepForm onSubmit={(event) => void onSubmit(event)} busy={pending} className="space-y-4">
      {fileId ? (
        <div className="flex items-center gap-4">
          {preview.data ? (
            <img src={preview.data.url} alt={t(`${F}.photoAlt`)} onError={() => void preview.refetch()} className="size-24 shrink-0 rounded-full border border-border object-cover" />
          ) : (
            <div aria-hidden className="size-24 shrink-0 rounded-full bg-muted" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-foreground">{t(`${F}.photoReceived`)}</p>
            <RemoveFileButton ctx={ctx} section="photo" label={t(`${F}.removePhoto`)} onRemoved={setAlert} focusAfter={dropzoneButton} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${F}.photoNone`)}</p>
      )}
      <FileDropzone
        buttonLabel={t(fileId ? `${F}.replacePhoto` : `${F}.choosePhoto`)}
        hint={t(`${F}.photoHint`)}
        accept={PHOTO_LIMITS.mimeTypes}
        maxBytes={PHOTO_LIMITS.maxBytes}
        maxImageSide={PHOTO_LIMITS.maxImageSide}
        buttonRef={dropzoneButton}
        onUpload={async (...args) => {
          setAlert(null)
          await upload(...args)
        }}
        errorMessage={fileErrorMessage}
      />
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}

/**
 * « Assurance » (required): the proof (PDF, JPEG or PNG, 10 MB at most) and its expiry, proposed as
 * the next March 31 and editable (a date-only value: no timezone, CLAUDE.md §9).
 */
export function InsuranceStep({ ctx }: { ctx: StepContext }) {
  const fileId = sectionFileId(ctx.autosave.answered, 'insurance')
  const preview = useSignedFileUrl(fileId, { refresh: true })
  const dropzoneButton = useRef<HTMLButtonElement>(null)
  const schema = useMemo(() => insuranceSchema(ctx.today), [ctx.today])
  const { form, onSubmit, pending, alert, showRefusal } = useStepForm<InsuranceValues>(ctx, {
    section: 'insurance',
    schema,
    initial: (values) => ({ expires_on: typeof values.expires_on === 'string' ? values.expires_on : nextMarch31(ctx.today) }),
    check: () => (sectionFileId(ctx.autosave.answered, 'insurance') ? null : t(`${F}.insuranceRequired`)),
  })
  const upload = useSubmissionUpload(ctx, 'insurance', () => {
    // The expiry shown goes with the file when it is a valid date (the step's own rules).
    const expiry = schema.shape.expires_on.safeParse(form.getValues('expires_on'))
    return expiry.success ? { expires_on: expiry.data } : {}
  })
  const [removeError, setRemoveError] = useState<string | null>(null)

  return (
    <StepForm onSubmit={onSubmit} busy={pending} className="space-y-4">
      {fileId ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <FileText aria-hidden className="size-4 shrink-0 text-subtle" />
          <p className="text-sm text-foreground">{t(`${F}.insuranceReceived`)}</p>
          {preview.data && (
            <a href={preview.data.url} target="_blank" rel="noreferrer" className="text-sm text-link underline-offset-2 hover:underline">
              {t(`${F}.open`)}
            </a>
          )}
          <RemoveFileButton ctx={ctx} section="insurance" label={t(`${F}.removeInsurance`)} onRemoved={setRemoveError} focusAfter={dropzoneButton} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${F}.insuranceNone`)}</p>
      )}
      <FileDropzone
        buttonLabel={t(fileId ? `${F}.replaceInsurance` : `${F}.chooseInsurance`)}
        hint={t(`${F}.insuranceHint`)}
        accept={INSURANCE_LIMITS.mimeTypes}
        maxBytes={INSURANCE_LIMITS.maxBytes}
        maxImageSide={INSURANCE_LIMITS.maxImageSide}
        buttonRef={dropzoneButton}
        onUpload={async (...args) => {
          setRemoveError(null)
          try {
            await upload(...args)
          } catch (error) {
            // An expiry refused with the file goes under the date too.
            if (isRefusal(error)) showRefusal(error, false)
            throw error
          }
        }}
        errorMessage={fileErrorMessage}
      />
      <FormField label={t(`${F}.expiry`)} required help={t(`${F}.expiryHelp`)} error={form.formState.errors.expires_on?.message}>
        {(field) => <Input {...field} {...form.register('expires_on')} type="date" min={ctx.today} max="2100-12-31" className="max-w-[12rem] tabular" />}
      </FormField>
      <StepAlert message={alert ?? removeError} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}
