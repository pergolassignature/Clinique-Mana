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

/**
 * Aperçu's lighter version (Jonathan, 2026-10-08): every category on its own line with its count,
 * its names folded until it is opened; « Afficher les 72 motifs » opens them all. Never « Tous »:
 * every name is one click away (P4-249). Jumelage keeps `MotifsSummary`, open.
 */
export function FoldedMotifsSummary({ summary }: { summary: MotifSummary }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const baseId = useId()
  const held = summary.groups.reduce((sum, g) => sum + g.motifs.length, 0)
  const allOpen = open.size === summary.groups.length
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={allOpen}
        onClick={() => setOpen(allOpen ? new Set() : new Set(summary.groups.map((g) => g.key)))}
        className={cn('self-start rounded-sm text-sm font-medium text-primary hover:underline', focusRing)}
      >
        {allOpen ? t(`${S}.hideAll`) : held === 1 ? t(`${S}.showOne`) : t(`${S}.showAll`, { count: String(held) })}
      </button>
      <ul className="divide-y divide-border-light border-y border-border-light text-sm">
        {summary.groups.map((group) => {
          const isOpen = open.has(group.key)
          const panelId = `${baseId}-${group.key}`
          return (
            <li key={group.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(group.key)}
                className={cn('flex w-full items-center gap-2 rounded-sm py-2 text-left', focusRing)}
              >
                <Chevron open={isOpen} />
                {group.icon ? <CategoryIcon icon={group.icon} className="size-3.5 shrink-0 text-subtle" /> : <span aria-hidden className="size-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{group.name}</span>
                <span className="shrink-0 text-xs tabular text-muted-foreground">
                  <span aria-hidden>{t(`${S}.countShort`, { selected: String(group.selected), total: String(group.total) })}</span>
                  <span className="sr-only">{t(`${S}.countSr`, { selected: String(group.selected), total: String(group.total) })}</span>
                </span>
              </button>
              <ul id={panelId} hidden={!isOpen} className={cn(NAME_COLUMNS, 'pb-2 pl-[44px]')}>
                {group.motifs.map((item) => (
                  <li key={item.id} className="min-w-0 break-words text-foreground">
                    {item.name}
                    {item.archived && <span className="text-muted-foreground"> ({t(`${M}.archived`)})</span>}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Categories and their names (the record's motifs, Historique's details). */
export function CategoryNames({ groups, className }: { groups: NamedGroup[]; className?: string }) {
  return (
    <ul className={cn('divide-y divide-border-light border-y border-border-light text-sm', className)}>
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
