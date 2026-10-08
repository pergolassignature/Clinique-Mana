import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { SwitchField } from '@/shared/components/SwitchField'
import { FormField } from '@/shared/ui/form-field'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionalRecord } from '../../api/parse'
import { useSaveMatchingProfile } from '../../hooks/use-card-saves'
import { AVAILABILITY_PERIODS } from '../../lib/constants'
import { availabilitySchema, toAvailabilityFormValues } from '../../schemas/matching'
import { ProfessionalCard } from './ProfessionalCard'

const A = 'modules.professionals.record.matching.availability'

const availabilityValues = (record: ProfessionalRecord) => toAvailabilityFormValues(record.matchingProfile)

/**
 * « Disponibilités générales » (P4-4): the moments of the week, « Accepte de nouveaux clients »
 * and a note, saved together on the matching profile (column grants, `professionals.matching`).
 * A `ProfessionalCard` like the other record cards: the form follows the record without losing an
 * edit, ticks change the form only (decision #36), « Enregistrer » saves, a dirty card arms the
 * tab guard.
 */
export function AvailabilityCard({ readOnly }: { readOnly: boolean }) {
  return (
    <ProfessionalCard
      title={t(`${A}.title`)}
      description={t(`${A}.description`)}
      readOnly={readOnly}
      schema={availabilitySchema}
      toFormValues={availabilityValues}
      firstField="am"
      useSave={useSaveMatchingProfile}
    >
      {(form) => (
        <>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium text-foreground">{t(`${A}.periods`)}</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {AVAILABILITY_PERIODS.map((period) => (
                <Controller
                  key={period}
                  control={form.control}
                  name={period}
                  render={({ field }) => (
                    <CheckboxField
                      ref={field.ref}
                      label={t(`modules.professionals.periods.${period}`)}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              ))}
            </div>
          </fieldset>
          <Controller
            control={form.control}
            name="acceptingNewClients"
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
          <FormField label={t(`${A}.note`)} error={form.formState.errors.note?.message}>
            {(control) => <Textarea {...control} {...form.register('note')} placeholder={t(`${A}.notePlaceholder`)} maxLength={500} rows={3} className="min-h-16" />}
          </FormField>
        </>
      )}
    </ProfessionalCard>
  )
}
