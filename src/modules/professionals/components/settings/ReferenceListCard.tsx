import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Lock, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { HighlightedText } from '@/shared/components/HighlightedText'
import { ListStatusFilter, type ListStatusFilterValue } from '@/shared/components/ListStatusFilter'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { matchesSearch, searchWords } from '@/shared/lib/list-search'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { focusRing } from '@/shared/ui/field-classes'
import { Input } from '@/shared/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip'
import { usageKey, type ReferenceKind, type ReferenceRow } from '../../api/catalog'
import { useReorderReference } from '../../hooks/use-reference-mutations'
import { moveRow } from '../../lib/reorder'
import type { ReferenceFormValues } from '../../schemas/reference'
import { ArchiveReferenceDialog } from './ArchiveReferenceDialog'
import { ReferenceEditDialog, type ReferenceFormProps } from './ReferenceEditDialog'

export type { ReferenceFormProps } from './ReferenceEditDialog'

/** What a cell can use: `highlight(text)` marks the search's words in a text. */
export interface ReferenceCellContext {
  highlight: (text: string) => ReactNode
}

/** A list's own column, between « Nom » and « Utilisé par ». */
export interface ReferenceColumn<K extends ReferenceKind> {
  /** React key. */
  id: string
  header: string
  cell: (row: ReferenceRow<K>, context: ReferenceCellContext) => ReactNode
  /** Text the search also looks in (a code, a sigle). The name is always searched. */
  searchText?: (row: ReferenceRow<K>) => string
  /** Classes of the header and the cells (e.g. `max-sm:hidden` for a secondary column, `whitespace-nowrap`). */
  className?: string
}

/** A group of rows (`groupBy`): a header row in the table. */
export interface ReferenceGroup {
  /** Same id = same group. */
  id: string
  label: string
  /** Groups show in ascending order; `Infinity` (« Autres ») goes last. Equal orders keep their first appearance. */
  order: number
}

/** The texts a list may change; each has a generic default. */
export interface ReferenceListLabels {
  /** « + Ajouter » (default « Ajouter »). */
  add: string
  /** The dialogs' titles (default « Ajouter un élément » / « Modifier l'élément »). */
  createTitle: string
  editTitle: string
  /** A system row's lock (default « Utilisé par le jumelage : ne peut pas être archivé. »). */
  systemNote: string
  /** « Utilisé par » for a count above 0 (default « 3 professionnels »; parents count their children). */
  usage: (count: number) => string
  /** The archive confirmation's body (default « Cet élément est utilisé par 3 professionnels. … »). */
  archiveBody: (name: string, count: number) => string
}

export interface ReferenceListCardProps<K extends ReferenceKind> {
  kind: K
  /** Names the card (a heading), its table and its search. */
  title: string
  description?: string
  /** The page holds this list alone and its header already says it: the heading is for screen readers only. */
  headingHidden?: boolean
  /** From the catalogue (`referenceRows` or `CatalogView`), archived rows included, in their order. */
  rows: readonly ReferenceRow<K>[]
  /** « Utilisé par » counts (`useReferenceUsage`), keyed by `usageKey(kind, id)`; absent = nobody. */
  usage: ReadonlyMap<string, number>
  columns?: readonly ReferenceColumn<K>[]
  /** The dialog's fields after « Nom » (the form is the list's `referenceSchema`). */
  renderForm?: (props: ReferenceFormProps<K>) => ReactNode
  /** Values « Ajouter » starts with (e.g. the category the list is filtered on). Not used when editing. */
  createDefaults?: Partial<ReferenceFormValues[K]>
  /** The list's own controls (a view toggle, a category filter), in the header after the search. */
  toolbar?: ReactNode
  /**
   * The list's own filter (e.g. one category), applied first: the « Actifs · Archivés · Tous »
   * counts, the search and the empty states only see the rows it keeps (the counts are those of
   * what can be shown). Pass it only while it filters (undefined otherwise): while it is set,
   * « Monter / Descendre » are hidden, as during a search. The dialogs still check names against
   * the whole list.
   */
  filterRow?: (row: ReferenceRow<K>) => boolean
  /**
   * Shows the rows under group header rows, in one table (one `<tbody>` per group): groups in
   * `order`, rows in their list order within a group. With `reorderable`, a row moves within its
   * group only, and its announced position is its group's.
   */
  groupBy?: (row: ReferenceRow<K>) => ReferenceGroup
  /**
   * « Monter » / « Descendre » on each row, saved at once (`reorderReference`, every id). Shown
   * under « Actifs » or « Tous » only, with no search and no `filterRow`.
   */
  reorderable?: boolean
  /** `useSettingsSection().readOnly === false`. Without it: no « Ajouter », no actions, no reorder. */
  canEdit: boolean
  /**
   * « Ajouter »: teal when the page holds this list alone (the screen's one coloured action),
   * outline when the page stacks several cards, so a page never shows two teal buttons at rest.
   */
  addVariant?: 'default' | 'outline'
  labels?: Partial<ReferenceListLabels>
}

