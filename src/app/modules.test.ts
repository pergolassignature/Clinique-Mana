import { describe, expect, it } from 'vitest'
import { coreSettingsSections } from '@/core/settings/sections'
import { ALL_MODULES } from './modules'

describe('ALL_MODULES', () => {
  it('registers the Professionals module', () => {
    expect(ALL_MODULES.map((m) => m.key)).toContain('professionals')
  })

  it('has unique module keys', () => {
    const keys = ALL_MODULES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has settings section ids unique across core and all modules', () => {
    const ids = [...coreSettingsSections, ...ALL_MODULES.flatMap((m) => m.settingsSections)].map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses relative route paths and absolute nav paths', () => {
    for (const m of ALL_MODULES) {
      for (const r of m.routes) expect(r.path).not.toMatch(/^\//)
      if (m.nav) expect(m.nav.path).toMatch(/^\//)
    }
  })

  it('only depends on registered modules', () => {
    const keys = new Set(ALL_MODULES.map((m) => m.key))
    for (const m of ALL_MODULES) for (const dep of m.dependsOn) expect(keys).toContain(dep)
  })
})
