import { describe, expect, it } from 'vitest'
import type { ModuleManifest } from './types'
import { resolveEnabledModules } from './resolve'

const manifest = (key: string, dependsOn: string[] = []): ModuleManifest => ({
  key, dependsOn, labelKey: 'app.name', routes: [], settingsSections: [],
})

const keys = (modules: ModuleManifest[]) => modules.map((m) => m.key)

describe('resolveEnabledModules', () => {
  const all = [manifest('a'), manifest('b', ['a']), manifest('c', ['b']), manifest('x', ['y']), manifest('y', ['x'])]

  it('keeps enabled modules without dependencies', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a'])))).toEqual(['a'])
  })

  it('drops disabled modules', () => {
    expect(keys(resolveEnabledModules(all, new Set()))).toEqual([])
  })

  it('drops a module whose dependency is disabled', () => {
    expect(keys(resolveEnabledModules(all, new Set(['b'])))).toEqual([])
  })

  it('resolves transitive dependencies', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a', 'b', 'c'])))).toEqual(['a', 'b', 'c'])
    expect(keys(resolveEnabledModules(all, new Set(['a', 'c'])))).toEqual(['a'])
  })

  it('drops dependency cycles', () => {
    expect(keys(resolveEnabledModules(all, new Set(['x', 'y'])))).toEqual([])
  })

  it('ignores enabled keys that have no manifest', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a', 'ghost'])))).toEqual(['a'])
  })
})
