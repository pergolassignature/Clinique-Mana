import { useId } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { FormField, type FieldControlProps } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { ReferenceListCard, type ReferenceColumn, type ReferenceFormProps } from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage } from '../../components/settings/ReferenceSettingsPage'
import { agesLabel } from '../../lib/display'

const S = 'modules.professionals.settings.clienteles'

// --- Clientèles ----------------------------------------------------------------------------------

const CLIENTELE_COLUMNS: ReferenceColumn<'clienteles'>[] = [
  {
    id: 'ages',
    header: t(`${S}.ages`),
    // « 0 à 12 ans », « 18 ans et plus », « Sans âge » (couples, familles, parents: muted like the lists' « — »).
    cell: (row) => <span className={cn('tabular', row.minAge === null && 'text-muted-foreground')}>{agesLabel(row)}</span>,
  },
]

const CLIENTELE_LABELS = {
  add: t(`${S}.add`),
  createTitle: t(`${S}.createTitle`),
  editTitle: t(`${S}.editTitle`),
  systemNote: t(`${S}.system`),
}

/** The age inputs: digits only (the schema reads 0–120), short. */
const AGE_INPUT = { autoComplete: 'off', inputMode: 'numeric', maxLength: 3, className: 'tabular max-w-[96px]' } as const

/**
 * « Âge minimum » and « Âge maximum » (empty = none). A system clientèle keeps its kind, as
 * `save_clientele` requires (matching relies on it): an age group keeps a minimum (marked required,
 * the schema says why if it is cleared), a clientèle without ages (couples, familles)
 * keeps none: both read-only, under one help line that describes both. The database checks again.
 */
function ClienteleFields({ form, row }: ReferenceFormProps<'clienteles'>) {
  const { errors } = form.formState
  const lockedHelpId = useId()
  const systemAgeGroup = row?.isSystem === true && row.minAge !== null
  const systemNoAges = row?.isSystem === true && row.minAge === null
  /** The locked fields also read the shared help line. */
  const describedBy = (field: FieldControlProps) =>
    systemNoAges ? [field['aria-describedby'], lockedHelpId].filter(Boolean).join(' ') : field['aria-describedby']
  return (
    <div className="space-y-1">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <FormField
          label={t(`${S}.minAge`)}
          required={systemAgeGroup}
          // Never `false`: a surrounding read-only context stays read-only.
          readOnly={systemNoAges || undefined}
          help={systemNoAges ? undefined : t(systemAgeGroup ? `${S}.systemAgeGroup` : `${S}.minAgeHelp`)}
          error={errors.minAge?.message}
        >
          {(field) => <Input {...field} aria-describedby={describedBy(field)} {...form.register('minAge')} {...AGE_INPUT} />}
        </FormField>
        <FormField
          label={t(`${S}.maxAge`)}
          readOnly={systemNoAges || undefined}
          help={systemNoAges ? undefined : t(`${S}.maxAgeHelp`)}
          error={errors.maxAge?.message}
        >
          {(field) => <Input {...field} aria-describedby={describedBy(field)} {...form.register('maxAge')} {...AGE_INPUT} />}
        </FormField>
      </div>
      {systemNoAges && (
        <p id={lockedHelpId} className="text-xs text-muted-foreground">
          {t(`${S}.systemNoAges`)}
        </p>
      )}
    </div>
  )
}

// --- Page ----------------------------------------------------------------------------------------

/**
 * Paramètres → Clientèles: who the professionals see, what matching filters on (the main
 * person's age, or couple, family, parents…). The « Âges » column says the bounds in words. The
 * seed is the clinic's website (P4-244); the five clientèles matching relies on (Enfants,
 * Adolescents, Adultes, Couples, Familles) are system rows: never archived, and they keep their
 * kind (age group or not). The list is reorderable (the catalogue's order, which the record's
 * picker follows; a new row lands last). « Utilisé par » counts professionals. The youngest age a
 * professional takes and « femmes seulement » are on each record (Jumelage, P4-245). There are no
 * approaches (P4-240).
 */
export function ClientelesSettingsPage() {
  return (
    <ReferenceSettingsPage title={t(`${S}.title`)} description={t(`${S}.description`)}>
      {({ catalog, usage, canEdit }) => (
        <ReferenceListCard
          kind="clienteles"
          title={t(`${S}.title`)}
          headingHidden
          rows={catalog.clienteles}
          usage={usage}
          columns={CLIENTELE_COLUMNS}
          renderForm={(props) => <ClienteleFields {...props} />}
          reorderable
          canEdit={canEdit}
          labels={CLIENTELE_LABELS}
        />
      )}
    </ReferenceSettingsPage>
  )
}
