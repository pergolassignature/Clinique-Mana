import { useMemo, useState, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { t } from '@/i18n'
import type { ModuleSearchProvider, ModuleSearchResult } from '@/core/modules/types'
import { Badge } from '@/shared/ui/badge'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import type { ShellPage } from './shell-pages'
import { normalizeQuery, usePaletteSearch, type PaletteSearchGroup } from './use-palette-search'

export interface PalettePage extends ShellPage {
  icon: LucideIcon
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: PalettePage[]
  /** The record groups of the enabled modules the user may search (permission already checked). */
  searchProviders?: readonly ModuleSearchProvider[]
  onSelect: (path: string) => void
  /** Radix's close auto-focus, for the shell to send focus back where it was. */
  onCloseAutoFocus: (event: Event) => void
  contentRef: RefObject<HTMLDivElement | null>
}

/** Lower case, without accents: « paramètres », « PARAMETRES » and « parametres » are the same. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/**
 * ⌘K / Ctrl+K « Rechercher… »: go to a page by name (the legacy palette, inventory §D « Shared »)
 * or open a record. « Pages » matches the label only (never the path) in the browser; each enabled
 * module the user may search adds its group (manifest `search`), asked by `usePaletteSearch` once
 * the query is long enough. cmdk does not filter (`shouldFilter={false}`): the pages are filtered
 * here and the records by the modules, so « Aucun résultat » shows only once every group is empty.
 */
export function CommandPalette({ open, onOpenChange, pages, searchProviders = [], onSelect, onCloseAutoFocus, contentRef }: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        // Anchored near the top: the palette does not jump while results arrive and the list grows.
        position="top"
        hideClose
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        className="max-w-[600px] gap-0 overflow-hidden rounded-lg border border-border p-0"
      >
        <DialogTitle className="sr-only">{t('nav.palette.title')}</DialogTitle>
        {/* Mounted only while open: closing cancels a running search and forgets the query. */}
        <PaletteBody pages={pages} searchProviders={searchProviders} onSelect={onSelect} />
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({
  pages,
  searchProviders,
  onSelect,
}: {
  pages: PalettePage[]
  searchProviders: readonly ModuleSearchProvider[]
  onSelect: (path: string) => void
}) {
  const [search, setSearch] = useState('')
  const groups = usePaletteSearch(searchProviders, search)
  const query = normalizeQuery(search)

  const matchingPages = useMemo(() => {
    const words = fold(query)
    return pages.filter((page) => fold(t(page.labelKey)).includes(words))
  }, [pages, query])

  const loading = groups.some((g) => g.status === 'loading')
  const failed = groups.filter((g) => g.status === 'error')
  const found = groups.filter((g) => g.results.length > 0)
  const empty = query !== '' && matchingPages.length === 0 && found.length === 0 && !loading && failed.length === 0

  return (
    // No vim bindings: cmdk would take Ctrl+K (« up ») and the shortcut could not close the palette.
    <Command label={t('nav.palette.title')} loop shouldFilter={false} vimBindings={false}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={searchProviders.length > 0 ? t('nav.palette.placeholderRecords') : t('nav.palette.placeholder')}
        trailing={
          // The top bar's ⌘K key cap, the same here.
          <kbd className="hidden shrink-0 rounded-md bg-muted px-1 py-px font-sans text-2xs text-muted-foreground sm:inline">
            {t('nav.palette.escape')}
          </kbd>
        }
      />
      <CommandList>
        {matchingPages.length > 0 && (
          <CommandGroup heading={t('nav.palette.pages')}>
            {matchingPages.map((page) => (
              <CommandItem key={page.path} value={`page:${page.path}`} onSelect={() => onSelect(page.path)}>
                <page.icon aria-hidden />
                {t(page.labelKey)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {found.map((group) => (
          <ResultGroup key={group.provider.id} group={group} onSelect={onSelect} />
        ))}
      </CommandList>
      {/* Outside the listbox: announced, never an option. */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {loading && <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground">{t('nav.palette.searching')}</p>}
        {failed.map((g) => (
          <p key={g.provider.id} className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
            {t('nav.palette.searchFailed', { group: t(g.provider.labelKey) })}
          </p>
        ))}
        {empty && <p className="px-4 py-6 text-sm text-muted-foreground">{t('nav.palette.empty', { query })}</p>}
      </div>
    </Command>
  )
}

function ResultGroup({ group, onSelect }: { group: PaletteSearchGroup; onSelect: (path: string) => void }) {
  const { provider, results } = group
  return (
    <CommandGroup heading={t(provider.labelKey)}>
      {results.map((result) => (
        <ResultItem key={result.id} providerId={provider.id} icon={result.icon ?? provider.icon} result={result} onSelect={onSelect} />
      ))}
    </CommandGroup>
  )
}

function ResultItem({
  providerId,
  icon: Icon,
  result,
  onSelect,
}: {
  providerId: string
  icon: LucideIcon
  result: ModuleSearchResult
  onSelect: (path: string) => void
}) {
  return (
    <CommandItem value={`${providerId}:${result.id}`} onSelect={() => onSelect(result.href)}>
      <Icon aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{result.title}</span>
        {result.subtitle && <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>}
      </span>
      {result.badge && (
        <Badge variant={result.badge.tone} className="shrink-0">
          {result.badge.label}
        </Badge>
      )}
    </CommandItem>
  )
}
