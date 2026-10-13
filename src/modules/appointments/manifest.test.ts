import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { appointmentsManifest } from './index'

describe('appointmentsManifest', () => {
  it('uses the English module key, depends on clients, services and professionals; « Agenda » for the staff (R2), « Mon agenda » (R5), a client’s visits', () => {
    expect(appointmentsManifest.key).toBe('appointments')
    expect(t(appointmentsManifest.labelKey)).toBe('Rendez-vous')
    expect(appointmentsManifest.dependsOn).toEqual(['clients', 'services', 'professionals'])
    expect(appointmentsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['agenda', 'appointments.view'],
      ['mon-agenda', 'appointments.self'],
    ])
    expect([appointmentsManifest.nav ?? []].flat()).toEqual([
      expect.objectContaining({ path: '/agenda', permission: 'appointments.view' }),
      expect.objectContaining({ path: '/mon-agenda', permission: 'appointments.self' }),
    ])
    expect(appointmentsManifest.slots?.['client.visits']?.map((p) => p.permissions)).toEqual([['appointments.view', 'appointments.self']])
    expect(t('modules.appointments.agenda.title')).toBe('Agenda')
  })

  it('names its tables for the Journal d’audit', async () => {
    const labels = await appointmentsManifest.audit?.()
    expect(labels?.tables).toContain('appointments')
    expect(labels?.tableLabel('appointments')).toBe('Rendez-vous')
  })
})
