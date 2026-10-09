import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import type { MotifCategoryIcon } from '../../lib/constants'
import type { HeldMotif, MotifSummary } from '../../lib/motif-summary'
import { CategoryIcon } from '../CategoryIcon'

/**
 * A category's names: one per line, small, in as many columns as fit (at least 11rem each, at most
 * 3, never wider than the list: the outer `min(100%, …)` keeps one column in a narrow container).
 * The list's own width decides, like a container query (P4-86).
 */
const NAME_COLUMNS = 'grid gap-x-6 gap-y-0.5 grid-cols-[repeat(auto-fill,minmax(min(100%,max(11rem,calc((100%_-_3rem)/3))),1fr))]'

const S = 'modules.professionals.record.overview.matching.motifSummary'
const M = 'modules.professionals.record.overview.matching'

/** One category as the motif lists show it; `count` is the « 9 / 16 » beside the name, if any. */
export interface NamedGroup {
  key: string
  /** Null: one unnamed group (a list that is not grouped). */
  name: string | null
  icon?: MotifCategoryIcon | null
  count?: { selected: number; total: number }
  items: HeldMotif[]
}

/**
 * The professional's motifs, always by name (P4-249): each category's title on its own line, its
 * held motifs under it in compact columns, hairlines between categories. Nothing folds: with every
 * motif held, the list is long but every name is there, never « Tous ». Archived motifs stay in
 * their category, marked.
 */
export function MotifsSummary({ summary }: { summary: MotifSummary }) {
  return (
    <CategoryNames
      groups={summary.groups.map((g) => ({
        key: g.key,
        name: g.name,
        icon: g.icon,
        count: { selected: g.selected, total: g.total },
        items: g.motifs,
      }))}
    />
  )
}

/** Categories and their names (the record's motifs, Historique's details). */
export function CategoryNames({ groups, className }: { groups: NamedGroup[]; className?: string }) {
  return (
    <ul className={cn('divide-y divide-border-light border-y border-border-light text-[13px] leading-5', className)}>
      {groups.map((group) => (
        <li key={group.key} className="py-2">
          {group.name !== null && (
            <p className="mb-1 flex items-center gap-2">
              {group.icon !== undefined &&
                (group.icon ? <CategoryIcon icon={group.icon} className="size-3.5 shrink-0 text-subtle" /> : <span aria-hidden className="size-3.5 shrink-0" />)}
              <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{group.name}</span>
              {group.count && (
                <span className="shrink-0 text-xs tabular text-muted-foreground">
                  <span aria-hidden>{t(`${S}.countShort`, { selected: String(group.count.selected), total: String(group.count.total) })}</span>
                  <span className="sr-only">{t(`${S}.countSr`, { selected: String(group.count.selected), total: String(group.count.total) })}</span>
                </span>
              )}
            </p>
          )}
          <ul className={cn(NAME_COLUMNS, group.icon !== undefined && group.name !== null && 'pl-[22px]')}>
            {group.items.map((item) => (
              <li key={item.id} className="min-w-0 break-words text-foreground">
                {item.name}
                {item.archived && <span className="text-muted-foreground"> ({t(`${M}.archived`)})</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/**
 * A button that unfolds its panel in place. The panel stays mounted (`hidden` while closed), so
 * `aria-controls` always points at an element. The Historique tab's entries use it too.
 */
/** `className` goes on the toggle button (e.g. a taller tap target on a phone). */
export function Disclosure({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn('group inline-flex max-w-full items-start gap-1 rounded-sm text-left', focusRing, className)}
      >
        <Chevron open={open} />
        <span className="min-w-0">{label}</span>
      </button>
      <div id={panelId} hidden={!open} className="mt-2">
        {children}
      </div>
    </div>
  )
}

const Chevron = ({ open }: { open: boolean }) => (
  <ChevronRight
    aria-hidden
    className={cn('mt-[3px] size-3.5 shrink-0 text-subtle transition-transform motion-reduce:transition-none', open && 'rotate-90')}
  />
)
