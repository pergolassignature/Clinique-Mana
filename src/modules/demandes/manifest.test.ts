import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { bookingCancelPublicPage, bookingPublicPage, demandesManifest, waitlistAnswerPublicPage } from './index'

describe('demandesManifest', () => {
  it('uses the English module key, depends on clients and professionals; « Demandes » and its record (D2)', () => {
    expect(demandesManifest.key).toBe('demandes')
    expect(t(demandesManifest.labelKey)).toBe('Demandes')
    expect(demandesManifest.dependsOn).toEqual(['clients', 'professionals'])
    expect([demandesManifest.nav ?? []].flat().map((n) => [n.path, n.permission, t(n.labelKey)])).toEqual([
      ['/demandes', 'demandes.view', 'Demandes'],
      ['/demandes/appels', 'demandes.view', 'Appels découverte'],
      ['/liste-attente', 'demandes.view', "Liste d'attente"],
    ])
    expect(demandesManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['demandes', 'demandes.view'],
      ['demandes/appels', 'demandes.view'],
      ['demandes/:id/:onglet?', 'demandes.view'],
      ['liste-attente', 'demandes.view'],
    ])
  })

  it('Paramètres → Appels découverte (D3c) and → Liste d’attente (D3); the public pages are lazy', () => {
    expect(demandesManifest.settingsSections.map((s) => [s.id, s.path, s.permission, s.editPermission, s.group, t(s.labelKey)])).toEqual([
      ['booking', 'appels-decouverte', 'demandes.view', 'demandes.manage', 'modules', 'Appels découverte'],
      ['waitlist', 'liste-attente', 'demandes.view', 'demandes.waitlist', 'modules', "Liste d'attente"],
    ])
    expect(typeof bookingPublicPage.preload).toBe('function')
    expect(typeof bookingCancelPublicPage.preload).toBe('function')
    expect(typeof waitlistAnswerPublicPage.preload).toBe('function')
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
