import { createElement, Suspense, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { recordPath, type RecordTab } from '../../lib/constants'
import type { RecordTabDef } from './record-tabs'

const T = 'modules.professionals.record.tabs'

interface RecordTabsProps {
  id: string
  current: RecordTabDef
  tabs: readonly RecordTabDef[]
}

/**
 * The record's tabs: page-level views, so real Radix tabs (decision #35: one tab stop, the arrow
 * keys switch), and the URL's last segment (`/professionnels/:id/<onglet>`), so alerts and links
 * can open a tab. A switch replaces the history entry (P4-70) and asks first while a card of the
 * open tab is dirty (`useGuardedTabs`). Hovering or focusing a tab starts loading its chunk, and
 * its data for a tab that fetches its own (Historique). Only the open panel is mounted; a crash in
 * it stays inside it.
 */
export function RecordTabs({ id, current, tabs }: RecordTabsProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isTab = useCallback((value: string): value is RecordTab => tabs.some((def) => def.tab === value), [tabs])
  const { onValueChange, triggerProps } = useGuardedTabs(current.tab, isTab, (tab) => navigate(recordPath(id, tab), { replace: true }))

  return (
    <Tabs value={current.tab} onValueChange={onValueChange}>
      <TabsList aria-label={t(`${T}.label`)}>
        {tabs.map(({ tab, panel, prefetch }) => {
          const guard = triggerProps(tab)
          const preload = () => {
            void panel.preload?.().catch(() => {
              // Opening the tab loads it again and reports a real failure.
            })
            // A prefetch never throws; fresh data is not fetched again.
            void prefetch?.(queryClient, id)
          }
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
              {t(`${T}.${tab}`)}
            </TabsTrigger>
          )
        })}
      </TabsList>
      <TabsContent key={current.tab} value={current.tab} className="mt-5">
        {/* The panel's heading, for screen-reader navigation (its cards are h3). */}
        <h2 className="sr-only">{t(`${T}.${current.tab}`)}</h2>
        <RouteBoundary scope="professionals:record" compact>
          <Suspense fallback={<Loading />}>{createElement(current.panel)}</Suspense>
        </RouteBoundary>
      </TabsContent>
    </Tabs>
  )
}
