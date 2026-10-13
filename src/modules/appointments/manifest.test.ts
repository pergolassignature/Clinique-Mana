import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { appointmentsManifest } from './index'

describe('appointmentsManifest', () => {
  it('uses the English module key, depends on clients, services and professionals', () => {
    expect(appointmentsManifest.key).toBe('appointments')
    expect(t(appointmentsManifest.labelKey)).toBe('Rendez-vous')
    expect(appointmentsManifest.dependsOn).toEqual(['clients', 'services', 'professionals'])
  })

  it('RZ: « Vidéoconférence » for the professional (also Zoom\'s return path) and in Paramètres for the staff', () => {
    expect(appointmentsManifest.routes.map((r) => [r.path, r.permission])).toContainEqual(['mon-agenda/videoconference', 'appointments.self'])
    const section = appointmentsManifest.settingsSections.find((s) => s.id === 'video')
    expect(section).toMatchObject({ path: 'videoconference', permission: 'appointments.view', editPermission: 'appointments.manage', group: 'modules' })
    expect(t(section!.labelKey)).toBe('Vidéoconférence')
  })

  it('names its tables for the Journal d’audit', async () => {
    const labels = await appointmentsManifest.audit?.()
    expect(labels?.tables).toContain('appointments')
    expect(labels?.tableLabel('appointments')).toBe('Rendez-vous')
  })
})
