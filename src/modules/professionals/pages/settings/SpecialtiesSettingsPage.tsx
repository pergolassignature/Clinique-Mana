import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { ReferenceListCard, type ReferenceColumn, type ReferenceFormProps } from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage } from '../../components/settings/ReferenceSettingsPage'
import { agesLabel } from '../../lib/display'

const S = 'modules.professionals.settings.specialties'

// --- Clientèles ----------------------------------------------------------------------------------

const CLIENTELE_COLUMNS: ReferenceColumn<'clienteles'>[] = [
  {
    id: 'ages',
    header: t(`${S}.clienteles.ages`),
    // « 6 à 12 ans », « 65 ans et plus », « Sans limite d'âge » (couples, familles, groupes: muted).
    cell: (row) => <span className={cn('tabular', row.minAge === null && 'text-muted-foreground')}>{agesLabel(row)}</span>,
  },
]

const CLIENTELE_LABELS = {
  add: t(`${S}.clienteles.add`),
  createTitle: t(`${S}.clienteles.createTitle`),
  editTitle: t(`${S}.clienteles.editTitle`),
  systemNote: t(`${S}.clienteles.system`),
}

/** The age inputs: digits only (the schema reads 0–120), short. */
const AGE_INPUT = { autoComplete: 'off', inputMode: 'numeric', maxLength: 3, className: 'tabular max-w-[96px]' } as const

/**
 * « Âge minimum » and « Âge maximum » (empty = none). A system clientèle keeps its kind, as
 * `save_clientele` requires (matching relies on it): an age group keeps a minimum (marked required,
 * the schema says why if it is cleared), a clientèle without ages (couples, familles, groupes)
 * keeps none (both read-only). The database checks again.
 */
function ClienteleFields({ form, row }: ReferenceFormProps<'clienteles'>) {
  const { errors } = form.formState
  const systemAgeGroup = row?.isSystem === true && row.minAge !== null
  const systemNoAges = row?.isSystem === true && row.minAge === null
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <FormField
        label={t(`${S}.clienteles.minAge`)}
        required={systemAgeGroup}
        readOnly={systemNoAges}
        help={t(systemAgeGroup ? `${S}.clienteles.systemAgeGroup` : systemNoAges ? `${S}.clienteles.systemNoAges` : `${S}.clienteles.minAgeHelp`)}
        error={errors.minAge?.message}
      >
        {(field) => <Input {...field} {...form.register('minAge')} {...AGE_INPUT} />}
      </FormField>
      <FormField
        label={t(`${S}.clienteles.maxAge`)}
        readOnly={systemNoAges}
        help={systemNoAges ? undefined : t(`${S}.clienteles.maxAgeHelp`)}
        error={errors.maxAge?.message}
      >
        {(field) => <Input {...field} {...form.register('maxAge')} {...AGE_INPUT} />}
      </FormField>
    </div>
  )
}

// --- Approches -----------------------------------------------------------------------------------

const APPROACH_LABELS = {
  add: t(`${S}.approaches.add`),
  createTitle: t(`${S}.approaches.createTitle`),
  editTitle: t(`${S}.approaches.editTitle`),
}

// --- Page ----------------------------------------------------------------------------------------

/**
 * Paramètres → Spécialités: two lists on one page (each « Ajouter » outline, so the page has no
 * teal button at rest), both reorderable (the catalogue's order, which the record pickers follow;
 * a new row lands last).
 * - Clientèles: what matching filters on (the main person's age, or couple, family, group). The
 *   « Âges » column says the bounds in words. The 7 seeded clientèles are system rows: never
 *   archived, and they keep their kind (age group or not).
 * - Approches (table `specialties`): name only; they weigh in matching without excluding anyone.
 * « Utilisé par » counts professionals.
 */
export function SpecialtiesSettingsPage() {
  return (
    <ReferenceSettingsPage title={t(`${S}.title`)} description={t(`${S}.description`)}>
      {({ catalog, usage, canEdit }) => (
        <>
          <ReferenceListCard
            kind="clienteles"
            title={t(`${S}.clienteles.title`)}
            description={t(`${S}.clienteles.description`)}
            rows={catalog.clienteles}
            usage={usage}
            columns={CLIENTELE_COLUMNS}
            renderForm={(props) => <ClienteleFields {...props} />}
            reorderable
            canEdit={canEdit}
            addVariant="outline"
            labels={CLIENTELE_LABELS}
          />
          <ReferenceListCard
            kind="specialties"
            title={t(`${S}.approaches.title`)}
            description={t(`${S}.approaches.description`)}
            rows={catalog.specialties}
            usage={usage}
            reorderable
            canEdit={canEdit}
            addVariant="outline"
            labels={APPROACH_LABELS}
          />
        </>
      )}
    </ReferenceSettingsPage>
  )
}