const DEFAULT_LABELS: ReferenceListLabels = {
  add: t('modules.professionals.settings.list.add'),
  createTitle: t('modules.professionals.settings.list.dialog.createTitle'),
  editTitle: t('modules.professionals.settings.list.dialog.editTitle'),
  systemNote: t('modules.professionals.settings.list.system'),
  usage: (count) =>
    count === 1 ? t('modules.professionals.settings.list.usage.one') : t('modules.professionals.settings.list.usage.other', { count: String(count) }),
  archiveBody: (_name, count) =>
    count === 0
      ? t('modules.professionals.settings.list.archive.bodyNone')
      : count === 1
        ? t('modules.professionals.settings.list.archive.bodyOne')
        : t('modules.professionals.settings.list.archive.bodyOther', { count: String(count) }),
}

const KEEP_FILTER: Record<ListStatusFilterValue, (row: { isActive: boolean }) => boolean> = {
  active: (row) => row.isActive,
  archived: (row) => !row.isActive,
  all: () => true,
}

/** The name cell (`<th scope="row">`) looks like the other cells. */
const ROW_HEADER = 'tabular h-10 max-w-[320px] whitespace-normal px-3 py-2 text-left align-middle font-normal'

/** One stable callback ref per key (an inline one would detach and reattach on every render). */
function useElementMap<E extends HTMLElement>() {
  const elements = useRef(new Map<string, E>())
  const refs = useRef(new Map<string, (element: E | null) => void>())
  const refFor = (key: string) => {
    let ref = refs.current.get(key)
    if (!ref) {
      ref = (element) => {
        if (element) elements.current.set(key, element)
        else elements.current.delete(key)
      }
      refs.current.set(key, ref)
    }
    return ref
  }
  return { elements: elements.current, refFor }
}

interface RowGroup<K extends ReferenceKind> {
  group: ReferenceGroup | null
  rows: ReferenceRow<K>[]
}

/** The rows shown, split by `groupBy` (groups in `order`, « Autres » last), or one unnamed group. */
function groupRows<K extends ReferenceKind>(rows: readonly ReferenceRow<K>[], groupBy?: (row: ReferenceRow<K>) => ReferenceGroup): RowGroup<K>[] {
  if (!groupBy) return [{ group: null, rows: [...rows] }]
  const groups = new Map<string, RowGroup<K>>()
  for (const row of rows) {
    const group = groupBy(row)
    const entry = groups.get(group.id)
    if (entry) entry.rows.push(row)
    else groups.set(group.id, { group, rows: [row] })
  }
  // Not `a - b`: Infinity - Infinity is NaN. The sort is stable, so equal orders keep their first appearance.
  const order = (entry: RowGroup<K>) => entry.group?.order ?? 0
  return [...groups.values()].sort((a, b) => (order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1))
}

/**
 * A per-clinic list of « Paramètres → Professionnels » (langues, raisons, approches, titres…):
 * the pattern every list section uses (4a.6–4a.9).
 *
 * - Header: title and description; « Actifs · Archivés · Tous » with counts (one tab stop, arrows
 *   move, Enter / Space select); a search on the name and the columns' `searchText`, accents
 *   ignored, the match highlighted; the list's `toolbar`; « + Ajouter ».
 * - Table (named by the title): « Nom » (the row header; lock on system rows, « Archivé » on
 *   archived ones, muted), the list's columns, « Utilisé par » (hidden at phone width), then the
 *   row's « Monter / Descendre » and « … » menu (Modifier, Archiver or Restaurer; never Archiver on
 *   a system row). With `groupBy`, group header rows. The scroll wrapper is a tab stop only while
 *   the table is wider than the card.
 * - `filterRow` narrows the list before the counts; `createDefaults` seeds « Ajouter ».
 * - Dialogs: `ReferenceEditDialog` (add, edit) and `ArchiveReferenceDialog` (archive, restore);
 *   their refusals show inside them. Focus goes back to the row's menu (the new row's after
 *   « Ajouter »), else to « Ajouter ».
 * - Reorder: moves among the rows shown (within the group), sends the whole list (archived rows
 *   included), optimistic with rollback (`useReorderReference`); focus stays on the button
 *   pressed, the new position is announced (« « Congé » : position 2 sur 3 »). One move at a
 *   time: while it saves, the buttons are `aria-disabled` and the table `aria-busy`.
 * - Read-only (`canEdit` false): the rows, filters and search only.
 */
