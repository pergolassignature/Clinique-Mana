import { useEffect, useMemo } from 'react'
import { t } from '@/i18n'
import type { BankDetails } from '@/core/settings/bank/api'
import { useSetBankDetails } from '@/core/settings/bank/hooks'
import { bankDetailsSchema, toBankFormValues } from '@/core/settings/bank/schemas'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'

interface BankDetailsFormProps {
  /** The stored details, or null for the first entry (the account is then required). */
  details: BankDetails | null
  /** Back to the display (or the empty state): after « Annuler » and after a save. */
  onClose: () => void
}

/**
 * Adds or edits the bank details. The account number is never pre-filled: left empty it keeps the
 * stored one (« Inchangé »), so changing the transit alone never needs it. Opens with focus on the
 * first field; « Annuler » closes it, edits or not; a save closes it once the masked details are
 * fresh, and the fields are read-only meanwhile. The unsaved-changes guard is armed while it has edits.
 */
export function BankDetailsForm({ details, onClose }: BankDetailsFormProps) {
  const hasStoredAccount = details !== null
  const schema = useMemo(() => bankDetailsSchema(hasStoredAccount), [hasStoredAccount])
  const values = useMemo(() => toBankFormValues(details), [details])
  const { form, handleSave } = useSettingsForm({ schema, values })
  const mutation = useSetBankDetails()
  const {
    register,
    formState: { errors, isDirty },
  } = form
  useUnsavedChanges(isDirty)

  useEffect(() => form.setFocus('institution'), [form])

  // `mutate` with a per-call onSuccess: the hook's own callbacks show the toasts, and a failed save
  // keeps the form open with what was typed.
  const onSubmit = handleSave((input) => mutation.mutate(input, { onSuccess: onClose }))

  return (
    <SettingsCard
      title={t('settings.bank.title')}
      pending={mutation.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={onClose} dirty={isDirty} pending={mutation.isPending} cancelCloses />}
    >
      {/* Read-only while saving: the form closes on success, so anything typed meanwhile would be lost. */}
      <FieldsReadOnlyContext.Provider value={mutation.isPending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('settings.bank.fields.institution')} help={t('settings.bank.fields.institutionHelp')} required error={errors.institution?.message}>
            {(field) => <Input {...field} {...register('institution')} inputMode="numeric" autoComplete="off" />}
          </FormField>
          <FormField label={t('settings.bank.fields.transit')} help={t('settings.bank.fields.transitHelp')} required error={errors.transit?.message}>
            {(field) => <Input {...field} {...register('transit')} inputMode="numeric" autoComplete="off" />}
          </FormField>
          <FormField
            label={t('settings.bank.fields.account')}
            help={details ? t('settings.bank.fields.accountKeepHelp', { last4: details.account_last4 }) : t('settings.bank.fields.accountHelp')}
            required={!hasStoredAccount}
            error={errors.account?.message}
          >
            {(field) => (
              <Input
                {...field}
                {...register('account')}
                inputMode="numeric"
                autoComplete="off"
                // Password managers ignore autocomplete="off": keep them from saving or filling it.
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
                spellCheck={false}
                placeholder={hasStoredAccount ? t('settings.bank.fields.accountUnchanged') : undefined}
              />
            )}
          </FormField>
          <FormField label={t('settings.bank.fields.email')} help={t('settings.bank.fields.emailHelp')} error={errors.etransferEmail?.message}>
            {(field) => <Input {...field} {...register('etransferEmail')} type="email" autoComplete="off" spellCheck={false} />}
          </FormField>
        </div>
      </FieldsReadOnlyContext.Provider>
    </SettingsCard>
  )
}
