import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { coreSettingsSections } from '@/core/settings/sections'
import { isSectionReadOnly } from '@/core/settings/section-context'
import { canOpenSection } from '@/core/settings/visible-sections'
import { ROLE_PERMISSIONS, type FixtureRole } from '@/test/role-fixtures'
import { servicesManifest } from './index'

describe('servicesManifest', () => {
  it('uses the English module key, depends on professionals, and has no menu entry', () => {
    expect(servicesManifest.key).toBe('services')
    expect(servicesManifest.dependsOn).toEqual(['professionals'])
    expect(servicesManifest.nav).toBeUndefined()
    expect(servicesManifest.routes).toEqual([])
    expect(t(servicesManifest.labelKey)).toBe('Services et tarifs')
  })

  it('names its audited tables for the Journal d’audit, in its own chunk', async () => {
    const labels = await servicesManifest.audit?.()
    expect(labels?.tables).toEqual(['service_families', 'services', 'service_titles', 'service_rate_variants', 'billing_policies'])
    expect(labels?.tableLabel('services')).toBe('Services')
    expect(labels?.fieldLabel('services', 'price_source')).toBe('Source du prix')
    expect(labels?.value('services', 'price_source', 'entered')).toBe('Montant saisi à la facture')
    expect(labels?.value('services', 'fixed_price_cents', 3783)).toBe('37,83 $')
    expect(labels?.value('billing_policies', 'first_fee_percent', 50)).toBe('50 %')
    expect(labels?.sourceLabel('seed:services_catalogue')).toBe('Catalogue initial')
    expect(labels?.tableLabel('professionals')).toBeUndefined()
  })

  it('shows « Services et tarifs » to the admin and the adjointe (editable), never to a counselor or a professional (S-8)', () => {
    const section = servicesManifest.settingsSections.find((s) => s.id === 'services')
    if (!section) throw new Error('no section')
    expect(section).toMatchObject({ id: 'services', path: 'services-et-tarifs', group: 'modules', editPermission: 'services.manage' })
    expect(t(section.labelKey)).toBe('Services et tarifs')
    const canFor = (role: FixtureRole) => (key: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(key)
    expect(canOpenSection(section, canFor('admin'))).toBe(true)
    expect(canOpenSection(section, canFor('admin_assistant'))).toBe(true)
    expect(isSectionReadOnly(section, canFor('admin_assistant'))).toBe(false)
    // Both hold services.view for the published reads, not the settings section.
    expect(canFor('counselor')('services.view')).toBe(true)
    expect(canOpenSection(section, canFor('counselor'))).toBe(false)
    expect(canFor('provider')('services.view')).toBe(true)
    expect(canOpenSection(section, canFor('provider'))).toBe(false)
    // A custom role seeing Paramètres without services.manage reads it only.
    const viewer = (key: string) => key === 'settings.view' || key === 'services.view'
    expect(canOpenSection(section, viewer)).toBe(true)
    expect(isSectionReadOnly(section, viewer)).toBe(true)
  })

  it('has section ids and paths unique against the core sections', () => {
    const ids = [...coreSettingsSections, ...servicesManifest.settingsSections].map((s) => s.id)
    const paths = [...coreSettingsSections, ...servicesManifest.settingsSections].map((s) => s.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
