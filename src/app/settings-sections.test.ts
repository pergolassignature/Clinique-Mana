import { describe, expect, it } from 'vitest'
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
})
