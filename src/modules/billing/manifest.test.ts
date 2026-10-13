import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { billingManifest } from './index'

describe('billingManifest', () => {
  it('uses the English module key and depends on clients, services, professionals and appointments', () => {
    expect(billingManifest.key).toBe('billing')
    expect(t(billingManifest.labelKey)).toBe('Facturation')
    expect(billingManifest.dependsOn).toEqual(['clients', 'services', 'professionals', 'appointments'])
  })

  it('adds QuickBooks (FQ) to Paramètres, for billing.settings, and Intuit’s return route', () => {
    expect(billingManifest.settingsSections.map((s) => [s.id, s.path, s.permission])).toEqual([
      ['quickbooks', 'quickbooks', 'billing.settings'],
      ['quickbooks_customers', 'quickbooks-clients', 'billing.settings'],
    ])
    expect(billingManifest.routes.map((r) => r.path)).toEqual(['facturation/retour-quickbooks'])
  })

  it('names the QuickBooks tables and the map’s keys for the Journal d’audit', async () => {
    const labels = await billingManifest.audit?.()
    expect(labels?.tableLabel('qbo_account_map')).toBeTruthy()
    expect(labels?.value('qbo_account_map', 'map_key', 'deposit.interac')).toBeTruthy()
  })

  it('names its tables for the Journal d’audit', async () => {
    const labels = await billingManifest.audit?.()
    expect(labels?.tables).toContain('invoices')
    expect(labels?.tableLabel('invoices')).toBe('Factures')
    expect(labels?.sourceLabel('seed:billing_reference')).toBe('Listes initiales')
  })
})
