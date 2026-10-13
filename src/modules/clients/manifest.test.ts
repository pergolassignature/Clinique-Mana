import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { clientsManifest, consentPublicPage } from './index'

describe('clientsManifest', () => {
  it('uses the English module key and depends on professionals', () => {
    expect(clientsManifest.key).toBe('clients')
    expect(t(clientsManifest.labelKey)).toBe('Clients')
    expect(clientsManifest.dependsOn).toEqual(['professionals'])
  })

  it('« Consentements à obtenir » and Paramètres → Consentements (C5a): French paths, seen with clients.view, changed with clients.manage', () => {
    expect(clientsManifest.nav).toEqual([expect.objectContaining({ path: '/clients/consentements', permission: 'clients.view', labelKey: 'modules.clients.consents.nav' })])
    expect(t('modules.clients.consents.nav')).toBe('Consentements')
    expect(clientsManifest.routes.map((r) => [r.path, r.permission])).toEqual([['clients/consentements', 'clients.view']])
    expect(clientsManifest.settingsSections.map((s) => [s.id, s.path, s.permission, s.editPermission, s.group])).toEqual([
      ['consents', 'consentements', 'clients.view', 'clients.manage', 'modules'],
    ])
  })

  it('exports the public consent page as a lazy page (nothing of it loads with the manifest)', () => {
    expect(typeof consentPublicPage.preload).toBe('function')
  })

  it('names its audited tables for the Journal d’audit, in its own chunk, with personal values left to the redaction', async () => {
    const labels = await clientsManifest.audit?.()
    expect(labels?.tables).toContain('clients')
    expect(labels?.tableLabel('client_relations')).toBe('Proches des clients')
    expect(labels?.fieldLabel('client_relations', 'a_manages_appointments')).toBe('A gère les rendez-vous et formulaires de B')
    expect(labels?.value('client_relations', 'type_a_to_b', 'guardian')).toBe('Tuteur ou tutrice')
    expect(labels?.value('client_payers', 'kind', 'ivac')).toBe('IVAC')
    expect(labels?.value('client_payers', 'session_amount_cents', 9450)).toBe('94,50\u00a0$')
    expect(labels?.sourceLabel('seed:clients_reference')).toBe('Listes initiales')
    expect(labels?.tableLabel('services')).toBeUndefined()
  })
})
