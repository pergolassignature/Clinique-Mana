import type { ComponentType } from 'react'
import { lazyPage, type Preloadable } from '@/shared/lib/lazy-page'
import type { RecordTab } from '../../lib/constants'
import { OverviewTab } from './tabs/OverviewTab'

type Can = (permission: string) => boolean

export interface RecordTabDef {
  tab: RecordTab
  /** A prop-less panel (it reads `useRecordData`). Code-split tabs can be preloaded (tab hover or focus). */
  panel: ComponentType & Partial<Preloadable>
  /** Beyond `professionals.view`, which the route already requires. */
  visible: (can: Can) => boolean
}

const always = () => true
/** One lazyPage per tab, so each later task swaps its own line for its real panel. */
const inPreparation = () => lazyPage(() => import('./tabs/TabInPreparation'), 'TabInPreparation')

/**
 * The record's tabs, in P4-13's order. Aperçu, the landing tab of nearly every visit, ships in the
 * page's chunk (P4-72): a separate chunk would always load after the page's, one more round trip.
 * « Documents » arrives with 4c.
 */
export const RECORD_TAB_DEFS: readonly RecordTabDef[] = [
  { tab: 'apercu', panel: OverviewTab, visible: always },
  { tab: 'jumelage', panel: lazyPage(() => import('./tabs/MatchingTab'), 'MatchingTab'), visible: always },
  { tab: 'profil-public', panel: inPreparation(), visible: always }, // 4a.13
  { tab: 'identite', panel: inPreparation(), visible: always }, // 4a.13
  { tab: 'remuneration', panel: inPreparation(), visible: (can) => can('professionals.compensation') || can('professionals.private') }, // 4a.18
  { tab: 'historique', panel: inPreparation(), visible: always }, // 4a.15
]

/** The tabs this user sees; a hidden tab is neither rendered nor reachable by its URL. */
export function visibleRecordTabs(can: Can): RecordTabDef[] {
  return RECORD_TAB_DEFS.filter((def) => def.visible(can))
}
