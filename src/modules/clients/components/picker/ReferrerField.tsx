import { useId, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { t } from '@/i18n'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useFieldReadOnly } from '@/shared/ui/read-only-context'
import { useClientSearch } from '../../hooks/use-clients'
import { clientPath } from '../../lib/constants'
import { clientNumberLabel, referrerLabel, type ReferrerShown } from '../../lib/display'

const K = 'modules.clients.referrer'

/** « Référé par »: a file of the clinic (its id), or a typed name; never both (CL-19). */
export interface ReferrerValue {
  clientId: string
  text: string
}


interface ReferrerFieldProps {
  label: string
  value: ReferrerValue
  onChange: (value: ReferrerValue) => void
  onBlur?: () => void
  /** The stored link as the record reads it (its number and name), when the value is that file. */
  known?: ReferrerShown | null
  /** The file being edited: never offered. */
  excludeId?: string
  error?: string
  readOnly?: boolean
}

/**
 * « Référé par » (CL-19): type to search the clinic's files (`search_clients`, as the other pickers:
 * 2 characters, a pause, never a merged or anonymised file); choose one and the field shows
 * « CLI-000042 · Nom », a link to the record (a new tab: the form stays as it is) and « Retirer le
 * dossier »; or keep what was typed as the name (« Utiliser « … » comme texte », or just leave the
 * field). The list is an ARIA combobox: ↓/↑, Entrée, Échap (inside a sheet, the first Échap closes
 * the list: `keepOpenForCombobox`).
 */
export function ReferrerField({ label, value, onChange, onBlur, known, excludeId, error, readOnly: readOnlyProp }: ReferrerFieldProps) {
  const readOnly = useFieldReadOnly(readOnlyProp)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  /** The file chosen here (the record's `known` describes the stored one). */
  const [picked, setPicked] = useState<ReferrerShown | null>(null)
  const query = value.clientId ? '' : value.text
  const search = useClientSearch(useDebouncedValue(open ? query : '', 250))
  const listId = useId()
  const optionId = (index: number) => `${listId}-${index}`
  const results = (search.data ?? []).filter((row) => row.id !== excludeId)
  const searching = query.trim().length >= 2
  const visible = open && searching && !readOnly
  // The results, then « Utiliser « … » comme texte ».
  const optionCount = results.length + 1

  const shown: ReferrerShown | null = value.clientId
    ? picked?.id === value.clientId
      ? picked
      : known?.id === value.clientId
        ? known
        : null
    : null

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const choose = (index: number) => {
    const row = results[index]
    if (row) {
      setPicked({ id: row.id, clientNumber: row.clientNumber, name: row.name, anonymized: false })
      onChange({ clientId: row.id, text: '' })
    }
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Before anything: inside a sheet, Échap arrives already marked handled (keepOpenForCombobox).
    if (event.key === 'Escape') {
      if (!visible) return
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'Enter') {
      // Inside the caller's form: Entrée chooses, it never submits.
      if (!visible) return
      event.preventDefault()
      if (active >= 0) choose(active)
      else close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!searching) return
      event.preventDefault()
      if (!visible) {
        setOpen(true)
        return
      }
      setActive((i) => (event.key === 'ArrowDown' ? (i + 1) % optionCount : i <= 0 ? optionCount - 1 : i - 1))
      return
    }
    if (event.key === 'Tab') close()
  }

  return (
    <FormField label={label} width="full" help={readOnly || value.clientId ? undefined : t(`${K}.help`)} error={error} readOnly={readOnly}>
      {(field) =>
        value.clientId ? (
          <div
            id={field.id}
            role="group"
            aria-label={label}
            aria-describedby={field['aria-describedby']}
            className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-card pl-3 pr-1 text-sm"
          >
            {shown ? (
              <Link
                to={clientPath(shown.id)}
                target="_blank"
                rel="noopener"
                className={cn('min-w-0 flex-1 truncate text-link hover:underline', focusRing)}
                title={t(`${K}.open`)}
              >
                {referrerLabel(shown)}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{t(`${K}.linked`)}</span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  setPicked(null)
                  onChange({ clientId: '', text: '' })
                }}
                aria-label={t(`${K}.clear`)}
                title={t(`${K}.clear`)}
                className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-ink/5 hover:text-foreground', focusRing)}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="relative">
            <Input
              {...field}
              role={readOnly ? undefined : 'combobox'}
              aria-autocomplete={readOnly ? undefined : 'list'}
              aria-expanded={readOnly ? undefined : visible}
              aria-controls={visible ? listId : undefined}
              aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
              value={value.text}
              onChange={(event) => {
                onChange({ clientId: '', text: event.target.value })
                setOpen(true)
                setActive(-1)
              }}
              onKeyDown={onKeyDown}
              onBlur={() => {
                close()
                onBlur?.()
              }}
              autoComplete="off"
            />
            {visible && (
              // The list never takes focus: the input keeps it while the mouse chooses.
              <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border border-border bg-card p-1 shadow-medium" onMouseDown={(event) => event.preventDefault()}>
                <ul id={listId} role="listbox" aria-label={t(`${K}.results`)} className="max-h-72 overflow-y-auto">
                  {search.isError ? (
                    <li role="presentation" className="px-2 py-1.5 text-sm text-destructive">
                      {t('modules.clients.picker.searchError')}
                    </li>
                  ) : results.length === 0 ? (
                    <li role="presentation" className="px-2 py-1.5 text-sm text-muted-foreground">
                      {t(search.isFetching ? 'common.loading' : `${K}.noResult`)}
                    </li>
                  ) : (
                    results.map((row, index) => (
                      <li
                        key={row.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === active}
                        className="flex cursor-pointer flex-col rounded-lg px-2 py-1.5 aria-selected:bg-muted"
                        onMouseMove={() => setActive(index)}
                        onClick={() => choose(index)}
                      >
                        <span className="truncate text-sm text-foreground">
                          <span className="tabular text-muted-foreground">{clientNumberLabel(row.clientNumber)}</span> · {row.name}
                        </span>
                        {row.email && <span className="truncate text-xs text-muted-foreground">{row.email}</span>}
                      </li>
                    ))
                  )}
                  <li role="presentation" className="my-1 h-px bg-border" />
                  <li
                    id={optionId(results.length)}
                    role="option"
                    aria-selected={active === results.length}
                    className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground"
                    onMouseMove={() => setActive(results.length)}
                    onClick={() => choose(results.length)}
                  >
                    {t(`${K}.useText`, { text: query.trim() })}
                  </li>
                </ul>
              </div>
            )}
          </div>
        )
      }
    </FormField>
  )
}
