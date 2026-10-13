import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { reportsManifest } from './index'

describe('reportsManifest', () => {
  it('uses the English key, depends on Facturation and Rendez-vous, French routes', () => {
    expect(reportsManifest.key).toBe('reports')
    expect(reportsManifest.dependsOn).toEqual(['billing', 'appointments'])
    expect(t(reportsManifest.labelKey)).toBe('Rapports')
    expect(reportsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['rapports/revenus', 'reports.finance'],
      ['rapports/annulations', 'reports.view'],
    ])
  })

  it('« Revenus » under Facturation, « Annulations » under Suivi (NAV-1)', () => {
    const nav = [reportsManifest.nav ?? []].flat()
    expect(nav.map((n) => [n.path, n.group, n.permission, t(n.labelKey)])).toEqual([
      ['/rapports/revenus', 'billing', 'reports.finance', 'Revenus'],
      ['/rapports/annulations', 'followUp', 'reports.view', 'Annulations'],
    ])
  })

  it('the admin both; the adjointe the revenue only; the conseillère and the professional none (RP-1)', () => {
    const has = (role: keyof typeof ROLE_PERMISSIONS, key: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(key)
    expect(has('admin', 'reports.view') && has('admin', 'reports.finance')).toBe(true)
    expect([has('admin_assistant', 'reports.finance'), has('admin_assistant', 'reports.view')]).toEqual([true, false])
    expect(has('counselor', 'reports.view') || has('provider', 'reports.finance')).toBe(false)
  })
})
