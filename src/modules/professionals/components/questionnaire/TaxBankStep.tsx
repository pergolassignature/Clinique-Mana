import { useMemo, useState } from 'react'
import { useForm, type Path, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { t } from '@/i18n'
import { moduleErrorMessage, rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { formatTaxNumber } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { SENSITIVE_INPUT_PROPS } from '@/shared/lib/sensitive-input'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { SubmissionPrivateInput } from '../../api/self'
import { isRefusal, isTransient, reportQuestionnaireError, useSaveMyPrivate } from '../../hooks/use-my-submission'
import { taxBankSchema, toTaxBankValues, type TaxBankValues } from '../../schemas/questionnaire'
import { FIELD_GRID, FieldGroup, OnFileError, StepActions, StepAlert, StepForm } from './StepParts'
import { refusalTarget, type StepContext } from './use-step-form'

const T = 'modules.professionals.questionnaire.taxBank'
const FIELDS = ['business_number', 'gst_number', 'qst_number', 'bank_institution', 'bank_transit', 'bank_account', 'sin'] as const

/**
 * « Fiscalité et banque » (P4-38): never autosaved, never kept in a draft. « Continuer » sends the
 * step to `save_my_submission_private`, which encrypts the account and the SIN at once; the fields
 * then empty and the masks say what is stored (« Enregistré (•••• 4567) »). The plain numbers start
 * from the submission's, else the record's; the account and the SIN are never prefilled (blank
 * keeps what is stored). The SIN is asked only while the clinic collects it (P4-272). Every field
 * keeps the browser, password managers, spell check and translators away (`SENSITIVE_INPUT_PROPS`).
 * When the record's data cannot be read, the step says so with « Réessayer »; without a saved row
 * it shows no form meanwhile (blank plain numbers would clear the record's on approval, P4-333).
 */
export function TaxBankStep({ ctx }: { ctx: StepContext }) {
  const { submission, onFile } = ctx
  if (onFile.failed && !submission.private) {
    return (
      <div className="space-y-4">
        <OnFileError onFile={onFile} />
        <StepActions back={ctx.back} pending={false} inactive />
      </div>
    )
  }
  return <TaxBankForm ctx={ctx} />
}

function TaxBankForm({ ctx }: { ctx: StepContext }) {
  const { submission, onFile } = ctx
  const onFilePrivate = onFile.data
  const saved = submission.private
  const accountMask = saved?.bankAccountLast4 ?? (submission.onFile.hasBankAccount ? (onFilePrivate?.bankAccountLast4 ?? null) : null)
  const sinMask = saved?.sinLast3 ?? (submission.onFile.hasSin ? (onFilePrivate?.sinLast3 ?? null) : null)
  const accountKept = saved?.bankAccountLast4 != null || submission.onFile.hasBankAccount
  const sinKept = saved?.sinLast3 != null || submission.onFile.hasSin
  const schema = useMemo(
    () => taxBankSchema({ accountOnFile: accountKept, sinOnFile: sinKept, collectSin: submission.collectSin }),
    [accountKept, sinKept, submission.collectSin],
  )
  const form = useForm<TaxBankValues>({
    resolver: zodResolver(schema as never) as unknown as Resolver<TaxBankValues>,
    defaultValues: toTaxBankValues(saved ?? onFilePrivate),
    mode: 'onTouched',
  })
  const mutation = useSaveMyPrivate()
  const [alert, setAlert] = useState<string | null>(null)
  const { register, formState: { errors, isDirty } } = form
  // Typed numbers are never autosaved: leaving with them asks first.
  useUnsavedChanges(isDirty)

  const submit = form.handleSubmit(async (values) => {
    const parsed = values as unknown as SubmissionPrivateInputValues
    setAlert(null)
    // Nothing typed and already saved for this submission: nothing to send.
    if (!isDirty && saved) return ctx.next()
    try {
      await mutation.mutateAsync({
        businessNumber: parsed.business_number,
        gstNumber: parsed.gst_number,
        qstNumber: parsed.qst_number,
        bankInstitution: parsed.bank_institution,
        bankTransit: parsed.bank_transit,
        bankAccount: parsed.bank_account,
        sin: parsed.sin,
      } satisfies SubmissionPrivateInput)
      // The secrets leave the form at once; the masks now say what is stored.
      form.reset({ ...form.getValues(), bank_account: '', sin: '' })
      ctx.next()
    } catch (error) {
      if (isRefusal(error) && ctx.autosave.pageRefusal(rpcErrorHint(error), moduleErrorMessage(error, ''))) return
      // Reported with ids and codes only: this RPC carries the account and the SIN.
      reportQuestionnaireError('save_my_submission_private', error, submission.id)
      const { field, message } = refusalTarget(error, FIELDS)
      if (field) form.setError(field as Path<TaxBankValues>, { message }, { shouldFocus: true })
      else setAlert(isRefusal(error) ? message : privateErrorText(error))
    } finally {
      mutation.reset()
    }
  })

  return (
    <StepForm onSubmit={(event) => void submit(event)} busy={mutation.isPending} className="space-y-6">
      <p className="text-sm text-muted-foreground">{t(`${T}.privacy`)}</p>
      {onFile.failed && <OnFileError onFile={onFile} />}
      <FieldGroup title={t(`${T}.bankTitle`)} description={t(`${T}.bankHelp`)}>
        <div className="grid gap-3 min-[400px]:grid-cols-[minmax(0,6rem)_minmax(0,8rem)_minmax(0,1fr)]">
          <FormField label={t(`${T}.institution`)} required error={errors.bank_institution?.message}>
            {(field) => <Input {...field} {...register('bank_institution')} inputMode="numeric" maxLength={5} {...SENSITIVE_INPUT_PROPS} className="tabular" />}
          </FormField>
          <FormField label={t(`${T}.transit`)} required error={errors.bank_transit?.message}>
            {(field) => <Input {...field} {...register('bank_transit')} inputMode="numeric" maxLength={7} {...SENSITIVE_INPUT_PROPS} className="tabular" />}
          </FormField>
          <FormField
            label={t(`${T}.account`)}
            required={!accountKept}
            help={accountMask ? t(saved?.bankAccountLast4 ? `${T}.accountSaved` : `${T}.accountOnFile`, { last4: accountMask }) : undefined}
            error={errors.bank_account?.message}
          >
            {(field) => <Input {...field} {...register('bank_account')} inputMode="numeric" maxLength={20} {...SENSITIVE_INPUT_PROPS} className="tabular" />}
          </FormField>
        </div>
      </FieldGroup>
      <FieldGroup title={t(`${T}.taxTitle`)} description={t(`${T}.taxHelp`)}>
        <div className={FIELD_GRID}>
          <FormField label={t(`${T}.businessNumber`)} error={errors.business_number?.message}>
            {(field) => <Input {...field} {...register('business_number')} inputMode="numeric" maxLength={11} {...SENSITIVE_INPUT_PROPS} className="tabular" />}
          </FormField>
          <div className="hidden sm:block" aria-hidden />
          <FormField label={t(`${T}.gstNumber`)} error={errors.gst_number?.message}>
            {(field) => (
              <Input {...field} {...register('gst_number', regroupOnBlur(form, 'gst_number', regroupTaxNumber))} {...SENSITIVE_INPUT_PROPS} autoCapitalize="characters" className="tabular" />
            )}
          </FormField>
          <FormField label={t(`${T}.qstNumber`)} error={errors.qst_number?.message}>
            {(field) => (
              <Input {...field} {...register('qst_number', regroupOnBlur(form, 'qst_number', regroupTaxNumber))} {...SENSITIVE_INPUT_PROPS} autoCapitalize="characters" className="tabular" />
            )}
          </FormField>
        </div>
      </FieldGroup>
      {submission.collectSin && (
        <FieldGroup title={t(`${T}.sinTitle`)} description={t(`${T}.sinHelp`)}>
          <FormField
            label={t(`${T}.sin`)}
            required={!sinKept}
            help={sinMask ? t(saved?.sinLast3 ? `${T}.sinSaved` : `${T}.sinOnFile`, { last3: sinMask }) : undefined}
            error={errors.sin?.message}
          >
            {(field) => <Input {...field} {...register('sin')} inputMode="numeric" maxLength={11} {...SENSITIVE_INPUT_PROPS} className="tabular max-w-[12rem]" />}
          </FormField>
        </FieldGroup>
      )}
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={mutation.isPending} />
    </StepForm>
  )
}

/** A failure that is not a refusal: the connection, the permission, or « n'ont pas pu être enregistrés » (reported). */
function privateErrorText(error: unknown): string {
  if (isTransient(error)) return t(`${T}.errors.network`)
  if (rpcErrorCode(error) === '42501') return t('common.errors.forbidden')
  return t(`${T}.errors.failed`)
}

/** What the schema gives: the RPC's values (null clears a plain number; null keeps the account and the SIN). */
type SubmissionPrivateInputValues = Record<(typeof FIELDS)[number], string | null>

/** A TPS / TVQ number regrouped once left (`123456789rt0001` → `123456789 RT 0001`), else as typed. */
const regroupTaxNumber = (value: string) => formatTaxNumber(value.trim())
