import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { clientsManifest } from './index'

describe('clientsManifest', () => {
  it('uses the English module key, depends on professionals; French routes, code-split pages', () => {
    expect(clientsManifest.key).toBe('clients')
    expect(t(clientsManifest.labelKey)).toBe('Clients')
    expect(clientsManifest.dependsOn).toEqual(['professionals'])
    expect(clientsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['clients', 'clients.view'],
      ['clients/:id/:onglet?', 'clients.view'],
      ['mes-clients', 'clients.self'],
    ])
    for (const route of clientsManifest.routes) expect(typeof route.component.preload).toBe('function')
    expect(clientsManifest.settingsSections).toEqual([])
  })

  it('« Clients » for the staff, « Mes clients » for an account linked to a professional file', () => {
    const [staff, mine] = [clientsManifest.nav ?? []].flat()
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
