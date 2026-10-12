import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { coreSettingsSections } from '@/core/settings/sections'
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

  it('has section ids and paths unique against the core sections', () => {
    const ids = [...coreSettingsSections, ...servicesManifest.settingsSections].map((s) => s.id)
    const paths = [...coreSettingsSections, ...servicesManifest.settingsSections].map((s) => s.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
