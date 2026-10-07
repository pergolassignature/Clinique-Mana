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

  it('resolves a diamond (d needs b and c, both need a)', () => {
    const diamond = [manifest('d', ['b', 'c']), manifest('b', ['a']), manifest('c', ['a']), manifest('a')]
    expect(keys(resolveEnabledModules(diamond, new Set(['a', 'b', 'c', 'd'])))).toEqual(['d', 'b', 'c', 'a'])
    expect(keys(resolveEnabledModules(diamond, new Set(['b', 'c', 'd'])))).toEqual([])
    expect(keys(resolveEnabledModules(diamond, new Set(['a', 'b', 'd'])))).toEqual(['b', 'a'])
  })

  it('drops a module that depends on a cycle member', () => {
    const withZ = [...all, manifest('z', ['x'])]
    expect(keys(resolveEnabledModules(withZ, new Set(['x', 'y', 'z'])))).toEqual([])
    // Same answer whichever node the walk starts from.
    expect(keys(resolveEnabledModules([manifest('z', ['x']), ...all], new Set(['x', 'y', 'z', 'a'])))).toEqual(['a'])
  })

  it('preserves manifest order, not dependency order', () => {
    const reversed = [manifest('c', ['b']), manifest('b', ['a']), manifest('a')]
    expect(keys(resolveEnabledModules(reversed, new Set(['a', 'b', 'c'])))).toEqual(['c', 'b', 'a'])
  })

  it('ignores enabled keys that have no manifest', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a', 'ghost'])))).toEqual(['a'])
  })
})
