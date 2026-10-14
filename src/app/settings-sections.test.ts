import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { coreSettingsSections } from '@/core/settings/sections'
import { ALL_MODULES } from './modules'

// Here rather than in core/settings: core may not import the app's module list (ESLint, design §6.2).
const allSections = [...coreSettingsSections, ...ALL_MODULES.flatMap((m) => m.settingsSections)]

describe('settings sections across core and modules', () => {
  it('have unique ids', () => {
    const ids = allSections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('have unique paths', () => {
    const paths = allSections.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('use plain lowercase URL segments as paths', () => {
    for (const s of allSections) expect(s.path).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('have paths unique with their redirects too (a former path never shadows a section)', () => {
    const paths = allSections.flatMap((s) => [s.path, ...(s.redirects ?? []).map((r) => r.path)])
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('NAV-3: every module section names its area; sections sharing an area agree on its label and order', () => {
    const areas = new Map<string, { labelKey: string; order: number }>()
    for (const s of ALL_MODULES.flatMap((m) => m.settingsSections)) {
      expect(s.group).toBe('modules')
      expect(s.area, s.id).toBeDefined()
      const known = areas.get(s.area!.key)
      if (known) expect({ labelKey: s.area!.labelKey, order: s.area!.order }, s.id).toEqual(known)
      else areas.set(s.area!.key, { labelKey: s.area!.labelKey, order: s.area!.order })
      expect(t(s.area!.labelKey)).not.toBe(s.area!.labelKey)
    }
    expect([...areas.entries()].sort((a, b) => a[1].order - b[1].order).map(([, a]) => t(a.labelKey as never))).toEqual([
      'Professionnels',
      'Services',
      'Clients et demandes',
      'Agenda',
      'Facturation',
      'Communications',
    ])
  })
})
