import { useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type Ref } from 'react'
import { CircleAlert, Search, X } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { searchWords } from '@/shared/lib/list-search'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { closeButtonClasses } from '@/shared/ui/overlay-classes'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { Switch } from '@/shared/ui/switch'
import {
  applyGroupAction,
  filterGroups,
  heldFirst,
  sameSelection,
  selectionCount,
  type PickerGroup,
  type PickerItem,
  type PickerSelection,
} from '../../lib/set-picker'
import { PickerFlatList, PickerGroupSection, type PickerRowsContext } from './PickerList'

const P = 'modules.professionals.record.matching.picker'

/** A flat list longer than this gets the search field and « Sélectionnés seulement »; a grouped list always does. */
export const SEARCH_FROM_ITEMS = 12

export type PickerDraft = Map<string, { specialized: boolean }>

export interface SetPickerSheetProps {
  /** The « Modifier » button: it opens the sheet and gets the focus back when the sheet closes. */
  trigger: ReactElement
  title: string
  /** Whose set it is (the professional's name), under the title. */
  subject: string
  /** One group is a flat list; several are collapsible categories. */
  groups: readonly PickerGroup[]
  selected: PickerSelection
  /** ★ on held items (clientèles); held items are listed first. */
  withStars?: boolean
  searchPlaceholder: string
  /** The set needs at least one item: the last one cannot be unticked, and this says why. */
  requiredMessage?: string
  /**
   * Saves the whole set (one RPC: one transaction, one audit set). Resolves with null once saved
   * (the sheet closes), or with the refusal to show in the sheet, which stays open with the draft.
   */
  onSave: (next: PickerDraft) => Promise<string | null>
}

type PanelProps = Omit<SetPickerSheetProps, 'trigger'> & { onClose: () => void }

/**
 * The Jumelage set picker (design A2.12–A2.13): a sheet over the record where ticks and stars
 * change a local draft only (decision #36), saved whole by « Enregistrer ». Built for long lists
 * held almost whole (motifs: up to 72): categories fold to one line with « 3 sur 16 » and
 * « Tout sélectionner », the search (accents ignored, words marked) and « Sélectionnés seulement »
 * show the matches unfolded, and the total runs above the list. Closing with changes (Échap, X,
 * outside) asks first; « Annuler » discards at once. X is out of the tab order; focus starts in
 * the search field. The panel mounts on each opening, so it always starts from the saved set.
 */
export function SetPickerSheet({ trigger, ...panel }: SetPickerSheetProps) {
  const [open, setOpen] = useState(false)
  return (
    // Closing goes through the panel (it may ask first): Radix only ever opens it here.
    <Sheet open={open} onOpenChange={(next) => next && setOpen(true)}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      {open && <PickerPanel {...panel} onClose={() => setOpen(false)} />}
    </Sheet>
  )
}

/**
 * The draft of one opening: taken from the saved set once (a refetch underneath neither resets it
 * nor moves rows), ticks and stars applied to it, a refusal cleared by the next change, and the
 * last item of a required list locked, and nothing changed while `frozen` (saving). `bulk` says whether the last change was a category's
 * « Tout sélectionner / désélectionner »: only those announce the new total (a tick is announced
 * by its own checkbox).
 */
function usePickerDraft({
  groups,
  selected,
  withStars,
  requiredMessage,
  frozen,
}: Pick<PanelProps, 'groups' | 'selected' | 'withStars' | 'requiredMessage'> & { frozen: boolean }) {
  const [initial] = useState(selected)
  const [ordered] = useState(() => (withStars ? groups.map((g) => ({ ...g, items: heldFirst(g.items, selected) })) : [...groups]))
  const [draft, setDraft] = useState<PickerSelection>(() => new Map(selected))
  const [refusal, setRefusal] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  // Functional updates: two changes before a re-render (fast clicks) both apply. The required
  // list's last item is kept here too, against the draft of the moment: two fast unticks of the
  // last two languages leave one, whatever the disabled state rendered in between.
  const change = (update: (prev: PickerSelection) => PickerSelection, { isBulk = false } = {}) => {
    // While saving, the draft on screen is the one being saved (the list is also disabled).
    if (frozen) return
    setDraft((prev) => {
      const next = update(prev)
      return requiredMessage && next.size === 0 && prev.size > 0 ? prev : next
    })
    setRefusal(null)
    setBulk(isBulk)
  }
  const edits: Pick<PickerRowsContext, 'locked' | 'onToggle' | 'onStar'> = {
    locked: requiredMessage && draft.size === 1 ? { id: [...draft.keys()][0] ?? '', reason: requiredMessage } : null,
    onToggle: (item: PickerItem, checked: boolean) =>
      change((prev) => {
        const next = new Map(prev)
        if (checked) next.set(item.id, { specialized: false })
        else next.delete(item.id)
        return next
      }),
    onStar: (id: string) =>
      change((prev) => {
        const entry = prev.get(id)
        return entry ? new Map(prev).set(id, { specialized: !entry.specialized }) : prev
      }),
  }
  return { ordered, draft, change, edits, dirty: !sameSelection(draft, initial), refusal, setRefusal, bulk }
}

