import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { SwitchField } from '@/shared/components/SwitchField'
import { FormField } from '@/shared/ui/form-field'
import { Textarea } from '@/shared/ui/textarea'
import { AVAILABILITY_PERIODS } from '../../lib/constants'
import { availabilitySchema, toAvailabilityValues, type AvailabilityValues } from '../../schemas/questionnaire'
import { FieldGroup, StepActions, StepAlert, StepForm } from './StepParts'
import { useStepForm, type StepContext } from './use-step-form'

const A = 'modules.professionals.questionnaire.availability'

/**
 * « Disponibilités générales »: the moments of the week in their fixed order (« Fin de journée »
 * included, P4-250), whether new clients are welcome, and a note. Nothing is required; continuing
 * saves the step once, so the clinic knows it was seen (P4-173).
 */
export function AvailabilityStep({ ctx }: { ctx: StepContext }) {
  const { form, onSubmit, pending, alert } = useStepForm<AvailabilityValues>(ctx, {
    section: 'availability',
    schema: availabilitySchema,
    initial: toAvailabilityValues,
  })
  return (
    <StepForm onSubmit={onSubmit} busy={pending} className="space-y-6">
      <FieldGroup title={t(`${A}.periods`)} description={t(`${A}.periodsHelp`)}>
        <Controller
          control={form.control}
          name="availability_periods"
          render={({ field }) => (
            <div className="grid grid-cols-1 gap-y-2.5 min-[380px]:grid-cols-2 sm:grid-cols-3">
              {AVAILABILITY_PERIODS.map((period, index) => (
                <CheckboxField
                  key={period}
                  ref={index === 0 ? field.ref : undefined}
                  label={t(`modules.professionals.periods.${period}`)}
                  checked={field.value.includes(period)}
                  onCheckedChange={(checked) =>
                    field.onChange(checked ? [...field.value, period] : field.value.filter((p) => p !== period))
                  }
                  onBlur={field.onBlur}
                />
              ))}
            </div>
          )}
        />
      </FieldGroup>
      <Controller
        control={form.control}
        name="accepting_new_clients"
        render={({ field }) => (
          <SwitchField
            ref={field.ref}
            label={t(`${A}.accepting`)}
            help={t(`${A}.acceptingHelp`)}
            checked={field.value}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField label={t(`${A}.note`)} help={t(`${A}.noteHelp`)} error={form.formState.errors.availability_note?.message}>
        {(control) => <Textarea {...control} {...form.register('availability_note')} placeholder={t(`${A}.notePlaceholder`)} maxLength={500} rows={3} className="min-h-16" />}
      </FormField>
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}
