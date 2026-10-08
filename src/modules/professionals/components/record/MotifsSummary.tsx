import { Fragment, useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { listLabel } from '../../lib/display'
import type { HeldMotif, MotifGroupSummary, MotifSummary } from '../../lib/motif-summary'

const S = 'modules.professionals.record.overview.matching.motifSummary'
const M = 'modules.professionals.record.overview.matching'

/**
 * The professional's motifs in a few lines (P4-73): one line when nearly all are held, else one
 * per category (the names, « Tous (9) », « Tous sauf … » or « 4 sur 9 »). Every summarised line
 * is a disclosure that unfolds in place to the names it stands for: the overall line to the whole
 * list by category, a category line to its names. A line showing its names has nothing to unfold.
 */
export function MotifsSummary({ summary }: { summary: MotifSummary }) {
  const { overall, archived } = summary
  return (
    <div className="space-y-1">
      {overall && (
        <Disclosure
          label={
            <Linkish>
              {overall.kind === 'all'
                ? t(`${S}.allOverall`, { count: String(summary.total) })
                : t(`${S}.allButOverall`, { names: listLabel(overall.missing), selected: String(summary.selected), total: String(summary.total) })}
            </Linkish>
          }
        >
          <ul className="space-y-1 border-l border-border-light pl-3">
            {summary.full.map((group) => (
              <li key={group.key}>
                <Named name={group.name}>
                  <Motifs motifs={group.motifs} />
                </Named>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {!overall && summary.groups.length > 0 && (
        <ul className="space-y-1">
          {summary.groups.map((group) => (
            <li key={group.key}>
              <GroupLine name={group.name} summary={group.summary} />
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <p className="text-muted-foreground">
          {archived.length === 1 ? t(`${S}.archivedOne`, { name: archived[0] ?? '' }) : t(`${S}.archivedOther`, { names: listLabel(archived) })}
        </p>
      )}
    </div>
  )
}

/**
 * A button that unfolds its panel in place. The panel stays mounted (`hidden` while closed), so
 * `aria-controls` always points at an element. The Historique tab's entries use it too.
 */
export function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn('group inline-flex max-w-full items-start gap-1 rounded-sm text-left', focusRing)}
      >
        <ChevronRight
          aria-hidden
          className={cn('mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')}
        />
        <span className="min-w-0">{label}</span>
      </button>
      <div id={panelId} hidden={!open} className="mt-1 pl-[18px]">
        {children}
      </div>
    </>
  )
}

/** The summarised words of a disclosure, drawn as a link (underlined on hover of the whole line). */
function Linkish({ children }: { children: ReactNode }) {
  return <span className="text-link underline-offset-[3px] group-hover:underline">{children}</span>
}

function Named({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <span className="font-medium">{name}</span>
      {' : '}
      {children}
    </>
  )
}

/** « Motif 1.1 · Ancien motif (archivé) »: text nodes in the parent, archived ones marked. */
function Motifs({ motifs }: { motifs: HeldMotif[] }) {
  return motifs.map((motif, index) => (
    <Fragment key={`${motif.archived ? 'a' : 'm'}:${motif.name}`}>
      {index > 0 && ' · '}
      {motif.name}
      {motif.archived && <span className="text-muted-foreground"> ({t(`${M}.archived`)})</span>}
    </Fragment>
  ))
}

/** One category: its names, or « Tous (9) », « Tous sauf … », « 4 sur 9 » unfolding to the names. */
function GroupLine({ name, summary }: { name: string; summary: MotifGroupSummary }) {
  if (summary.kind === 'names') return <Named name={name}>{summary.names.join(' · ')}</Named>
  const value =
    summary.kind === 'all'
      ? t(`${S}.all`, { count: String(summary.names.length) })
      : summary.kind === 'allBut'
        ? t(`${S}.allBut`, { names: listLabel(summary.missing) })
        : t(`${S}.count`, { selected: String(summary.selected), total: String(summary.total) })
  return (
    <Disclosure
      label={
        <Named name={name}>
          <Linkish>{value}</Linkish>
        </Named>
      }
    >
      <p className="text-muted-foreground">{summary.names.join(' · ')}</p>
    </Disclosure>
  )
}
