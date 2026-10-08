import { t } from '@/i18n'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { ReferenceListCard, type ReferenceColumn, type ReferenceFormProps } from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage } from '../../components/settings/ReferenceSettingsPage'

const L = 'modules.professionals.settings.languages'

const COLUMNS: ReferenceColumn<'languages'>[] = [
  {
    id: 'code',
    header: t(`${L}.code`),
    cell: (row, { highlight }) => <span className="font-mono text-xs">{highlight(row.code)}</span>,
    searchText: (row) => row.code,
  },
]

/** « Code »: typed when adding (two letters, lower-cased on save), then fixed (the RPC refuses a change). */
function LanguageFields({ form, row }: ReferenceFormProps<'languages'>) {
  const adding = row === null
  return (
    <FormField
      label={t(`${L}.code`)}
      required={adding}
      readOnly={!adding}
      help={t(adding ? `${L}.codeHelp` : `${L}.codeLocked`)}
      error={form.formState.errors.code?.message}
    >
      {(field) => <Input {...field} {...form.register('code')} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4} className="max-w-[120px]" />}
    </FormField>
  )
}

/**
 * Paramètres → Langues: the consultation languages. French is offered by everyone (a system row:
 * it cannot be archived). A language's code is chosen when it is added and never changes.
 */
export function LanguagesSettingsPage() {
  return (
    <ReferenceSettingsPage title={t(`${L}.title`)} description={t(`${L}.description`)}>
      {({ catalog, usage, canEdit }) => (
        <ReferenceListCard
          kind="languages"
          title={t(`${L}.title`)}
          headingHidden
          rows={catalog.languages}
          usage={usage}
          columns={COLUMNS}
          renderForm={(props) => <LanguageFields {...props} />}
          canEdit={canEdit}
          labels={{ add: t(`${L}.add`), createTitle: t(`${L}.createTitle`), editTitle: t(`${L}.editTitle`), systemNote: t(`${L}.system`) }}
        />
      )}
    </ReferenceSettingsPage>
  )
}
