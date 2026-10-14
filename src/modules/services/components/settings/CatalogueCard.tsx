import { useId, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { HighlightedText } from '@/shared/components/HighlightedText'
import { ListStatusFilter, type ListStatusFilterValue } from '@/shared/components/ListStatusFilter'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { matchesSearch, searchWords } from '@/shared/lib/list-search'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Input } from '@/shared/ui/input'
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { ServicesSettings } from '../../api/catalogue'
import type { Service } from '../../api/parse'
import { useSetServiceActive } from '../../hooks/use-services'
import { durationLabel, familyHeading, priceSummary, taxRuleLabel } from '../../lib/display'
import { ServiceSheet } from './ServiceSheet'

const C = 'modules.services.settings.catalogue'

const KEEP: Record<ListStatusFilterValue, (service: Service) => boolean> = {
  active: (s) => s.isActive,
  archived: (s) => !s.isActive,
  all: () => true,
}

/** The name cell (`<th scope="row">`) looks like the other cells. */
const ROW_HEADER = 'h-10 max-w-[320px] whitespace-normal px-3 py-2 text-left align-middle font-normal'

interface CatalogueCardProps {
  data: ServicesSettings
  canEdit: boolean
}

/**
 * « Catalogue » (plan S3.2): the services grouped by family, with their code, duration (and pause
 * after), the price's source, the taxes and the professions offering them; « Actifs · Archivés ·
 * Tous », a search on the name, the code and the key (accents ignored, the match highlighted);
 * « Ajouter un service » and, per row, a « … » menu: « Modifier » (the sheet), « Archiver » / « Restaurer ».
 * Read-only (`canEdit` false): the rows, the filter and the search only.
 */
