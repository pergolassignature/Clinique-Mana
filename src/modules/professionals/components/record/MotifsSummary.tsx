import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { focusRing } from '@/shared/ui/field-classes'
import { listLabel } from '../../lib/display'
import type { MotifSummary, MotifSummaryGroup } from '../../lib/motif-summary'
import { CategoryIcon } from '../CategoryIcon'

const S = 'modules.professionals.record.overview.matching.motifSummary'
const M = 'modules.professionals.record.overview.matching'

/**
 * The professional's motifs, light at any density (P4-73). Each category is a header row (icon,
 * name, « 6 / 16 ») over its short summary: the names when up to three are held, else « Tous »,
 * « Tous sauf … » or the count alone. A summarised category is a disclosure that unfolds to its
 * motifs, one per line in 1 to 3 columns (by the box's width, container queries). When nearly every
 * motif is held, one line (« Tous les motifs (72) ») unfolds to the categories, each still folded:
 * eight calm rows, never 72 names at once. Panels stay mounted under `hidden`, so `aria-controls`
 * always points at an element.
 */
export function MotifsSummary({ summary }: { summary: MotifSummary }) {
  const { overall, archived } = summary
  const categories = <CategoryList groups={summary.groups} />
  return (
    <div className="container-inline space-y-2 text-sm">
      {overall ? (
        <Disclosure
          label={
            <span className="text-link underline-offset-[3px] group-hover:underline">
              {overall.kind === 'all'
                ? t(`${S}.allOverall`, { count: String(summary.total) })
                : t(`${S}.allButOverall`, { names: listLabel(overall.missing), selected: String(summary.selected), total: String(summary.total) })}
            </span>
          }
        >
          {categories}
        </Disclosure>
      ) : (
        categories
      )}
      {archived.length > 0 && (
        <p className="text-muted-foreground">
          {archived.length === 1 ? t(`${S}.archivedOne`, { name: archived[0] ?? '' }) : t(`${S}.archivedOther`, { names: listLabel(archived) })}
        </p>
      )}
    </div>
  )
}

/** A button that unfolds its panel in place (the overall line). */
function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn('group inline-flex max-w-full items-start gap-1 rounded-sm text-left', focusRing)}
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

/** The categories, hairlines between them, with « Ouvrir tout / Fermer tout » when several fold. */
function CategoryList({ groups }: { groups: MotifSummaryGroup[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const foldable = groups.filter((g) => g.summary.kind !== 'names').map((g) => g.key)
  const allOpen = foldable.length > 0 && foldable.every((key) => open.has(key))
  return (
    <div>
      {foldable.length > 1 && (
        <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-1 px-2" onClick={() => setOpen(allOpen ? new Set() : new Set(foldable))}>
          {t(allOpen ? `${S}.closeAll` : `${S}.openAll`)}
        </Button>
      )}
      <ul className="divide-y divide-border-light border-y border-border-light">
        {groups.map((group) => (
          <li key={group.key} className="py-2">
            <CategoryRow
              group={group}
              open={open.has(group.key)}
              onOpenChange={(value) =>
                setOpen((prev) => {
                  const next = new Set(prev)
                  if (value) next.add(group.key)
                  else next.delete(group.key)
                  return next
                })
              }
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The short summary under a category's name; none for « N sur M » (the count says it). */
function shortSummary({ summary }: MotifSummaryGroup): string | null {
  switch (summary.kind) {
    case 'names':
      return listLabel(summary.names)
    case 'all':
      return t(`${S}.all`)
    case 'allBut':
      return t(`${S}.allBut`, { names: listLabel(summary.missing) })
    case 'count':
      return null
  }
}

/**
 * One category: the name on its own line (13/600) with the count at the right, the short summary
 * under it. Named categories (up to three held) have nothing to unfold; the others are a
 * disclosure over their motifs.
 */
function CategoryRow({ group, open, onOpenChange }: { group: MotifSummaryGroup; open: boolean; onOpenChange: (open: boolean) => void }) {
  const panelId = useId()
  const summary = shortSummary(group)
  const header = (
    <>
      <span className="flex items-center gap-2">
        {group.icon ? <CategoryIcon icon={group.icon} className="size-3.5 shrink-0 text-subtle" /> : <span aria-hidden className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{group.name}</span>
        <span className="shrink-0 text-xs tabular text-muted-foreground">
          <span aria-hidden>{t(`${S}.countShort`, { selected: String(group.selected), total: String(group.total) })}</span>
          <span className="sr-only">{t(`${S}.countSr`, { selected: String(group.selected), total: String(group.total) })}</span>
        </span>
      </span>
      {summary && <span className="mt-0.5 block pl-[22px] text-muted-foreground">{summary}</span>}
    </>
  )
  if (group.summary.kind === 'names') return <div className="pl-[18px]">{header}</div>
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className={cn('flex w-full items-start gap-1 rounded-sm text-left', focusRing)}
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1">{header}</span>
      </button>
      <ul id={panelId} hidden={!open} className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 pl-[40px] cq-480:grid-cols-2 cq-720:grid-cols-3">
        {group.motifs.map((motif) => (
          <li key={`${motif.archived ? 'a' : 'm'}:${motif.name}`} className="min-w-0 break-words text-foreground">
            {motif.name}
            {motif.archived && <span className="text-muted-foreground"> ({t(`${M}.archived`)})</span>}
          </li>
        ))}
      </ul>
    </>
  )
}
