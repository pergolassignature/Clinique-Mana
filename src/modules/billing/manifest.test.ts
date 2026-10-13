import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { billingManifest } from './index'

describe('billingManifest', () => {
  it('uses the English module key and depends on clients, services, professionals and appointments', () => {
    expect(billingManifest.key).toBe('billing')
    expect(t(billingManifest.labelKey)).toBe('Facturation')
    expect(billingManifest.dependsOn).toEqual(['clients', 'services', 'professionals', 'appointments'])
  })

  it('names its tables for the Journal d’audit', async () => {
    const labels = await billingManifest.audit?.()
    expect(labels?.tables).toContain('invoices')
    expect(labels?.tableLabel('invoices')).toBe('Factures')
    expect(labels?.sourceLabel('seed:billing_reference')).toBe('Listes initiales')
  })
})
