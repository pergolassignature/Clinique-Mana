import { memo, useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { initialsOf } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import type { ProfessionalListRow } from '../../api/parse'
import { titleOrder, type CatalogView } from '../../lib/catalog-view'
import { recordPath } from '../../lib/constants'
import { fullName, languagesLabel, statusLabel, statusTone } from '../../lib/display'
import { displayStatus } from '../../lib/onboarding'
import { watchFlags } from '../../lib/watch'

const T = 'modules.professionals.list.table'

/**
 * The columns follow the card's width (container queries: `container-inline` and the `cq-480:` /
 * `cq-720:` / `cq-880:` variants, tailwind.config.js), not the window's: the sidebar takes 220px
 * from md up, so the card is narrower at 768px than at 640px. Below 480px: Nom and Statut
 * (the email stays under the name); then Profession; from 720px À surveiller; from 880px Langues
 * (design system: `minmax(0,2fr) minmax(0,1.6fr) 96px 120px minmax(0,1.4fr)`; the status column is 136px
 * so the longest status, « En préparation » (P4-43), is never cut). Every flexible
 * column is `minmax(0, …)` and every text ellipsed, so the table never scrolls sideways.
 */
const GRID = cn(
  'grid grid-cols-[minmax(0,1fr)_136px]',
  'cq-480:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_136px]',
  'cq-720:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_136px_minmax(0,1.4fr)]',
  'cq-880:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_96px_136px_minmax(0,1.4fr)]',
)
const PROFESSION_COLUMN = 'hidden cq-480:block'
const WATCH_COLUMN = 'hidden cq-720:block'
const LANGUAGES_COLUMN = 'hidden cq-880:block'
const CELL = 'min-w-0 px-3 py-2'

/** How long the pointer rests on a row before its record is prefetched. */
const HOVER_INTENT_MS = 120

interface ProfessionalsTableProps {
  /** The page's rows; null while loading (skeleton rows). */
  rows: readonly ProfessionalListRow[] | null
  catalog: CatalogView | undefined
  /** Starts loading a record (row hover or focus). */
  onPrefetch: (id: string) => void
  /** Under the rows: the count and the pagination. */
  footer?: ReactNode
}

/**
 * The list in a Card (padding 0): a grid table (ARIA roles) so each row can be one link, an `<a>`
 * stretched over the row from the name (Ctrl-click opens a tab; the link is the row's only tab
 * stop and is named by the professional).
 */
export function ProfessionalsTable({ rows, catalog, onPrefetch, footer }: ProfessionalsTableProps) {
  return (
    <div className="container-inline rounded-lg border border-border bg-card">
      <div role="table" aria-label={t(`${T}.label`)} aria-busy={rows === null || undefined} className="text-sm">
        <div role="rowgroup">
          <div role="row" className={cn(GRID, 'text-2xs font-medium uppercase tracking-wide text-muted-foreground')}>
            <span role="columnheader" className={CELL}>
              {t(`${T}.name`)}
            </span>
            <span role="columnheader" className={cn(CELL, PROFESSION_COLUMN)}>
              {t(`${T}.profession`)}
            </span>
            <span role="columnheader" className={cn(CELL, LANGUAGES_COLUMN)}>
              {t(`${T}.languages`)}
            </span>
            <span role="columnheader" className={CELL}>
              {t(`${T}.status`)}
            </span>
            <span role="columnheader" className={cn(CELL, WATCH_COLUMN)}>
              {t(`${T}.watch`)}
            </span>
          </div>
        </div>
        <div role="rowgroup">
          {rows === null || !catalog
            ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
            : rows.map((row) => <ProfessionalRow key={row.id} row={row} catalog={catalog} onPrefetch={onPrefetch} />)}
        </div>
      </div>
      {footer}
    </div>
  )
}

const ProfessionalRow = memo(function ProfessionalRow({
  row,
  catalog,
  onPrefetch,
}: {
  row: ProfessionalListRow
  catalog: CatalogView
  onPrefetch: (id: string) => void
}) {
  const name = fullName(row)
  const title = row.primaryTitleId ? catalog.byId.titles.get(row.primaryTitleId) : undefined
  const licence = [titleOrder(catalog, row.primaryTitleId)?.acronym, row.primaryLicenceNumber].filter(Boolean).join(' ')
  const flag = watchFlags(row)[0]
  const status = displayStatus(row.status, row.onboarding)
  const prefetch = () => onPrefetch(row.id)
  // A pointer resting on the row, not one crossing the list on its way elsewhere.
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cancelHover = () => clearTimeout(hover.current)
  useEffect(() => cancelHover, [])
  return (
    <div
      role="row"
      onMouseEnter={() => {
        cancelHover()
        hover.current = setTimeout(prefetch, HOVER_INTENT_MS)
      }}
      onMouseLeave={cancelHover}
      className={cn(GRID, 'relative min-h-10 items-center border-t border-border transition-colors duration-120 hover:bg-card-hover')}
    >
      <div role="rowheader" className={cn(CELL, 'flex items-center gap-2.5')}>
        <Avatar size="sm" aria-hidden>
          <AvatarFallback className="text-muted-foreground">{initialsOf(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <Link
            to={recordPath(row.id)}
            onFocus={prefetch}
            className="block truncate font-medium text-foreground outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
          >
            {name}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
        </div>
      </div>
      <div role="cell" className={cn(CELL, PROFESSION_COLUMN)}>
        {title ? (
          <>
            <span className="block truncate">{title.name}</span>
            {licence && <span className="tabular block truncate text-xs text-muted-foreground">{licence}</span>}
          </>
        ) : (
          <Nothing />
        )}
      </div>
      <div role="cell" className={cn(CELL, 'truncate text-muted-foreground', LANGUAGES_COLUMN)}>
        {languagesLabel(row.languageIds, catalog) || <Nothing />}
      </div>
      <div role="cell" className={cn(CELL, 'flex')}>
        <Badge variant={statusTone(status)}>{statusLabel(status)}</Badge>
      </div>
      <div
        role="cell"
        title={flag?.label}
        className={cn(CELL, 'truncate text-xs', WATCH_COLUMN, flag?.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground')}
      >
        {flag ? flag.label : <Nothing label={t(`${T}.nothingToWatch`)} />}
      </div>
    </div>
  )
})

/** « — », muted; screen readers hear `label` instead when it stands for something. */
function Nothing({ label }: { label?: string }) {
  return label ? (
    <>
      <span aria-hidden className="text-subtle">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  ) : (
    <span className="text-subtle">—</span>
  )
}

function SkeletonRow() {
  return (
    <div role="row" className={cn(GRID, 'min-h-10 items-center border-t border-border')}>
      <div role="cell" className={cn(CELL, 'flex items-center gap-2.5')}>
        <Skeleton className="size-6 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-40 max-w-full" />
      </div>
      <div role="cell" className={cn(CELL, PROFESSION_COLUMN)}>
        <Skeleton className="h-3 w-28 max-w-full" />
      </div>
      <div role="cell" className={cn(CELL, LANGUAGES_COLUMN)}>
        <Skeleton className="h-3 w-12" />
      </div>
      <div role="cell" className={CELL}>
        <Skeleton className="h-3 w-14" />
      </div>
      <div role="cell" className={cn(CELL, WATCH_COLUMN)}>
        <Skeleton className="h-3 w-24 max-w-full" />
      </div>
    </div>
  )
}
