import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { addressAutofill } from '@/core/address/autofill'
import { AddressAutocomplete } from '@/core/address/components/AddressAutocomplete'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import { formatPostalCode, regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { cn } from '@/shared/lib/utils'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { personalSchema, toPersonalValues, type PersonalValues } from '../../schemas/questionnaire'
import { FIELD_GRID, StepActions, StepAlert, StepForm } from './StepParts'
import { useStepForm, type StepContext } from './use-step-form'

const P = 'modules.professionals.questionnaire.personal'
/** The address fields, for the Google suggestions' autofill (P4-222). */
const ADDRESS_FIELDS = { line1: 'address_line1', line2: 'address_line2', city: 'city', province: 'province', postalCode: 'postal_code' } as const

/**
 * « Renseignements personnels »: the name and the login email as the file holds them (read-only:
 * the clinic corrects a name, « Mon compte » the email), the phone and the home address (Google
 * suggestions with manual override, « Appartement ou bureau » never overwritten, P4-220–P4-222).
 * Everything here is required by the contract (P4-173) but line 2.
 */
export function PersonalStep({ ctx }: { ctx: StepContext }) {
  const { form, onSubmit, pending, alert } = useStepForm<PersonalValues>(ctx, {
    section: 'personal',
    schema: personalSchema,
    initial: toPersonalValues,
  })
  const { register, control, formState: { errors } } = form
  const { firstName, lastName, email } = ctx.submission.professional

  return (
    <StepForm onSubmit={onSubmit} busy={pending}>
      <div className={FIELD_GRID}>
        <FormField label={t(`${P}.name`)} readOnly help={t(`${P}.nameHelp`)}>
          {(field) => <Input {...field} value={`${firstName} ${lastName}`} />}
        </FormField>
        <FormField label={t(`${P}.loginEmail`)} readOnly help={t(`${P}.loginEmailHelp`)}>
          {(field) => <Input {...field} value={email} />}
        </FormField>
        <FormField label={t(`${P}.phone`)} required help={t(`${P}.phoneHelp`)} error={errors.personal_phone?.message}>
          {(field) => (
            <Input {...field} {...register('personal_phone', regroupOnBlur(form, 'personal_phone', regroupPhone))} type="tel" inputMode="tel" autoComplete="tel" />
          )}
        </FormField>
        <div className="hidden sm:block" aria-hidden />
        <div className="sm:col-span-2">
          <FormField label={t(`${P}.addressLine1`)} required error={errors.address_line1?.message}>
            {(field) => (
              <AddressAutocomplete
                {...field}
                {...register('address_line1')}
                autofill={addressAutofill(form, ADDRESS_FIELDS)}
                placeholder={t('address.line1Placeholder')}
              />
            )}
          </FormField>
        </div>
        <FormField label={t(`${P}.addressLine2`)} error={errors.address_line2?.message}>
          {(field) => <Input {...field} {...register('address_line2')} placeholder={t('address.line2Placeholder')} autoComplete="off" />}
        </FormField>
        <FormField label={t(`${P}.city`)} required error={errors.city?.message}>
          {(field) => <Input {...field} {...register('city')} autoComplete="off" />}
        </FormField>
        <FormField label={t(`${P}.province`)} required error={errors.province?.message}>
          {(field) => (
            <Controller
              control={control}
              name="province"
              render={({ field: province }) => (
                <Select {...field} {...province} autoComplete="off">
                  {PROVINCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
        <FormField label={t(`${P}.postalCode`)} required error={errors.postal_code?.message}>
          {(field) => (
            <Input
              {...field}
              {...register('postal_code', regroupOnBlur(form, 'postal_code', (v) => formatPostalCode(v.trim())))}
              autoComplete="off"
              autoCapitalize="characters"
              className={cn('max-w-[10rem]')}
            />
          )}
        </FormField>
      </div>
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}
