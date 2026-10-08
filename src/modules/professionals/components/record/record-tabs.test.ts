import { describe, expect, it } from 'vitest'
import { ROLE_PERMISSIONS, type FixtureRole } from '@/test/role-fixtures'
import { RECORD_TABS } from '../../lib/constants'
import { RECORD_TAB_DEFS, visibleRecordTabs } from './record-tabs'

const tabsOf = (permissions: readonly string[]) => visibleRecordTabs((p) => permissions.includes(p)).map((d) => d.tab)

describe('visibleRecordTabs', () => {
  it.each<[FixtureRole, string[]]>([
    ['admin', ['apercu', 'jumelage', 'profil-public', 'identite', 'remuneration', 'historique']],
    ['admin_assistant', ['apercu', 'jumelage', 'profil-public', 'identite', 'historique']],
    ['counselor', ['apercu', 'jumelage', 'profil-public', 'identite', 'historique']],
  ])('shows the %s their tabs', (role, tabs) => {
    expect(tabsOf(ROLE_PERMISSIONS[role])).toEqual(tabs)
  })

  it('shows « Rémunération et fiscalité » with either compensation or private data', () => {
    expect(tabsOf(['professionals.view', 'professionals.private'])).toContain('remuneration')
    expect(tabsOf(['professionals.view', 'professionals.compensation'])).toContain('remuneration')
  })

  it('keeps P4-13’s order, each tab once', () => {
    const tabs = RECORD_TAB_DEFS.map((d) => d.tab)
    expect(new Set(tabs).size).toBe(tabs.length)
    expect([...tabs].sort((a, b) => RECORD_TABS.indexOf(a) - RECORD_TABS.indexOf(b))).toEqual(tabs)
  })

  it('code-splits every tab but Aperçu', () => {
    for (const def of RECORD_TAB_DEFS) expect(typeof def.panel.preload).toBe(def.tab === 'apercu' ? 'undefined' : 'function')
  })
})
