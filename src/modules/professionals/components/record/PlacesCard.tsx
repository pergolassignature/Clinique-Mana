import { t } from '@/i18n'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ProfessionalRecord } from '../../api/parse'
import { useSaveMatchingProfile } from '../../hooks/use-card-saves'
import { shortDate } from '../../lib/onboarding'
import { placesSchema, toPlacesFormValues } from '../../schemas/matching'
import { editingHelp } from './editing-help'
import { ProfessionalCard } from './ProfessionalCard'
import { useRecordData } from './record-context'

const P = 'modules.professionals.record.matching.places'

const placesValues = (record: ProfessionalRecord) => toPlacesFormValues(record.matchingProfile)

/**
 * « Places offertes » (P4-382): how many new clients the professional can take, empty when the
 * clinic does not track it. Saved alone on the matching profile (column grant,
 * `professionals.matching`); the database stamps the day the number changes, shown under the
 * field (« Indiqué le 8 oct. »). The places left are Demandes' to compute. Staff only: not in the
 * provider's questionnaire (P4-383).
 */
export function PlacesCard({ readOnly }: { readOnly: boolean }) {
  const { record } = useRecordData()
  const { newClientPlaces, newClientPlacesSetAt } = record.matchingProfile
  const status =
    newClientPlaces === null || newClientPlacesSetAt === null
      ? t(`${P}.notTracked`)
      : t(`${P}.setOn`, { date: shortDate(newClientPlacesSetAt, Date.now()) })
  return (
    <ProfessionalCard
      title={t(`${P}.title`)}
      description={t(`${P}.description`)}
      readOnly={readOnly}
      schema={placesSchema}
      toFormValues={placesValues}
      firstField="newClientPlaces"
      useSave={useSaveMatchingProfile}
    >
      {(form) => (
        <>
          <FormField
            label={t(`${P}.label`)}
            help={editingHelp(readOnly, t(`${P}.help`, { firstName: record.professional.firstName }))}
            error={form.formState.errors.newClientPlaces?.message}
          >
            {(control) => (
              <Input {...control} {...form.register('newClientPlaces')} autoComplete="off" inputMode="numeric" maxLength={2} className="tabular max-w-[96px]" />
            )}
          </FormField>
          <p className="text-sm text-muted-foreground">{status}</p>
        </>
      )}
    </ProfessionalCard>
  )
}
