import { describe, expect, it } from 'vitest'
import type { SettingsSection } from '@/core/modules/types'
import { visibleSettingsSections } from './visible-sections'

type Item = Pick<SettingsSection, 'group' | 'permission'> & { id: string }
const item = (id: string, group: SettingsSection['group'], permission = 'settings.view'): Item => ({ id, group, permission })

describe('visibleSettingsSections', () => {
  it('keeps the sections the user can open', () => {
    const sections = [item('a', 'clinique'), item('b', 'clinique', 'modules.manage')]
    expect(visibleSettingsSections(sections, (p) => p === 'settings.view').map((s) => s.id)).toEqual(['a'])
  })

  it('orders them clinique, plateforme, modules, compte, keeping registration order within a group', () => {
    const sections = [item('me', 'compte'), item('mod', 'modules'), item('plat', 'plateforme'), item('c1', 'clinique'), item('c2', 'clinique')]
    expect(visibleSettingsSections(sections, () => true).map((s) => s.id)).toEqual(['c1', 'c2', 'plat', 'mod', 'me'])
  })

  it('is empty when nothing is accessible', () => {
    expect(visibleSettingsSections([item('a', 'clinique')], () => false)).toEqual([])
  })
})
