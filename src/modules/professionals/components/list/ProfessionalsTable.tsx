import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useSignedFileUrls } from '@/core/storage/hooks'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import type { ProfessionalListRow } from '../../api/parse'
import { titleOrder, type CatalogView } from '../../lib/catalog-view'
import { recordPath } from '../../lib/constants'
import { fullName, languagesLabel, statusLabel, statusTone } from '../../lib/display'
import { hasMissingDocuments } from '../../lib/filters'
import { displayStatus } from '../../lib/onboarding'
import { titleLabel } from '../../lib/title-label'
import { watchFlags } from '../../lib/watch'
import { ProfessionalAvatar } from '../ProfessionalAvatar'
import { useImageRetry } from '../use-image-retry'
import { useRowsInView } from './use-rows-in-view'

const T = 'modules.professionals.list.table'

/**
 * The columns follow the card's width (container queries: `container-inline` and the `cq-480:` /
 * `cq-720:` / `cq-880:` variants, tailwind.config.js), not the window's: the sidebar takes 220px
 * from md up, so the card is narrower at 768px than at 640px. Below 480px: Nom and Statut
 * (the email stays under the name, « Documents 2 / 3 » under the status); then Profession; from
 * 720px Documents and À surveiller; from 880px Langues (design system: `minmax(0,2fr) minmax(0,1.6fr)
 * 96px 120px minmax(0,1.4fr)`; the status column is 136px so the longest status, « En préparation »
 * (P4-43), is never cut; Documents is 104px, its header's width). Every flexible
 * column is `minmax(0, …)` and every text ellipsed, so the table never scrolls sideways, except
 * « À surveiller », which wraps: its sentence (« Assurance expirée depuis le 5 oct. 2026 ») must read whole.
 */
const GRID = cn(
  'grid grid-cols-[minmax(0,1fr)_136px]',
  'cq-480:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_136px]',
  'cq-720:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_136px_104px_minmax(0,1.4fr)]',
  'cq-880:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_96px_136px_104px_minmax(0,1.4fr)]',
)
const PROFESSION_COLUMN = 'hidden cq-480:block'
const DOCUMENTS_COLUMN = 'hidden cq-720:block'
/** Below 720px the documents read under the status instead. */
const DOCUMENTS_UNDER_STATUS = 'cq-720:hidden'
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
 *
 * Photos: only the rows that have come into view (`useRowsInView`) have theirs signed, in one
 * `storage-sign` batch per scroll (`useSignedFileUrls`), never one call per row (120 an hour per
 * person). Initials while it loads, without a photo, or when it cannot be read.
 */