function PickerPanel({ title, subject, groups, selected, withStars = false, searchPlaceholder, requiredMessage, onSave, onClose }: PanelProps) {
  const [saving, setSaving] = useState(false)
  const { ordered, draft, change, edits, dirty, refusal, setRefusal, bulk } = usePickerDraft({ groups, selected, withStars, requiredMessage, frozen: saving })
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<ReadonlySet<string> | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useUnsavedChanges(dirty)

  const grouped = ordered.length > 1
  const allItems = useMemo(() => ordered.flatMap((g) => g.items), [ordered])
  const allByGroup = useMemo(() => new Map(ordered.map((g) => [g.key, g.items])), [ordered])
  const searchable = grouped || allItems.length > SEARCH_FROM_ITEMS
  const words = useMemo(() => searchWords(query), [query])
  const filtering = words.length > 0 || only !== null
  const visible = useMemo(() => filterGroups(ordered, { words, only }), [ordered, words, only])
  const count = selectionCount(allItems, draft)

  const requestClose = () => {
    if (saving) return
    if (dirty) setConfirming(true)
    else onClose()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || saving) return
    setSaving(true)
    setRefusal(null)
    const message = await onSave(new Map(draft))
    if (message === null) return onClose()
    setSaving(false)
    setRefusal(message)
  }

  return (
    <SheetContent
      ref={contentRef}
      hideClose
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        ;(searchRef.current ?? contentRef.current?.querySelector<HTMLElement>('button[role="checkbox"]:not(:disabled)'))?.focus()
      }}
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onInteractOutside={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{withStars ? `${subject} · ${t(`${P}.starsHint`)}` : subject}</SheetDescription>
      </SheetHeader>
      {/* Custom X: it closes through the guard. Out of the tab order (CLAUDE.md). */}
      <button type="button" tabIndex={-1} onClick={requestClose} className={closeButtonClasses}>
        <X aria-hidden className="h-4 w-4" />
        <span className="sr-only">{t('common.close')}</span>
      </button>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
        {/* While saving, the list is inert: the draft being saved is the one on screen. `contents`
            keeps the toolbar and the scrolling body in the form's column. */}
        <fieldset disabled={saving} className="contents">
          <PickerToolbar
            searchRef={searchable ? searchRef : null}
            query={query}
            onQueryChange={setQuery}
            searchPlaceholder={searchPlaceholder}
            count={count}
            selectedOnly={searchable ? { on: only !== null, onChange: (on) => setOnly(on ? new Set(draft.keys()) : null) } : null}
            expandAll={
              grouped && !filtering
                ? { allOpen: ordered.every((g) => expanded.has(g.key)), onChange: (open) => setExpanded(open ? new Set(ordered.map((g) => g.key)) : new Set()) }
                : null
            }
          />
          <SheetBody className="pt-1">
            <PickerBody
              visible={visible}
              grouped={grouped}
              filtering={filtering}
              searching={words.length > 0}
              expanded={expanded}
              onExpandedChange={setExpanded}
              allItems={allByGroup}
              onGroupAction={(items, action) => change((prev) => applyGroupAction(prev, items, action), { isBulk: true })}
              rows={{ draft, words, withStars, ...edits }}
            />
          </SheetBody>
        </fieldset>
        <PickerAnnouncements searchResults={words.length > 0 ? visible.reduce((n, g) => n + g.items.length, 0) : null} count={bulk ? count : null} />
        {refusal && (
          <div className="shrink-0 px-5 pb-3">
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription className="text-foreground">{refusal}</AlertDescription>
            </Alert>
          </div>
        )}
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            aria-disabled={saving || undefined}
            onClick={ignoreWhenInactive(saving, onClose)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
          <SaveButton pending={saving} disabled={!dirty} variant={dirty || saving ? 'default' : 'outline'} />
        </SheetFooter>
      </form>
      <DiscardDialog open={confirming} onOpenChange={setConfirming} onDiscard={onClose} />
    </SheetContent>
  )
}

interface PickerToolbarProps {
  /** Null for a short flat list: no search field. */
  searchRef: Ref<HTMLInputElement> | null
  query: string
  onQueryChange: (query: string) => void
  searchPlaceholder: string
  count: { selected: number; total: number }
  selectedOnly: { on: boolean; onChange: (on: boolean) => void } | null
  expandAll: { allOpen: boolean; onChange: (open: boolean) => void } | null
}

