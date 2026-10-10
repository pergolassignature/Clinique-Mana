import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Check, ListFilter, Search, X } from 'lucide-react'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { matchesSearch, searchWords } from '@/shared/lib/list-search'
import { Button } from '@/shared/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Select } from '@/shared/ui/select'
import type { CatalogView } from '../../lib/catalog-view'
import { DISPLAY_STATUSES, type DisplayStatus } from '../../lib/constants'
import { statusLabel } from '../../lib/display'
import { isDefaultFilters, SEARCH_MAX_LENGTH, type ProfessionalsFilters } from '../../lib/filters'

const F = 'modules.professionals.list.filters'

type FilterPatch = Partial<Omit<ProfessionalsFilters, 'page'>>

interface ProfessionalsFiltersProps {
  filters: ProfessionalsFilters
  catalog: CatalogView | undefined
  /** The rows that pass the filters; undefined while loading. */
  resultCount: number | undefined
  /** The page shown and the number of pages: a page change is announced with the count. */
  pagination?: { page: number; pageCount: number }
  onChange: (patch: FilterPatch) => void
  onToggleMotif: (id: string) => void
  onReset: () => void
  /** « Filtres »: where focus goes when the chip or « Réinitialiser » it was on disappears. */
  filtersButtonRef: RefObject<HTMLButtonElement | null>
}

/**
 * The filter bar (design §5.1): search, Statut, « Filtres » (a popover: title, language, clientèle,
 * motifs, two switches), « N résultats »; then the popover's filters as removable chips and
 * « Réinitialiser ». Every change goes to the URL through `onChange` (`useProfessionalsFilters`).
 */
export function ProfessionalsFilters(props: ProfessionalsFiltersProps) {
  const { filters, catalog, resultCount, pagination, onChange, onReset, filtersButtonRef } = props
  const focusFiltersButton = () => filtersButtonRef.current?.focus()
  const chips = catalog ? activeChips(filters, catalog, props) : []
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={filters.q} onChange={(q) => onChange({ q })} />
        <Select
          aria-label={t('modules.professionals.list.statusFilter.label')}
          value={filters.status ?? ''}
          onChange={(event) => onChange({ status: (event.target.value || null) as DisplayStatus | null })}
          className="w-40"
        >
          <option value="">{t('modules.professionals.list.statusFilter.all')}</option>
          {DISPLAY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </Select>
        <MoreFilters {...props} />
        {resultCount !== undefined && <ResultsStatus count={resultCount} pagination={pagination} />}
      </div>
      {!isDefaultFilters(filters) && (
        <div role="group" aria-label={t('modules.professionals.list.chips.label')} className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="outline"
              size="sm"
              className="max-w-full"
              aria-label={t('modules.professionals.list.chips.remove', { label: chip.label })}
              onClick={() => {
                chip.remove()
                focusFiltersButton()
              }}
            >
              <span className="truncate">{chip.label}</span>
              <X aria-hidden />
            </Button>
          ))}
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              onReset()
              focusFiltersButton()
            }}
          >
            {t('modules.professionals.list.reset')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * « N résultats » (polite), for screen readers only: the eye reads the count once, in the page's
 * subtitle and, filtered, in the table's footer (audit 2026-10-09 §2.4). They also hear « Page X
 * sur Y » when there are several pages, so ‹ and ›, which keep the focus, say where they led.
 */
function ResultsStatus({ count, pagination }: { count: number; pagination: ProfessionalsFiltersProps['pagination'] }) {
  const results = t(count > 1 ? 'modules.professionals.list.resultsOther' : 'modules.professionals.list.resultsOne', { count: String(count) })
  const paged = pagination !== undefined && pagination.pageCount > 1
  return (
    <p role="status" aria-atomic="true" className="sr-only">
      <span aria-hidden={paged || undefined}>{results}</span>
      {paged && (
        <span className="sr-only">
          {t('modules.professionals.list.resultsPage', { results, page: String(pagination.page), count: String(pagination.pageCount) })}
        </span>
      )}
    </p>
  )
}

/**
 * The search box. It keeps its own text while it has focus: the URL takes each keystroke in a
 * transition, so its echo can lag behind the typing. Without focus (« Réinitialiser », a restore,
 * Back), the URL leads.
 */
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(value)
  }, [value])
  return (
    <div className="relative w-full sm:w-80">
      <Search aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
      <Input
        ref={input}
        type="search"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          onChange(event.target.value)
        }}
        aria-label={t('modules.professionals.list.search.label')}
        placeholder={t('modules.professionals.list.search.placeholder')}
        maxLength={SEARCH_MAX_LENGTH}
        autoComplete="off"
        className="pl-[30px]"
      />
    </div>
  )
}

/** How many of the popover's filters narrow the list (each motif counts). */
function popoverCount(f: ProfessionalsFilters): number {
  return (
    [f.titleId, f.languageId, f.clienteleId].filter(Boolean).length +
    f.motifIds.length +
    Number(f.acceptingNewClients) +
    Number(f.watch) +
    Number(f.documentsIncomplete)
  )
}

