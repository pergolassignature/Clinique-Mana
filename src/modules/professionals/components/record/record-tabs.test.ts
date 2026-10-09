import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { ROLE_PERMISSIONS, type FixtureRole } from '@/test/role-fixtures'
import { professionalKeys, professionalsSettingsKeys } from '../../hooks/keys'
import { RECORD_TABS } from '../../lib/constants'
import { RECORD_TAB_DEFS, visibleRecordTabs } from './record-tabs'

const tabsOf = (permissions: readonly string[]) => visibleRecordTabs((p) => permissions.includes(p)).map((d) => d.tab)

describe('visibleRecordTabs', () => {
  it.each<[FixtureRole, string[]]>([
    ['admin', ['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'remuneration', 'historique']],
    ['admin_assistant', ['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'historique']],
    ['counselor', ['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'historique']],
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

  it('prefetches « Rémunération et fiscalité » by permission, never a reveal', async () => {
    const prefetched = async (permissions: string[]) => {
      const queryClient = new QueryClient()
      const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined)
      const def = RECORD_TAB_DEFS.find((d) => d.tab === 'remuneration')
      await def?.prefetch?.(queryClient, 'p1', (p) => permissions.includes(p))
      return prefetch.mock.calls.map(([options]) => options.queryKey)
    }
    expect(await prefetched(['professionals.compensation', 'professionals.private'])).toEqual([
      professionalKeys.compensation('p1'),
      professionalKeys.private('p1'),
      professionalsSettingsKeys.settings(),
    ])
    expect(await prefetched(['professionals.compensation'])).toEqual([professionalKeys.compensation('p1')])
    expect(await prefetched(['professionals.private'])).toEqual([professionalKeys.private('p1'), professionalsSettingsKeys.settings()])
  })

  it('prefetches only Historique’s first page and its emails, whatever the permissions (P4-193, 4b.3)', async () => {
    const queryClient = new QueryClient()
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined)
    const infinite = vi.spyOn(queryClient, 'prefetchInfiniteQuery').mockResolvedValue(undefined)
    const def = RECORD_TAB_DEFS.find((d) => d.tab === 'historique')
    await def?.prefetch?.(queryClient, 'p1', () => true)
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toEqual([professionalKeys.emails('p1')])
    expect(infinite).toHaveBeenCalledOnce()
  })

  it('prefetches the contract and image-consent cards (Task 4d.3, P4-485), the file’s submissions (Task 4b.5) and documents (Task 4c.3) with « Documents »', async () => {
    const queryClient = new QueryClient()
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined)
    const def = RECORD_TAB_DEFS.find((d) => d.tab === 'documents')
    await def?.prefetch?.(queryClient, 'p1', () => true)
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toEqual([professionalKeys.submissions('p1'), professionalKeys.documents('p1'), professionalKeys.contract('p1'), professionalKeys.imageConsent('p1')])
  })
})