export function ProfessionalsTable({ rows, catalog, onPrefetch, footer }: ProfessionalsTableProps) {
  const { seen, observe } = useRowsInView()
  const photoIds = useMemo(
    () => (rows ?? []).flatMap((row) => (row.photoFileId !== null && seen.has(row.id) ? [row.photoFileId] : [])),
    [rows, seen],
  )
  const photos = useSignedFileUrls(photoIds)
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
            <span role="columnheader" className={cn(CELL, DOCUMENTS_COLUMN)}>
              {t(`${T}.documents`)}
            </span>
            <span role="columnheader" className={cn(CELL, WATCH_COLUMN)}>
              {t(`${T}.watch`)}
            </span>
          </div>
        </div>
        <div role="rowgroup">
          {rows === null || !catalog
            ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
            : rows.map((row) => (
                <ProfessionalRow
                  key={row.id}
                  row={row}
                  catalog={catalog}
                  onPrefetch={onPrefetch}
                  observe={observe}
                  photoUrl={row.photoFileId ? photos.urls.get(row.photoFileId) : undefined}
                  refetchPhoto={photos.refetchFor}
                />
              ))}
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
  observe,
  photoUrl,
  refetchPhoto,
}: {
  row: ProfessionalListRow
  catalog: CatalogView
  onPrefetch: (id: string) => void
  /** Tells the table when the row comes into view (its photo is signed then). */
  observe: (id: string) => (element: HTMLElement | null) => (() => void) | undefined
  /** The photo's signed URL once the row has been in view; undefined before, or without one. */
  photoUrl: string | undefined
  refetchPhoto: (fileId: string) => Promise<{ isError: boolean }>
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
  const rowRef = useMemo(() => observe(row.id), [observe, row.id])
  const photo = useImageRetry(row.photoFileId, photoUrl, () => (row.photoFileId ? refetchPhoto(row.photoFileId) : Promise.resolve({ isError: true })))
  return (
    <div
      ref={rowRef}
      role="row"
      onMouseEnter={() => {
        cancelHover()
        hover.current = setTimeout(prefetch, HOVER_INTENT_MS)
      }}
      onMouseLeave={cancelHover}
      className={cn(GRID, 'relative min-h-10 items-center border-t border-border transition-colors duration-120 hover:bg-card-hover')}
    >
      <div role="rowheader" className={cn(CELL, 'flex items-center gap-2.5')}>
        <ProfessionalAvatar name={name} url={photo.dead ? null : photoUrl} size="sm" onImageError={photo.onError} />
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
            <span className="block truncate">{titleLabel(title, row.gender)}</span>
            {licence && <span className="tabular block truncate text-xs text-muted-foreground">{licence}</span>}
          </>
        ) : (
          <Nothing />
        )}
      </div>
      <div role="cell" className={cn(CELL, 'truncate text-muted-foreground', LANGUAGES_COLUMN)}>
        {languagesLabel(row.languageIds, catalog) || <Nothing />}
      </div>
      <div role="cell" className={cn(CELL, 'flex flex-col items-start gap-0.5')}>
        <Badge variant={statusTone(status)}>{statusLabel(status)}</Badge>
        <DocumentsCount row={row} className={DOCUMENTS_UNDER_STATUS} long />
      </div>
      <div role="cell" className={cn(CELL, DOCUMENTS_COLUMN)}>
        <DocumentsCount row={row} />
      </div>
      {/* Wraps (two lines at most in practice), never ellipsed: « Assurance expirée depuis le 5 oct. 2026 » reads whole. */}
      <div
        role="cell"
        className={cn(CELL, 'text-pretty break-words text-xs', WATCH_COLUMN, flag?.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground')}
      >
        {flag ? flag.label : <Nothing label={t(`${T}.nothingToWatch`)} />}
      </div>
    </div>
  )
})

/**
 * « 2 / 3 » (« Documents 2 / 3 » when `long`, under the status below 720px): the required documents
 * in order out of the required ones; incomplete reads in the body colour, complete muted. Screen
 * readers and the tooltip say it whole (« 2 documents requis sur 3 en règle »). None required: « — ».
 */
function DocumentsCount({ row, long = false, className }: { row: ProfessionalListRow; long?: boolean; className?: string }) {
  const { documentsDone: done, documentsRequired: required } = row
  if (required === 0) {
    return long ? null : <Nothing label={t(`${T}.documentsNone`)} />
  }
  const values = { done: String(done), required: String(required) }
  const label = t(done > 1 ? `${T}.documentsLabelOther` : `${T}.documentsLabelOne`, values)
  return (
    <span title={label} className={cn('tabular block truncate text-xs', hasMissingDocuments(row) ? 'text-foreground' : 'text-muted-foreground', className)}>
      <span aria-hidden>{t(long ? `${T}.documentsCount` : `${T}.documentsShort`, values)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

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
      <div role="cell" className={cn(CELL, DOCUMENTS_COLUMN)}>
        <Skeleton className="h-3 w-10" />
      </div>
      <div role="cell" className={cn(CELL, WATCH_COLUMN)}>
        <Skeleton className="h-3 w-24 max-w-full" />
      </div>
    </div>
  )
}