function MoreFilters({ filters, catalog, onChange, onToggleMotif, filtersButtonRef }: ProfessionalsFiltersProps) {
  const count = popoverCount(filters)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button ref={filtersButtonRef} variant="ghost">
          <ListFilter aria-hidden />
          {count > 0 ? t(`${F}.buttonCount`, { count: String(count) }) : t(`${F}.button`)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        aria-label={t(`${F}.label`)}
        className="max-h-[min(70vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-3"
      >
        {catalog ? (
          <div className="grid gap-3">
            <FilterSelect
              label={t(`${F}.title`)}
              all={t(`${F}.titleAll`)}
              value={filters.titleId}
              options={catalog.titles}
              onChange={(titleId) => onChange({ titleId })}
            />
            <FilterSelect
              label={t(`${F}.language`)}
              all={t(`${F}.languageAll`)}
              value={filters.languageId}
              options={catalog.languages}
              onChange={(languageId) => onChange({ languageId })}
            />
            <FilterSelect
              label={t(`${F}.clientele`)}
              all={t(`${F}.clienteleAll`)}
              value={filters.clienteleId}
              options={catalog.clienteles}
              onChange={(clienteleId) => onChange({ clienteleId })}
            />
            <MotifFilter catalog={catalog} selected={filters.motifIds} onToggle={onToggleMotif} />
            <CheckboxField
              label={t(`${F}.acceptingNewClients`)}
              checked={filters.acceptingNewClients}
              onCheckedChange={(acceptingNewClients) => onChange({ acceptingNewClients })}
            />
            <CheckboxField label={t(`${F}.watch`)} checked={filters.watch} onCheckedChange={(watch) => onChange({ watch })} />
            <CheckboxField
              label={t(`${F}.documentsIncomplete`)}
              checked={filters.documentsIncomplete}
              onCheckedChange={(documentsIncomplete) => onChange({ documentsIncomplete })}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

interface NamedRow {
  id: string
  name: string
  isActive: boolean
}

/** The active rows, plus the chosen one if it was archived since (so the select still shows it). */
const choices = <R extends NamedRow>(rows: readonly R[], value: string | null) => rows.filter((r) => r.isActive || r.id === value)
const choiceLabel = (row: NamedRow) => (row.isActive ? row.name : t(`${F}.archived`, { name: row.name }))

function FilterSelect(props: { label: string; all: string; value: string | null; options: readonly NamedRow[]; onChange: (id: string | null) => void }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{props.label}</Label>
      <Select id={id} value={props.value ?? ''} onChange={(event) => props.onChange(event.target.value || null)}>
        <option value="">{props.all}</option>
        {choices(props.options, props.value).map((row) => (
          <option key={row.id} value={row.id}>
            {choiceLabel(row)}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** Accent-insensitive, every word somewhere in the motif's name (its one keyword). */
const motifSearch = (_value: string, search: string, keywords?: string[]) => (matchesSearch(keywords ?? [], searchWords(search)) ? 1 : 0)

/** Motifs (any of them): a searchable list grouped by category, « Sans catégorie » last; Enter or a click toggles one. */
function MotifFilter({ catalog, selected, onToggle }: { catalog: CatalogView; selected: readonly string[]; onToggle: (id: string) => void }) {
  const labelId = useId()
  return (
    <div className="space-y-1">
      <p id={labelId} className="text-sm font-medium text-foreground">
        {t(`${F}.motifs`)}
      </p>
      <Command filter={motifSearch} label={t(`${F}.motifs`)} className="rounded-md border border-border">
        <CommandInput placeholder={t(`${F}.motifsSearch`)} aria-labelledby={labelId} />
        <CommandList className="max-h-52" aria-labelledby={labelId}>
          <CommandEmpty>{t(`${F}.motifsEmpty`)}</CommandEmpty>
          {catalog.motifGroups.map((group) => {
            const motifs = group.motifs.filter((m) => m.isActive || selected.includes(m.id))
            if (motifs.length === 0) return null
            return (
              <CommandGroup key={group.key} heading={group.name}>
                {motifs.map((motif) => {
                  const checked = selected.includes(motif.id)
                  return (
                    <CommandItem key={motif.id} value={motif.id} keywords={[motif.name]} aria-checked={checked} onSelect={() => onToggle(motif.id)}>
                      <Check aria-hidden className={checked ? 'text-primary' : 'invisible'} />
                      <span className="truncate">{choiceLabel(motif)}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </div>
  )
}

interface Chip {
  key: string
  label: string
  remove: () => void
}

/** The popover's filters as chips (the search and the status show in their own fields). Unknown ids get none: they filter nothing. */
function activeChips(f: ProfessionalsFilters, catalog: CatalogView, { onChange, onToggleMotif }: ProfessionalsFiltersProps): Chip[] {
  const C = 'modules.professionals.list.chips'
  const chips: Chip[] = []
  const named = (key: string, label: `${typeof C}.${'title' | 'language' | 'clientele'}`, row: NamedRow | undefined, patch: FilterPatch) => {
    if (row) chips.push({ key, label: t(label, { name: row.name }), remove: () => onChange(patch) })
  }
  named('title', `${C}.title`, f.titleId ? catalog.byId.titles.get(f.titleId) : undefined, { titleId: null })
  named('language', `${C}.language`, f.languageId ? catalog.byId.languages.get(f.languageId) : undefined, { languageId: null })
  named('clientele', `${C}.clientele`, f.clienteleId ? catalog.byId.clienteles.get(f.clienteleId) : undefined, { clienteleId: null })
  for (const id of f.motifIds) {
    const motif = catalog.byId.motifs.get(id)
    if (motif) chips.push({ key: `motif:${id}`, label: t(`${C}.motif`, { name: motif.name }), remove: () => onToggleMotif(id) })
  }
  if (f.acceptingNewClients) chips.push({ key: 'new', label: t(`${F}.acceptingNewClients`), remove: () => onChange({ acceptingNewClients: false }) })
  if (f.watch) chips.push({ key: 'watch', label: t(`${F}.watch`), remove: () => onChange({ watch: false }) })
  if (f.documentsIncomplete) chips.push({ key: 'documents', label: t(`${F}.documentsIncomplete`), remove: () => onChange({ documentsIncomplete: false }) })
  return chips
}
