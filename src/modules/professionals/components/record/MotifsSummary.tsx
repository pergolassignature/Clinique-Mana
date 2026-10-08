import { useId, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { listLabel } from '../../lib/display'
import type { MotifGroupSummary, MotifSummary } from '../../lib/motif-summary'

const S = 'modules.professionals.record.overview.matching.motifSummary'

/**
 * The professional's motifs in a few lines (P4-73): one line when nearly all are held, else one
 * per category (« Tous », the names, « Tous sauf … », or « 4 sur 9 » unfolding to the names), and
 * every name only on demand (« Voir les 72 motifs »).
 */
export function MotifsSummary({ summary }: { summary: MotifSummary }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const count = summary.full.reduce((n, group) => n + group.names.length, 0)
  const { overall } = summary
  return (
    <div className="space-y-1">
      {overall?.kind === 'all' && <p>{t(`${S}.allOverall`, { count: String(summary.total) })}</p>}
      {overall?.kind === 'allBut' && (
        <p>{t(`${S}.allButOverall`, { names: listLabel(overall.missing), selected: String(summary.selected), total: String(summary.total) })}</p>
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
      {summary.archived.length > 0 && <p className="text-muted-foreground">{t(`${S}.archived`, { names: listLabel(summary.archived) })}</p>}
      {summary.condensed && (
        <>
          <Button variant="link" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
            {open ? t(`${S}.hideAll`) : t(`${S}.showAll`, { count: String(count) })}
          </Button>
          {open && (
            <ul id={listId} className="space-y-1 border-l border-border-light pl-3">
              {summary.full.map((group) => (
                <li key={group.key}>
                  <Named name={group.name}>{group.names.join(' · ')}</Named>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
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

/** One category: « Tous », the names, « Tous sauf … », or « 4 sur 9 » that unfolds to the names. */
function GroupLine({ name, summary }: { name: string; summary: MotifGroupSummary }) {
  switch (summary.kind) {
    case 'all':
      return <Named name={name}>{t(`${S}.all`)}</Named>
    case 'names':
      return <Named name={name}>{summary.names.join(' · ')}</Named>
    case 'allBut':
      return <Named name={name}>{t(`${S}.allBut`, { names: listLabel(summary.missing) })}</Named>
    case 'count':
      return (
        <details className="group">
          <summary className="cursor-pointer rounded-sm marker:text-muted-foreground focus-visible:shadow-focus focus-visible:outline-none">
            <Named name={name}>
              <span className="text-link underline-offset-[3px] group-hover:underline">
                {t(`${S}.count`, { selected: String(summary.selected), total: String(summary.total) })}
              </span>
            </Named>
          </summary>
          <p className="pl-4 text-muted-foreground">{summary.names.join(' · ')}</p>
        </details>
      )
  }
}