export function CatalogueCard({ data, canEdit }: CatalogueCardProps) {
  const { families, services, titleIdsByService, titles } = data
  const [filter, setFilter] = useState<ListStatusFilterValue>('active')
  const [query, setQuery] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [edited, setEdited] = useState<Service | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const focusRow = useRef<string | null>(null)
  const searchId = useId()
  const toggleActive = useSetServiceActive()

  const words = searchWords(query)
  const counts = { active: services.filter(KEEP.active).length, archived: services.filter(KEEP.archived).length, all: services.length }
  const shown = services.filter((s) => KEEP[filter](s) && matchesSearch([s.name, String(s.code), s.key], words))
  const groups = useMemo(
    () => families.map((family) => ({ family, rows: shown.filter((s) => s.familyId === family.id) })).filter((group) => group.rows.length > 0),
    [families, shown],
  )
  const titleNames = (serviceId: string) => {
    const ids = titleIdsByService.get(serviceId) ?? []
    const names = titles.filter((title) => ids.includes(title.id)).map((title) => title.name)
    if (names.length === 0) return t(`${C}.titlesCount.none`)
    if (names.length <= 2) return names.join(', ')
    return t(`${C}.titlesCount.other`, { count: String(names.length) })
  }
  const highlight = (text: string) => <HighlightedText text={text} words={words} />
  const openSheet = (service: Service | null) => {
    focusRow.current = service?.id ?? null
    setEdited(service)
    setSheetOpen(true)
  }
  const returnFocus = (event: Event) => {
    event.preventDefault()
    const button = focusRow.current === null ? undefined : editButtons.current.get(focusRow.current)
    ;(button?.isConnected ? button : addRef.current)?.focus()
  }
  const columnCount = canEdit ? 6 : 5

  let empty: { title: string; body: string } | null = null
  if (shown.length === 0) {
    if (services.length === 0) empty = { title: t(`${C}.empty.title`), body: t(`${C}.empty.body`) }
    else if (words.length > 0) empty = { title: t(`${C}.empty.noMatchTitle`), body: t(`${C}.empty.noMatchBody`) }
    else empty = { title: t(`${C}.empty.noArchived`), body: t(`${C}.empty.noArchivedBody`) }
  }

  return (
    <SettingsCard
      as="section"
      title={t(`${C}.title`)}
      description={t(`${C}.description`)}
      footer={
        canEdit ? (
          <Button ref={addRef} type="button" onClick={() => openSheet(null)}>
            <Plus aria-hidden />
            {t(`${C}.add`)}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <ListStatusFilter value={filter} counts={counts} onChange={setFilter} />
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <label htmlFor={searchId} className="sr-only">
            {t(`${C}.searchLabel`)}
          </label>
          <Input id={searchId} type="search" role="searchbox" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(`${C}.search`)} className="pl-8" />
        </div>
      </div>
      {empty ? (
        <EmptyState title={empty.title} body={empty.body} inCard={false} />
      ) : (
        <Table aria-label={t(`${C}.table`)} scrollLabel={t(`${C}.table`)} scrollFocus="overflow" stickyHeader className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${C}.columns.code`)}</TableHead>
              <TableHead>{t(`${C}.columns.name`)}</TableHead>
              <TableHead className="max-sm:hidden">{t(`${C}.columns.duration`)}</TableHead>
              <TableHead>{t(`${C}.columns.price`)}</TableHead>
              <TableHead className="max-md:hidden">{t(`${C}.columns.titles`)}</TableHead>
              {canEdit && (
                <TableHead>
                  <span className="sr-only">{t(`${C}.columns.actions`)}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          {groups.map(({ family, rows }) => (
            <TableBody key={family.id}>
              <TableGroupRow colSpan={columnCount}>{familyHeading(family)}</TableGroupRow>
              {rows.map((service) => (
                <TableRow key={service.id} className={cn(!service.isActive && 'text-muted-foreground')}>
                  <TableCell className="tabular whitespace-nowrap">{highlight(String(service.code))}</TableCell>
                  <th scope="row" className={ROW_HEADER}>
                    <span className={cn('block min-w-0 break-words', service.isActive && 'font-medium')}>{highlight(service.name)}</span>
                    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {!service.isActive && <Badge variant="secondary">{t(`${C}.archived`)}</Badge>}
                      {service.forTwo && <span>{t(`${C}.forTwo`)}</span>}
                      {/* On a phone the duration goes here: the price and « … » stay in view. */}
                      <span className="sm:hidden">{durationLabel(service)}</span>
                    </span>
                  </th>
                  <TableCell className="whitespace-nowrap max-sm:hidden">{durationLabel(service)}</TableCell>
                  <TableCell className="min-w-[132px]">
                    {priceSummary(service)}
                    <span className="block text-xs text-muted-foreground">{taxRuleLabel(service.taxRule)}</span>
                  </TableCell>
                  <TableCell className="max-md:hidden">{titleNames(service.id)}</TableCell>
                  {canEdit && (
                    <TableCell className="w-0 whitespace-nowrap py-1 pl-1 pr-2 text-right">
                      <RowMenu
                        name={service.name}
                        isActive={service.isActive}
                        buttonRef={(element) => {
                          if (element) editButtons.current.set(service.id, element)
                          else editButtons.current.delete(service.id)
                        }}
                        onEdit={() => openSheet(service)}
                        onToggleActive={() => !toggleActive.isPending && toggleActive.mutate({ id: service.id, active: !service.isActive })}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      )}
      <ServiceSheet
        open={sheetOpen}
        service={edited}
        titleIds={edited ? (titleIdsByService.get(edited.id) ?? []) : []}
        families={families}
        services={services}
        titles={titles}
        onClose={() => setSheetOpen(false)}
        onCloseAutoFocus={returnFocus}
      />
    </SettingsCard>
  )
}

interface RowMenuProps {
  name: string
  isActive: boolean
  buttonRef: (button: HTMLButtonElement | null) => void
  onEdit: () => void
  onToggleActive: () => void
}

/**
 * A row's « … » menu, as Professionnels' lists: « Modifier », then « Archiver » or « Restaurer ».
 * The chosen action runs once the menu has closed and given focus back to its button, so the
 * sheet it opens takes focus cleanly (and returns it there).
 */
function RowMenu({ name, isActive, buttonRef, onEdit, onToggleActive }: RowMenuProps) {
  const pendingAction = useRef<(() => void) | null>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={buttonRef} type="button" variant="ghost" size="icon-sm" aria-label={t(`${C}.menu`, { name })}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current
          pendingAction.current = null
          if (!action) return
          event.preventDefault()
          action()
        }}
      >
        <DropdownMenuItem onSelect={() => (pendingAction.current = onEdit)}>
          <Pencil className="text-subtle" aria-hidden />
          {t(`${C}.edit`)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => (pendingAction.current = onToggleActive)}>
          {isActive ? <Archive className="text-subtle" aria-hidden /> : <ArchiveRestore className="text-subtle" aria-hidden />}
          {t(isActive ? `${C}.archive` : `${C}.restore`)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
