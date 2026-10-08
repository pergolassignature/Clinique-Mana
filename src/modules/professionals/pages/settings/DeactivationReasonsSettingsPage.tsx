import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { ReferenceListCard, type ReferenceColumn, type ReferenceFormProps } from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage } from '../../components/settings/ReferenceSettingsPage'

const R = 'modules.professionals.settings.deactivationReasons'

const yesNo = (value: boolean) => t(value ? `${R}.yes` : `${R}.no`)

const COLUMNS: ReferenceColumn<'deactivation_reasons'>[] = [
  // Secondary at phone width: the dialog shows them, and the row keeps room for its actions.
  { id: 'requires-note', header: t(`${R}.requiresNote`), cell: (row) => yesNo(row.requiresNote), className: 'max-sm:hidden' },
  { id: 'disables-account', header: t(`${R}.disablesAccount`), cell: (row) => yesNo(row.disablesAccount), className: 'max-sm:hidden' },
]

/** The two flags: a note asked at deactivation; the account closed with it. A failed save focuses the checkbox in error (`field.ref`). */
function ReasonFields({ form }: ReferenceFormProps<'deactivation_reasons'>) {
  return (
    <div className="grid gap-3">
      <Controller
        control={form.control}
        name="requiresNote"
        render={({ field, fieldState }) => (
          <CheckboxField
            ref={field.ref}
            label={t(`${R}.requiresNote`)}
            help={t(`${R}.requiresNoteHelp`)}
            error={fieldState.error?.message}
            checked={field.value}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <Controller
        control={form.control}
        name="disablesAccount"
        render={({ field, fieldState }) => (
          <CheckboxField
            ref={field.ref}
            label={t(`${R}.disablesAccount`)}
            help={t(`${R}.disablesAccountHelp`)}
            error={fieldState.error?.message}
            checked={field.value}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
    </div>
  )
}

/**
 * Paramètres → Raisons de désactivation: the reasons offered when a professional is deactivated,
 * in the order they are offered (reorderable). « Autre » is a system row: it cannot be archived
 * and always asks for a note.
 */
export function DeactivationReasonsSettingsPage() {
  return (
    <ReferenceSettingsPage title={t(`${R}.title`)} description={t(`${R}.description`)}>
      {({ catalog, usage, canEdit }) => (
        <ReferenceListCard
          kind="deactivation_reasons"
          title={t(`${R}.title`)}
          headingHidden
          rows={catalog.deactivationReasons}
          usage={usage}
          columns={COLUMNS}
          renderForm={(props) => <ReasonFields {...props} />}
          reorderable
          canEdit={canEdit}
          labels={{ add: t(`${R}.add`), createTitle: t(`${R}.createTitle`), editTitle: t(`${R}.editTitle`), systemNote: t(`${R}.system`) }}
        />
      )}
    </ReferenceSettingsPage>
  )
}