/** Above the list, never scrolled away: the search, the running total, « Sélectionnés seulement », « Tout ouvrir ». */
function PickerToolbar({ searchRef, query, onQueryChange, searchPlaceholder, count, selectedOnly, expandAll }: PickerToolbarProps) {
  return (
    <div className="shrink-0 space-y-2 border-b border-border px-5 pb-3">
      {searchRef && <SearchBox inputRef={searchRef} value={query} onChange={onQueryChange} placeholder={searchPlaceholder} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="mr-auto text-xs tabular text-muted-foreground">
          {t(`${P}.count`, { selected: String(count.selected), total: String(count.total) })}
        </p>
        {selectedOnly && <SelectedOnlySwitch on={selectedOnly.on} onChange={selectedOnly.onChange} />}
        {expandAll && (
          <Button type="button" variant="ghost" size="sm" className="px-2" onClick={() => expandAll.onChange(!expandAll.allOpen)}>
            {t(expandAll.allOpen ? `${P}.collapseAll` : `${P}.expandAll`)}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * What a screen reader hears without moving: the number of matches while searching (« Aucun
 * résultat » included), and the new total after a category's bulk action. A single tick is not
 * announced here: its checkbox already says its state, and the total on every tick would be noise.
 * Both regions stay mounted (empty when silent), so their next text is read.
 */
function PickerAnnouncements({ searchResults, count }: { searchResults: number | null; count: { selected: number; total: number } | null }) {
  return (
    <>
      <p role="status" className="sr-only">
        {searchResults === null
          ? ''
          : searchResults === 0
            ? t(`${P}.results.none`)
            : searchResults === 1
              ? t(`${P}.results.one`)
              : t(`${P}.results.other`, { count: String(searchResults) })}
      </p>
      <p aria-live="polite" className="sr-only">
        {count ? t(`${P}.count`, { selected: String(count.selected), total: String(count.total) }) : ''}
      </p>
    </>
  )
}

interface PickerBodyProps {
  visible: PickerGroup[]
  grouped: boolean
  filtering: boolean
  searching: boolean
  /** Each category's full item list, by key (counts and bulk actions ignore the filter). */
  allItems: ReadonlyMap<string, readonly PickerItem[]>
  expanded: ReadonlySet<string>
  onExpandedChange: (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void
  onGroupAction: (items: readonly PickerItem[], action: 'select' | 'deselect') => void
  rows: PickerRowsContext
}

/** The list: categories (folding unless filtering), a flat list, or the two-line empty state of a filter. */
function PickerBody({ visible, grouped, filtering, searching, allItems, expanded, onExpandedChange, onGroupAction, rows }: PickerBodyProps) {
  if (visible.length === 0) {
    return searching ? (
      // « Aucun résultat » is announced by the status region: the title is not read twice.
      <EmptyState title={t(`${P}.noResults.title`)} body={t(`${P}.noResults.body`)} titleAriaHidden />
    ) : (
      <EmptyState title={t(`${P}.noneSelected.title`)} body={t(`${P}.noneSelected.body`)} />
    )
  }
  if (!grouped) return <PickerFlatList items={visible[0]?.items ?? []} {...rows} />
  return visible.map((group) => (
    <PickerGroupSection
      key={group.key}
      group={group}
      allItems={allItems.get(group.key) ?? group.items}
      filtering={filtering}
      open={expanded.has(group.key)}
      onOpenChange={(open) => onExpandedChange((prev) => toggled(prev, group.key, open))}
      onGroupAction={onGroupAction}
      {...rows}
    />
  ))
}

const toggled = (set: ReadonlySet<string>, key: string, on: boolean) => {
  const next = new Set(set)
  if (on) next.add(key)
  else next.delete(key)
  return next
}

function SearchBox({ inputRef, value, onChange, placeholder }: { inputRef: Ref<HTMLInputElement>; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-[9px] top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Enter would submit the sheet's form: a search field never saves.
        onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
        aria-label={t(`${P}.searchLabel`)}
        placeholder={placeholder}
        maxLength={120}
        autoComplete="off"
        className="pl-[30px]"
      />
    </div>
  )
}

function SelectedOnlySwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={on} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {t(`${P}.selectedOnly`)}
      </Label>
    </div>
  )
}

/** « Abandonner les modifications ? »: « Continuer la modification » is the safe default (focused first). */
function DiscardDialog({ open, onOpenChange, onDiscard }: { open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${P}.discard.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${P}.discard.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t(`${P}.discard.keep`)}</AlertDialogCancel>
          <Button variant="destructive" onClick={onDiscard}>
            {t(`${P}.discard.confirm`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