export function ReferenceListCard<K extends ReferenceKind>({
  kind,
  title,
  description,
  headingHidden = false,
  rows,
  usage,
  columns = [],
  renderForm,
  createDefaults,
  toolbar,
  filterRow,
  groupBy,
  reorderable = false,
  canEdit,
  addVariant = 'default',
  labels: labelOverrides,
}: ReferenceListCardProps<K>) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const titleId = useId()
  const [filter, setFilter] = useState<ListStatusFilterValue>('active')
  const [query, setQuery] = useState('')

  // Dialogs: the row stays set while a dialog closes, so its content does not change meanwhile.
  const [editOpen, setEditOpen] = useState(false)
  const [editRow, setEditRow] = useState<ReferenceRow<K> | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusRow, setStatusRow] = useState<ReferenceRow<K> | null>(null)

  // Focus: the row whose menu opened a dialog (or the row just added) gets it back on close.
  const menus = useElementMap<HTMLButtonElement>()
  const moveButtons = useElementMap<HTMLButtonElement>()
  const addRef = useRef<HTMLButtonElement>(null)
  const focusRow = useRef<string | null>(null)
  const returnFocus = (event: Event) => {
    event.preventDefault()
    const trigger = focusRow.current === null ? undefined : menus.elements.get(focusRow.current)
    ;(trigger?.isConnected ? trigger : addRef.current)?.focus()
  }

  const reorder = useReorderReference()
  // What a move says (polite live region): the row's new position among the rows it moved within.
  const [moveAnnouncement, setMoveAnnouncement] = useState('')
  // The move button pressed: the row moves in the DOM, which can drop focus to <body>.
  const movedButton = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = movedButton.current
    if (key === null) return
    const button = moveButtons.elements.get(key)
    if (button && document.activeElement !== button && (document.activeElement === document.body || document.activeElement === null)) button.focus()
  }, [rows, moveButtons.elements])

  const words = searchWords(query)
  // The list's own filter comes first: the counts are those of the rows it keeps.
  const listed = filterRow ? rows.filter(filterRow) : rows
  const counts = {
    active: listed.filter(KEEP_FILTER.active).length,
    archived: listed.filter(KEEP_FILTER.archived).length,
    all: listed.length,
  }
  const shown = listed.filter(
    (row) =>
      KEEP_FILTER[filter](row) &&
      matchesSearch([row.name, ...columns.flatMap((column) => (column.searchText ? [column.searchText(row)] : []))], words),
  )
  const groups = groupRows(shown, groupBy)
  const highlight = (text: string) => <HighlightedText text={text} words={words} />
  const showActions = canEdit
  // Moving among a subset (archived only, a search, the list's filter) would be hard to follow.
  const showReorder = canEdit && reorderable && filter !== 'archived' && words.length === 0 && !filterRow
  const columnCount = 2 + columns.length + (showActions ? 1 : 0)

  const openEdit = (row: ReferenceRow<K> | null) => {
    focusRow.current = row?.id ?? null
    setEditRow(row)
    setEditOpen(true)
  }
  const openStatus = (row: ReferenceRow<K>) => {
    focusRow.current = row.id
    setStatusRow(row)
    setStatusOpen(true)
  }
  /** Moves `row` past its neighbour among `scope` (the rows shown, or its group's). */
  const move = (row: ReferenceRow<K>, direction: 'up' | 'down', scope: readonly ReferenceRow<K>[]) => {
    // One move at a time (as PS Hub's reorder): the next one starts from the saved order.
    if (reorder.isPending) return
    const scopeIds = scope.map((r) => r.id)
    const ids = moveRow(
      rows.map((r) => r.id),
      scopeIds,
      row.id,
      direction,
    )
    if (!ids) return
    const position = ids.filter((id) => scopeIds.includes(id)).indexOf(row.id) + 1
    setMoveAnnouncement(
      t('modules.professionals.settings.list.actions.moved', { name: row.name, position: String(position), count: String(scopeIds.length) }),
    )
    movedButton.current = `${row.id}:${direction}`
    reorder.mutate(
      { kind, ids },
      {
        // Rolled back: the toast says why, the position announced no longer holds.
        onError: () => setMoveAnnouncement(''),
        onSettled: () => (movedButton.current = null),
      },
    )
  }

  const renderRow = (row: ReferenceRow<K>, index: number, scope: readonly ReferenceRow<K>[]) => {
    const count = usage.get(usageKey(kind, row.id)) ?? 0
    return (
      <TableRow key={row.id} className={cn(!row.isActive && 'text-muted-foreground')}>
        <th scope="row" className={ROW_HEADER}>
          <span className="flex min-w-0 items-center gap-2">
            <span data-name className={cn('min-w-0 break-words', row.isActive && 'font-medium')}>
              {highlight(row.name)}
            </span>
            {row.isSystem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span role="img" aria-label={labels.systemNote} tabIndex={0} className={`inline-flex shrink-0 rounded-sm text-subtle ${focusRing}`}>
                    <Lock aria-hidden className="size-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{labels.systemNote}</TooltipContent>
              </Tooltip>
            )}
            {!row.isActive && <Badge variant="secondary">{t('modules.professionals.settings.list.archived')}</Badge>}
          </span>
        </th>
        {columns.map((column) => (
          <TableCell key={column.id} className={column.className}>
            {column.cell(row, { highlight })}
          </TableCell>
        ))}
        <TableCell className={cn('max-sm:hidden', count === 0 && 'text-subtle')}>
          {count === 0 ? (
            <>
              <span aria-hidden>{t('modules.professionals.settings.list.usage.none')}</span>
              <span className="sr-only">{t('modules.professionals.settings.list.usage.noneLabel')}</span>
            </>
          ) : (
            labels.usage(count)
          )}
        </TableCell>
        {showActions && (
          <TableCell className="w-0 py-1 text-right">
            <span className="inline-flex items-center gap-0.5">
              {showReorder && (
                <>
                  <MoveButton
                    buttonRef={moveButtons.refFor(`${row.id}:up`)}
                    label={t('modules.professionals.settings.list.actions.moveUp', { name: row.name })}
                    icon={<ArrowUp aria-hidden />}
                    inactive={index === 0 || reorder.isPending}
                    onMove={() => move(row, 'up', scope)}
                  />
                  <MoveButton
                    buttonRef={moveButtons.refFor(`${row.id}:down`)}
                    label={t('modules.professionals.settings.list.actions.moveDown', { name: row.name })}
                    icon={<ArrowDown aria-hidden />}
                    inactive={index === scope.length - 1 || reorder.isPending}
                    onMove={() => move(row, 'down', scope)}
                  />
                </>
              )}
              <RowMenu
                name={row.name}
                buttonRef={menus.refFor(row.id)}
                onEdit={() => openEdit(row)}
                onArchive={row.isActive && !row.isSystem ? () => openStatus(row) : undefined}
                onRestore={row.isActive ? undefined : () => openStatus(row)}
              />
            </span>
          </TableCell>
        )}
      </TableRow>
    )
  }

  let body: ReactNode
  if (rows.length === 0) {
    body = (
      <EmptyState
        title={t('modules.professionals.settings.list.empty.title')}
        body={t(canEdit ? 'modules.professionals.settings.list.empty.body' : 'modules.professionals.settings.list.empty.bodyReadOnly')}
      />
    )
  } else if (shown.length === 0) {
    if (words.length > 0 || listed.length === 0) {
      body = (
        <EmptyState
          title={t('modules.professionals.settings.list.empty.noMatchTitle')}
          body={t(filterRow ? 'modules.professionals.settings.list.empty.noMatchFilteredBody' : 'modules.professionals.settings.list.empty.noMatchBody')}
        />
      )
    } else if (filter === 'archived') {
      body = (
        <EmptyState
          title={t('modules.professionals.settings.list.empty.noArchived')}
          body={t('modules.professionals.settings.list.empty.noArchivedBody')}
        />
      )
    } else {
      body = (
        <EmptyState title={t('modules.professionals.settings.list.empty.noActive')} body={t('modules.professionals.settings.list.empty.noActiveBody')} />
      )
    }
  } else {
    body = (
      <Table
        aria-labelledby={titleId}
        aria-busy={reorder.isPending || undefined}
        scrollLabel={t('modules.professionals.settings.list.table', { list: title })}
        scrollFocus="overflow"
        className="whitespace-nowrap"
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('modules.professionals.settings.list.columns.name')}</TableHead>
            {columns.map((column) => (
              <TableHead key={column.id} scope="col" className={column.className}>
                {column.header}
              </TableHead>
            ))}
            <TableHead scope="col" className="max-sm:hidden">
              {t('modules.professionals.settings.list.columns.usage')}
            </TableHead>
            {showActions && (
              <TableHead scope="col">
                <span className="sr-only">{t('modules.professionals.settings.list.columns.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        {groups.map(({ group, rows: members }) =>
          group === null ? (
            <TableBody key="">{members.map((row, index) => renderRow(row, index, members))}</TableBody>
          ) : (
            <TableBody key={group.id} className="border-t border-border first-of-type:border-t-0">
              <TableRow className="hover:bg-transparent">
                <th scope="rowgroup" colSpan={columnCount} className="bg-muted px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                  {group.label}
                </th>
              </TableRow>
              {members.map((row, index) => renderRow(row, index, members))}
            </TableBody>
          ),
        )}
      </Table>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <section aria-labelledby={titleId} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <div className={cn('mb-3 min-w-0', headingHidden && 'sr-only')}>
          <h3 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ListStatusFilter value={filter} counts={counts} onChange={setFilter} />
          <div className="relative w-full min-w-0 sm:w-[280px]">
            <Search aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t('modules.professionals.settings.list.search.label', { list: title })}
              placeholder={t('modules.professionals.settings.list.search.placeholder')}
              maxLength={120}
              autoComplete="off"
              className="pl-[30px]"
            />
          </div>
          {toolbar}
          {canEdit && (
            <Button ref={addRef} type="button" variant={addVariant} className="sm:ml-auto" onClick={() => openEdit(null)}>
              <Plus aria-hidden />
              {labels.add}
            </Button>
          )}
        </div>
        {/* Says how many rows a filter or a search leaves. */}
        <p role="status" className="sr-only">
          {shown.length === 1
            ? t('modules.professionals.settings.list.results.one')
            : t('modules.professionals.settings.list.results.other', { count: String(shown.length) })}
        </p>
        {/* Says where a moved row now stands. */}
        <p aria-live="polite" className="sr-only">
          {moveAnnouncement}
        </p>
        {body}
        {canEdit && (
          <>
            <ReferenceEditDialog
              kind={kind}
              open={editOpen}
              row={editRow}
              rows={rows}
              title={editRow ? labels.editTitle : labels.createTitle}
              renderForm={renderForm}
              createDefaults={createDefaults}
              onOpenChange={setEditOpen}
              onSaved={(id) => (focusRow.current = id)}
              onCloseAutoFocus={returnFocus}
            />
            <ArchiveReferenceDialog
              kind={kind}
              open={statusOpen}
              row={statusRow}
              archiveBody={statusRow ? labels.archiveBody(statusRow.name, usage.get(usageKey(kind, statusRow.id)) ?? 0) : ''}
              onOpenChange={setStatusOpen}
              onCloseAutoFocus={returnFocus}
            />
          </>
        )}
      </section>
    </TooltipProvider>
  )
}

