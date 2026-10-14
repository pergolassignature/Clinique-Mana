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
      ['rapports/consentements', 'reports.view'],
      ['rapports/demandes', ['reports.demandes_indicators', 'reports.view']],
      ['rapports/ivac', 'reports.finance'],
      ['rapports/paie', 'reports.payroll'],
    ])
  })

  it('every report in the « Rapports » section, in order (NAV-2)', () => {
    const nav = [reportsManifest.nav ?? []].flat()
    expect(nav.map((n) => [n.path, n.group, n.permission, t(n.labelKey)])).toEqual([
      ['/rapports/revenus', 'reports', 'reports.finance', 'Revenus'],
      ['/rapports/paie', 'reports', 'reports.payroll', 'Paie des professionnels'],
      ['/rapports/ivac', 'reports', 'reports.finance', 'IVAC'],
      ['/rapports/annulations', 'reports', 'reports.view', 'Annulations'],
      ['/rapports/demandes', 'reports', ['reports.demandes_indicators', 'reports.view'], 'Indicateurs des demandes'],
      ['/rapports/consentements', 'reports', 'reports.view', 'Consentements des clients'],
    ])
    expect(nav.map((n) => n.order)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('« Indicateurs des demandes » only while Demandes is enabled (it reads Demandes)', () => {
    const item = [reportsManifest.nav ?? []].flat().find((n) => n.path === '/rapports/demandes')!
    expect(item.shownWhen?.({ modules: ['reports', 'demandes'] } as never)).toBe(true)
    expect(item.shownWhen?.({ modules: ['reports'] } as never)).toBe(false)
  })

  it('the admin both; the adjointe the revenue only; the conseillère and the professional none (RP-1)', () => {
    const has = (role: keyof typeof ROLE_PERMISSIONS, key: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(key)
    expect(has('admin', 'reports.view') && has('admin', 'reports.finance')).toBe(true)
    expect([has('admin_assistant', 'reports.finance'), has('admin_assistant', 'reports.view')]).toEqual([true, false])
    expect(has('counselor', 'reports.view') || has('counselor', 'reports.finance') || has('provider', 'reports.finance')).toBe(false)
    // RP-9: the payroll report is the admin's only.
    expect([has('admin', 'reports.payroll'), has('admin_assistant', 'reports.payroll')]).toEqual([true, false])
  })

  it('« Indicateurs des demandes » with its own permission (the conseillère, the adjointe) or reports.view (R-81)', () => {
    const has = (role: keyof typeof ROLE_PERMISSIONS, key: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(key)
    expect(['admin', 'admin_assistant', 'counselor', 'provider'].map((r) => has(r as keyof typeof ROLE_PERMISSIONS, 'reports.demandes_indicators'))).toEqual([
      true,
      true,
      true,
      false,
    ])
  })
})
