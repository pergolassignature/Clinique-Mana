import { useMemo, useState } from 'react'
import { useForm, type Path, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { t } from '@/i18n'
import { formatTaxNumber } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { MyProfessionalPrivate, SubmissionPrivateInput } from '../../api/self'
import { useSaveMyPrivate } from '../../hooks/use-my-submission'
import { taxBankSchema, toTaxBankValues, type TaxBankValues } from '../../schemas/questionnaire'
import { FIELD_GRID, FieldGroup, StepActions, StepAlert, StepForm } from './StepParts'
import { refusalTarget, type StepContext } from './use-step-form'

const T = 'modules.professionals.questionnaire.taxBank'
const FIELDS = ['business_number', 'gst_number', 'qst_number', 'bank_institution', 'bank_transit', 'bank_account', 'sin'] as const

/**
 * « Fiscalité et banque » (P4-38): never autosaved, never kept in a draft. « Continuer » sends the
 * step to `save_my_submission_private`, which encrypts the account and the SIN at once; the fields
 * then empty and the masks say what is stored (« Enregistré (•••• 4567) »). The plain numbers start
 * from the submission's, else the record's; the account and the SIN are never prefilled (blank
 * keeps what is stored). The SIN is asked only while the clinic collects it (P4-272).
 */
export function TaxBankStep({ ctx, onFilePrivate }: { ctx: StepContext; onFilePrivate: MyProfessionalPrivate | null }) {
  const { submission } = ctx
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
      const { field, message } = refusalTarget(error, FIELDS)
      if (field) form.setError(field as Path<TaxBankValues>, { message }, { shouldFocus: true })
      else setAlert(message)
    } finally {
      mutation.reset()
    }
  })

  return (
    <StepForm onSubmit={(event) => void submit(event)} busy={mutation.isPending} className="space-y-6">
      <p className="text-sm text-muted-foreground">{t(`${T}.privacy`)}</p>
      <FieldGroup title={t(`${T}.bankTitle`)} description={t(`${T}.bankHelp`)}>
        <div className="grid gap-3 min-[400px]:grid-cols-[minmax(0,6rem)_minmax(0,8rem)_minmax(0,1fr)]">
          <FormField label={t(`${T}.institution`)} required error={errors.bank_institution?.message}>
            {(field) => <Input {...field} {...register('bank_institution')} inputMode="numeric" maxLength={5} autoComplete="off" className="tabular" />}
          </FormField>
          <FormField label={t(`${T}.transit`)} required error={errors.bank_transit?.message}>
            {(field) => <Input {...field} {...register('bank_transit')} inputMode="numeric" maxLength={7} autoComplete="off" className="tabular" />}
          </FormField>
          <FormField
            label={t(`${T}.account`)}
            required={!accountKept}
            help={accountMask ? t(saved?.bankAccountLast4 ? `${T}.accountSaved` : `${T}.accountOnFile`, { last4: accountMask }) : undefined}
            error={errors.bank_account?.message}
          >
            {(field) => <Input {...field} {...register('bank_account')} inputMode="numeric" maxLength={20} autoComplete="off" className="tabular" />}
          </FormField>
        </div>
      </FieldGroup>
      <FieldGroup title={t(`${T}.taxTitle`)} description={t(`${T}.taxHelp`)}>
        <div className={FIELD_GRID}>
          <FormField label={t(`${T}.businessNumber`)} error={errors.business_number?.message}>
            {(field) => <Input {...field} {...register('business_number')} inputMode="numeric" maxLength={11} autoComplete="off" className="tabular" />}
          </FormField>
          <div className="hidden sm:block" aria-hidden />
          <FormField label={t(`${T}.gstNumber`)} error={errors.gst_number?.message}>
            {(field) => (
              <Input {...field} {...register('gst_number', regroupOnBlur(form, 'gst_number', regroupTaxNumber))} autoComplete="off" autoCapitalize="characters" className="tabular" />
            )}
          </FormField>
          <FormField label={t(`${T}.qstNumber`)} error={errors.qst_number?.message}>
            {(field) => (
              <Input {...field} {...register('qst_number', regroupOnBlur(form, 'qst_number', regroupTaxNumber))} autoComplete="off" autoCapitalize="characters" className="tabular" />
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
            {(field) => <Input {...field} {...register('sin')} inputMode="numeric" maxLength={11} autoComplete="off" className="tabular max-w-[12rem]" />}
          </FormField>
        </FieldGroup>
      )}
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={mutation.isPending} />
    </StepForm>
  )
}

/** What the schema gives: the RPC's values (null clears a plain number; null keeps the account and the SIN). */
type SubmissionPrivateInputValues = Record<(typeof FIELDS)[number], string | null>

/** A TPS / TVQ number regrouped once left (`123456789rt0001` → `123456789 RT 0001`), else as typed. */
const regroupTaxNumber = (value: string) => formatTaxNumber(value.trim())
