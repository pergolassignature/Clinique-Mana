import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { appointmentsManifest } from './index'

describe('appointmentsManifest', () => {
  it('uses the English module key, depends on clients, services and professionals; no screen in R1', () => {
    expect(appointmentsManifest.key).toBe('appointments')
    expect(t(appointmentsManifest.labelKey)).toBe('Rendez-vous')
    expect(appointmentsManifest.dependsOn).toEqual(['clients', 'services', 'professionals'])
    expect(appointmentsManifest.routes).toEqual([])
    expect(appointmentsManifest.settingsSections).toEqual([])
  })

  it('names its tables for the Journal d’audit', async () => {
    const labels = await appointmentsManifest.audit?.()
    expect(labels?.tables).toContain('appointments')
    expect(labels?.tableLabel('appointments')).toBe('Rendez-vous')
  })
})
