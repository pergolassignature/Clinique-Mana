import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { clientsManifest, consentPublicPage } from './index'

describe('clientsManifest', () => {
  it('uses the English module key, depends on professionals; French routes, code-split pages', () => {
    expect(clientsManifest.key).toBe('clients')
    expect(t(clientsManifest.labelKey)).toBe('Clients')
    expect(clientsManifest.dependsOn).toEqual(['professionals'])
    expect(clientsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['clients', 'clients.view'],
      ['clients/consentements', 'clients.view'],
      ['clients/payeurs-a-completer', 'clients.view'],
      ['clients/:id/:onglet?', 'clients.view'],
      ['mes-clients', 'clients.self'],
    ])
    for (const route of clientsManifest.routes) expect(typeof route.component.preload).toBe('function')
  })

  it('« Consentements à obtenir » and Paramètres → Consentements (C5a): French paths, seen with clients.view, changed with clients.manage', () => {
    expect([clientsManifest.nav ?? []].flat()).toContainEqual(
      expect.objectContaining({ path: '/clients/consentements', permission: 'clients.view', labelKey: 'modules.clients.consents.nav' }),
    )
    expect(t('modules.clients.consents.nav')).toBe('Consentements')
    expect(clientsManifest.settingsSections.map((s) => [s.id, s.path, s.permission, s.editPermission, s.group])).toEqual([
      ['consents', 'consentements', 'clients.view', 'clients.manage', 'modules'],
    ])
  })

  it('⌘K: the files for the staff (clients.view), loaded on demand', async () => {
    expect(clientsManifest.search?.map((s) => [s.id, s.permission, s.minChars])).toEqual([['clients', 'clients.view', 2]])
    expect(typeof (await clientsManifest.search?.[0]?.load())).toBe('function')
  })

  it('exports the public consent page as a lazy page (nothing of it loads with the manifest)', () => {
    expect(typeof consentPublicPage.preload).toBe('function')
  })

  it('« Clients » for the staff, « Mes clients » for an account linked to a professional file', () => {
    const [staff, , mine] = [clientsManifest.nav ?? []].flat()
    expect(staff).toMatchObject({ path: '/clients', permission: 'clients.view' })
    expect(mine).toMatchObject({ path: '/mes-clients', permission: 'clients.self' })
    expect(mine?.shownWhen?.({ has_professional_file: false } as never)).toBe(false)
    expect(mine?.shownWhen?.({ has_professional_file: true } as never)).toBe(true)
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
