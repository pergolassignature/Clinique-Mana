import { createElement, Suspense, useCallback, useRef, type CSSProperties, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { recordPath, type RecordTab } from '../../lib/constants'
import { RAIL_QUERY, STICKY_QUERY, useCompactOnScroll, useFitsInWindow, useMediaQuery, useStickyHeight } from './record-layout'
import { RecordRail } from './RecordRail'
import { preloadRecordTab, type RecordTabDef } from './record-tabs'

const T = 'modules.professionals.record.tabs'

interface RecordTabsProps {
  id: string
  current: RecordTabDef
  tabs: readonly RecordTabDef[]
  /** The record's header band (`RecordHeader`), compact once the page has scrolled. */
  header: (compact: boolean) => ReactNode
}

/**
 * The record's layout (audit 2026-10-09 §2.7) and its tabs. The header and the tab strip stick
 * under the top bar from `md` (the header drops its meta line once the page scrolls); then the open
 * tab beside the summary rail (`RecordRail`, 320 px, sticky when it fits in the window) from `xl`, the rail as three tiles
 * above the tab from `md`, and on a phone the rail under Aperçu only. The rail sits where it is
 * drawn in the DOM too, so Tab follows the eye.
 *
 * The tabs are page-level views, so real Radix tabs (decision #35: one tab stop, the arrow keys
 * switch), and the URL's last segment (`/professionnels/:id/<onglet>`), so alerts and links can
 * open a tab. A switch replaces the history entry (P4-70) and asks first while a card of the open
 * tab is dirty (`useGuardedTabs`). Hovering or focusing a tab starts loading its chunk, and its
 * data for a tab that fetches its own (Historique). Only the open panel is mounted; a crash in it
 * stays inside it.
 */
export function RecordTabs({ id, current, tabs, header }: RecordTabsProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAccess()
  const isTab = useCallback((value: string): value is RecordTab => tabs.some((def) => def.tab === value), [tabs])
  const { onValueChange, triggerProps } = useGuardedTabs(current.tab, isTab, (tab) => navigate(recordPath(id, tab), { replace: true }))
  const sticky = useMediaQuery(STICKY_QUERY)
  const wide = useMediaQuery(RAIL_QUERY)
  const compact = useCompactOnScroll(sticky)
  const head = useRef<HTMLDivElement>(null)
  const headHeight = useStickyHeight(head, sticky)
  const rail = useRef<HTMLDivElement>(null)
  // The top bar (48), the header, the gap above the rail (24) and room below it (24).
  const railSticks = useFitsInWindow(rail, 48 + headHeight + 48, wide)

  const panel = (
    <TabsContent key={current.tab} value={current.tab} className="min-w-0">
      {/* The panel's heading, for screen-reader navigation (its cards are h3). */}
      <h2 className="sr-only">{t(`${T}.${current.tab}`)}</h2>
      <RouteBoundary scope="professionals:record" compact>
        <Suspense fallback={<Loading />}>{createElement(current.panel)}</Suspense>
      </RouteBoundary>
    </TabsContent>
  )

  return (
    <Tabs value={current.tab} onValueChange={onValueChange} style={{ '--record-head-h': `${headHeight}px` } as CSSProperties}>
      {/* From `md` it sticks under the top bar, over the page's top padding, so the page scrolls under it. */}
      <div
        ref={head}
        data-record-head
        className={cn('space-y-4 bg-background md:sticky md:top-12 md:z-20 md:-mt-6', compact ? 'md:pt-3' : 'md:pt-6')}
      >
        {header(compact)}
        <TabsList aria-label={t(`${T}.label`)}>
          {tabs.map((def) => {
            const { tab } = def
            const guard = triggerProps(tab)
            const preload = () => preloadRecordTab(def, queryClient, id, can)
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                {...guard}
                onFocus={(event) => {
                  guard.onFocus(event)
                  preload()
                }}
                onPointerEnter={preload}
              >
                <TabLabel label={t(`${T}.${tab}`)} />
              </TabsTrigger>
            )
          })}
        </TabsList>
      </div>
      {wide ? (
        <div className="mt-6 grid grid-cols-record items-start gap-6">
          {panel}
          {/* Sticky under the header when it fits in the window; otherwise it scrolls with the page, its end in reach. */}
          <div ref={rail} className={cn(railSticks && 'sticky top-[calc(var(--topbar-h)+var(--record-head-h)+1.5rem)]')}>
            <RecordRail tab={current.tab} layout="column" />
          </div>
        </div>
      ) : sticky ? (
        <div className="mt-5 space-y-5">
          <RecordRail tab={current.tab} layout="tiles" />
          {panel}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {panel}
          {current.tab === 'apercu' && <RecordRail tab={current.tab} layout="stack" />}
        </div>
      )}
    </Tabs>
  )
}

/**
 * A tab's label, as wide as its active (500) weight at every state, so the strip does not shift
 * when the open tab changes: a hidden bold copy shares the label's grid cell.
 */
function TabLabel({ label }: { label: string }) {
  return (
    <span className="inline-grid">
      <span className="col-start-1 row-start-1">{label}</span>
      <span aria-hidden className="invisible col-start-1 row-start-1 h-0 overflow-hidden font-medium">
        {label}
      </span>
    </span>
  )
}
