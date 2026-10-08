import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { SwitchField } from '@/shared/components/SwitchField'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ProfessionalRecord } from '../../api/parse'
import { useSaveMatchingProfile } from '../../hooks/use-card-saves'
import { clientLimitsSchema, toClientLimitsFormValues } from '../../schemas/matching'
import { editingHelp } from './editing-help'
import { ProfessionalCard } from './ProfessionalCard'

const L = 'modules.professionals.record.matching.limits'

const limitsValues = (record: ProfessionalRecord) => toClientLimitsFormValues(record.matchingProfile)

/**
 * « Limites de clientèle » (P4-245): the youngest client age the professional takes (the website's
 * « Enfants (8+) », « Adolescents (14+) ») and « Femmes seulement » (« Femmes exclusivement »),
 * saved together on the matching profile (column grants, `professionals.matching`). Matching
 * applies both as hard filters (docs/modules/professionals.md, the Demandes contract).
 */
export function ClientLimitsCard({ readOnly }: { readOnly: boolean }) {
  return (
    <ProfessionalCard
      title={t(`${L}.title`)}
      description={t(`${L}.description`)}
      readOnly={readOnly}
      schema={clientLimitsSchema}
      toFormValues={limitsValues}
      firstField="minClientAge"
      useSave={useSaveMatchingProfile}
    >
      {(form) => (
        <>
          <FormField label={t(`${L}.minAge`)} help={editingHelp(readOnly, t(`${L}.minAgeHelp`))} error={form.formState.errors.minClientAge?.message}>
            {(control) => (
              <Input {...control} {...form.register('minClientAge')} autoComplete="off" inputMode="numeric" maxLength={3} className="tabular max-w-[96px]" />
            )}
          </FormField>
          <Controller
            control={form.control}
            name="womenOnly"
            render={({ field }) => (
              <SwitchField
                ref={field.ref}
                label={t(`${L}.womenOnly`)}
                help={t(`${L}.womenOnlyHelp`)}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        </>
      )}
    </ProfessionalCard>
  )
}
