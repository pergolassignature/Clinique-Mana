import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { demandesManifest } from './index'

describe('demandesManifest', () => {
  it('uses the English module key, depends on clients and professionals, and has no screen yet (D1)', () => {
    expect(demandesManifest.key).toBe('demandes')
    expect(t(demandesManifest.labelKey)).toBe('Demandes')
    expect(demandesManifest.dependsOn).toEqual(['clients', 'professionals'])
    expect(demandesManifest.routes).toEqual([])
    expect(demandesManifest.settingsSections).toEqual([])
  })

  it('names its audited tables, columns and codes for the Journal d’audit, in its own chunk', async () => {
    const labels = await demandesManifest.audit?.()
    expect(labels?.tables).toContain('demandes')
    expect(labels?.tableLabel('waitlist_entries')).toBe('Liste d’attente')
    expect(labels?.fieldLabel('demandes', 'state')).toBe('État')
    expect(labels?.value('demandes', 'state', 'waitlist')).toBe('Liste d’attente')
    expect(labels?.value('demandes', 'closed_reason', 'referred_out')).toBe('Orientée ailleurs')
    expect(labels?.value('waitlist_entries', 'exit_reason', 'placed')).toBe('Placée à la clinique')
    expect(labels?.tableLabel('clients')).toBeUndefined()
  })
})