interface MoveButtonProps {
  buttonRef: (button: HTMLButtonElement | null) => void
  label: string
  icon: ReactNode
  /** First or last row shown: nothing to pass. Soft-disabled, so focus stays on it after a move. */
  inactive: boolean
  onMove: () => void
}

function MoveButton({ buttonRef, label, icon, inactive, onMove }: MoveButtonProps) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-disabled={inactive || undefined}
      onClick={ignoreWhenInactive(inactive, onMove)}
      className={cn(softDisabledClasses, 'aria-disabled:hover:bg-transparent')}
    >
      {icon}
    </Button>
  )
}

interface RowMenuProps {
  name: string
  buttonRef: (button: HTMLButtonElement | null) => void
  onEdit: () => void
  /** Absent on a system row and on an archived one. */
  onArchive?: () => void
  /** Only on an archived row. */
  onRestore?: () => void
}

/**
 * A row's « … » menu. The chosen action runs once the menu has closed and given focus back to its
 * button, so the dialog it opens takes focus cleanly (and returns it there).
 */
function RowMenu({ name, buttonRef, onEdit, onArchive, onRestore }: RowMenuProps) {
  const pendingAction = useRef<(() => void) | null>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={buttonRef} type="button" variant="ghost" size="icon-sm" aria-label={t('modules.professionals.settings.list.actions.menu', { name })}>
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
          {t('modules.professionals.settings.list.actions.edit')}
        </DropdownMenuItem>
        {onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => (pendingAction.current = onArchive)}>
              <Archive className="text-subtle" aria-hidden />
              {t('modules.professionals.settings.list.actions.archive')}
            </DropdownMenuItem>
          </>
        )}
        {onRestore && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => (pendingAction.current = onRestore)}>
              <ArchiveRestore className="text-subtle" aria-hidden />
              {t('modules.professionals.settings.list.actions.restore')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
