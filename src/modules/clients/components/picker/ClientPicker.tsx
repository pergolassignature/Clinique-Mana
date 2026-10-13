import { useId, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useClientSearch } from '../../hooks/use-clients'
import { clientNumberLabel } from '../../lib/display'
import { CreateClientDialog } from '../list/CreateClientDialog'

const K = 'modules.clients.picker'

/** The file chosen or created, as the picker knows it (the caller reads more through its own RPCs). */
export interface PickedClient {
  id: string
  name: string
  clientNumber: number
}

export interface ClientPickerProps {
  /** An existing file was chosen (from the search, or « Choisir ce dossier » in the duplicate panel). */
  onSelect: (clientId: string, client: PickedClient | null) => void
  /** A new file was created through « Nouveau client »; defaults to `onSelect`. */
  onCreated?: (clientId: string) => void
  /** The field's label; « Client » by default. */
  label?: string
  /** Files never offered (the one already chosen, the person herself…). */
  excludeIds?: readonly string[]
  /** What « Nouveau client » starts with (the name and contacts the caller already has). */
  initialValues?: { firstName?: string; lastName?: string; email?: string; mobile?: string }
}

/**
 * The client picker other modules use (Demandes' intake, Rendez-vous; exported lazily by
 * `@/modules/clients`): a search over `search_clients` (name, email, number, phone; staff see the
 * clinic's files, a professional her linked clients only; never merged or anonymised files), each
 * result a button, then « Nouveau client » (clients.manage) with the live duplicate check, whose
 * similar files can be chosen instead of creating one. It returns ids only and never navigates.
 */
export function ClientPicker({ onSelect, onCreated, label, excludeIds = [], initialValues }: ClientPickerProps) {
  const { can } = useAccess()
  const [query, setQuery] = useState('')
  const search = useClientSearch(useDebouncedValue(query, 250))
  const resultsId = useId()
  const results = (search.data ?? []).filter((row) => !excludeIds.includes(row.id))
  const searching = query.trim().length >= 2
  return (
    <div className="space-y-2">
      <FormField label={label ?? t(`${K}.label`)} width="full" help={t(`${K}.help`)}>
        {(field) => (
          <Input
            {...field}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Inside the caller's form: Enter searches, it never submits that form.
            onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
            autoComplete="off"
            aria-controls={searching ? resultsId : undefined}
          />
        )}
      </FormField>
      {searching && (
        <ul id={resultsId} aria-label={t(`${K}.results`)} className="max-h-60 space-y-1 overflow-y-auto">
          {search.isError ? (
            <li className="text-sm text-destructive">{t(`${K}.searchError`)}</li>
          ) : results.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t(search.isFetching ? 'common.loading' : `${K}.noResult`)}</li>
          ) : (
            results.map((row) => (
              <li key={row.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start py-1.5 text-left"
                  onClick={() => onSelect(row.id, { id: row.id, name: row.name, clientNumber: row.clientNumber })}
                >
                  <span>
                    <span className="font-medium">{row.name}</span> · <span className="tabular text-muted-foreground">{clientNumberLabel(row.clientNumber)}</span>
                    {row.email && <span className="block text-xs text-muted-foreground">{row.email}</span>}
                  </span>
                </Button>
              </li>
            ))
          )}
        </ul>
      )}
      {can('clients.manage') && (
        <CreateClientDialog
          variant="outline"
          initialValues={initialValues}
          onCreated={onCreated ?? ((id) => onSelect(id, null))}
          onPickExisting={(id) => onSelect(id, null)}
          excludeIds={excludeIds}
        />
      )}
    </div>
  )
}
