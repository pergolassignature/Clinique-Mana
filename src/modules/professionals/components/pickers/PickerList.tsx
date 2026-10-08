import { useId } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { HighlightedText } from '@/shared/components/HighlightedText'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { focusRing } from '@/shared/ui/field-classes'
import { StarToggle } from '@/shared/ui/star-toggle'
import { groupAction, selectionCount, type PickerGroup, type PickerItem, type PickerSelection } from '../../lib/set-picker'
import { CategoryIcon } from '../CategoryIcon'

const P = 'modules.professionals.record.matching.picker'

/** What the rows of a picker need from the sheet: the draft and how to change it. */
export interface PickerRowsContext {
  draft: PickerSelection
  /** The search's folded words, highlighted in the labels. */
  words: readonly string[]
  withStars: boolean
  /** The one item that cannot be unticked (the last of a list that needs one), and why. */
  locked: { id: string; reason: string } | null
  onToggle: (item: PickerItem, checked: boolean) => void
  onStar: (id: string) => void
}

interface PickerGroupSectionProps extends PickerRowsContext {
  /** The rows to show (the matches, while filtering). */
  group: PickerGroup
  /** Every item of the category: what its count and « Tout sélectionner » are about, filtered or not. */
  allItems: readonly PickerItem[]
  /** Searching or « Sélectionnés seulement »: the matches show under a plain heading, nothing folds. */
  filtering: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onGroupAction: (items: readonly PickerItem[], action: 'select' | 'deselect') => void
}

/**
 * One category of a grouped picker: a disclosure line (chevron, icon, name, « 3 sur 16 ») with
 * « Tout sélectionner » / « Tout désélectionner » on the right, and its rows, kept mounted under
 * `hidden` so `aria-controls` always points at them. Folded, a category is one calm line even when
 * all its motifs are ticked. While filtering, the matches show under a plain heading.
 */
export function PickerGroupSection({ group, allItems, filtering, open, onOpenChange, onGroupAction, ...rows }: PickerGroupSectionProps) {
  const panelId = useId()
  const { selected, total } = selectionCount(allItems, rows.draft)
  const action = filtering ? null : groupAction(allItems, rows.draft)
  const heading = (
    <>
      {group.icon && <CategoryIcon icon={group.icon} className="size-3.5 shrink-0 text-subtle" />}
      <span className="min-w-0 break-words font-medium text-foreground">
        <HighlightedText text={group.label} words={rows.words} />
      </span>
      <span className="ml-auto shrink-0 pl-2 text-xs tabular text-muted-foreground">
        {t(`${P}.groupCount`, { selected: String(selected), total: String(total) })}
      </span>
    </>
  )
  return (
    <section className="border-b border-border-light last:border-b-0">
      <div className="flex min-h-10 items-center gap-2 py-1">
        <h3 className="min-w-0 flex-1 text-sm">
          {filtering ? (
            <span className="flex items-center gap-2 py-1">{heading}</span>
          ) : (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => onOpenChange(!open)}
              className={cn('flex w-full items-center gap-2 rounded-sm py-1 text-left', focusRing)}
            >
              <ChevronRight
                aria-hidden
                className={cn('size-3.5 shrink-0 text-subtle transition-transform motion-reduce:transition-none', open && 'rotate-90')}
              />
              {heading}
            </button>
          )}
        </h3>
        {action && (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2 text-link" onClick={() => onGroupAction(allItems, action)}>
            {t(action === 'select' ? `${P}.selectAll` : `${P}.deselectAll`)}
            <span className="sr-only"> {t(`${P}.inGroup`, { group: group.label })}</span>
          </Button>
        )}
      </div>
      <ul id={panelId} hidden={!filtering && !open} className="pb-2 pl-[22px]">
        {group.items.map((item) => (
          <PickerItemRow key={item.id} item={item} {...rows} />
        ))}
      </ul>
    </section>
  )
}

/** The rows of a flat picker (a single group): no header, every row in view. */
export function PickerFlatList({ items, ...rows }: PickerRowsContext & { items: readonly PickerItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <PickerItemRow key={item.id} item={item} {...rows} />
      ))}
    </ul>
  )
}

/**
 * A checkbox row: the label (search words marked), « Réservé » / « Archivé », the reason it
 * cannot be added (or removed, for the last required item), and ★ once held in a starred list.
 * An item that cannot be added is disabled only while unticked: one already held can be removed.
 */
function PickerItemRow({ item, draft, words, withStars, locked, onToggle, onStar }: PickerRowsContext & { item: PickerItem }) {
  const id = useId()
  const entry = draft.get(item.id)
  const checked = entry !== undefined
  const lockedHere = checked && locked?.id === item.id
  const reason = lockedHere ? locked.reason : item.blockedReason
  const disabled = (!checked && Boolean(item.blockedReason)) || lockedHere
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onToggle(item, value === true)}
        aria-describedby={reason ? `${id}-reason` : undefined}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <label id={`${id}-label`} htmlFor={id} className={cn('min-w-0 break-words', disabled ? 'text-muted-foreground' : 'cursor-pointer text-foreground')}>
            <HighlightedText text={item.label} words={words} />
          </label>
          {item.restricted && <Badge variant="info">{t(`${P}.restricted`)}</Badge>}
          {item.archived && <Badge variant="secondary">{t(`${P}.archived`)}</Badge>}
        </span>
        {reason && (
          <p id={`${id}-reason`} className="mt-0.5 text-xs text-muted-foreground">
            {reason}
          </p>
        )}
      </div>
      {withStars && entry && <StarToggle specialized={entry.specialized} onToggle={() => onStar(item.id)} describedBy={`${id}-label`} />}
    </li>
  )
}
