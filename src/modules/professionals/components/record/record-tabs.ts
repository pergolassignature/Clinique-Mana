import type { ComponentType } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { lazyPage, type Preloadable } from '@/shared/lib/lazy-page'
import { prefetchProfessionalHistory } from '../../hooks/use-professional-record'
import type { RecordTab } from '../../lib/constants'
import { OverviewTab } from './tabs/OverviewTab'

type Can = (permission: string) => boolean

export interface RecordTabDef {
  tab: RecordTab
  /** A prop-less panel (it reads `useRecordData`). Code-split tabs can be preloaded (tab hover or focus). */
  panel: ComponentType & Partial<Preloadable>
  /** Beyond `professionals.view`, which the route already requires. */
  visible: (can: Can) => boolean
  /**
   * Starts loading the tab's own data with its chunk (tab hover or focus), for a tab that fetches
   * more than the record; `can` keeps it to what this user may read. A failed query is not thrown
   * (`prefetchQuery`), but loading the hooks' chunk can reject: the caller ignores it (opening the
   * tab loads and reports again).
   */
  prefetch?: (queryClient: QueryClient, id: string, can: Can) => Promise<void>
}

const always = () => true

// The compensation hooks are imported on demand: they ship in the tabs' chunks, not the page's.
const compensationHooks = () => import('../../hooks/use-compensation')

/**
 * « Rémunération et fiscalité »: the terms (`professionals.compensation`), the masks and the SIN
 * setting (`professionals.private`), each only for whoever may read it. Never a reveal. Rejects
 * only when a hooks chunk does not load.
 */
async function prefetchCompensationTab(queryClient: QueryClient, id: string, can: Can): Promise<void> {
  const [compensation, privateData, settings] = await Promise.all([
    compensationHooks(),
    import('../../hooks/use-private'),
    import('../../hooks/use-professionals-settings'),
  ])
  await Promise.all([
    can('professionals.compensation') && compensation.prefetchProfessionalCompensation(queryClient, id),
    can('professionals.private') && privateData.prefetchProfessionalPrivate(queryClient, id),
    can('professionals.private') && settings.prefetchProfessionalsSettings(queryClient),
  ])
}

/** Historique: its first page (its compensation rows need no other list, P4-193). */
async function prefetchHistoryTab(queryClient: QueryClient, id: string): Promise<void> {
  await prefetchProfessionalHistory(queryClient, id)
}

/**
 * The record's tabs, in P4-13's order. Aperçu, the landing tab of nearly every visit, ships in the
 * page's chunk (P4-72): a separate chunk would always load after the page's, one more round trip.
 * « Documents » arrives with 4c.
 */
export const RECORD_TAB_DEFS: readonly RecordTabDef[] = [
  { tab: 'apercu', panel: OverviewTab, visible: always },
  { tab: 'jumelage', panel: lazyPage(() => import('./tabs/MatchingTab'), 'MatchingTab'), visible: always },
  { tab: 'profil-public', panel: lazyPage(() => import('./tabs/PublicProfileTab'), 'PublicProfileTab'), visible: always },
  { tab: 'identite', panel: lazyPage(() => import('./tabs/IdentityTab'), 'IdentityTab'), visible: always },
  {
    tab: 'remuneration',
    panel: lazyPage(() => import('./tabs/CompensationTab'), 'CompensationTab'),
    visible: (can) => can('professionals.compensation') || can('professionals.private'),
    prefetch: prefetchCompensationTab,
  },
  { tab: 'historique', panel: lazyPage(() => import('./tabs/HistoryTab'), 'HistoryTab'), visible: always, prefetch: prefetchHistoryTab },
]

/** The tabs this user sees; a hidden tab is neither rendered nor reachable by its URL. */
export function visibleRecordTabs(can: Can): RecordTabDef[] {
  return RECORD_TAB_DEFS.filter((def) => def.visible(can))
}
