import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { demandesManifest } from './index'

describe('demandesManifest', () => {
  it('uses the English module key, depends on clients and professionals; « Demandes » and its record (D2)', () => {
    expect(demandesManifest.key).toBe('demandes')
    expect(t(demandesManifest.labelKey)).toBe('Demandes')
    expect(demandesManifest.dependsOn).toEqual(['clients', 'professionals'])
    expect(demandesManifest.nav).toEqual([expect.objectContaining({ path: '/demandes', permission: 'demandes.view' })])
    expect(demandesManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['demandes', 'demandes.view'],
      ['demandes/:id/:onglet?', 'demandes.view'],
    ])
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
