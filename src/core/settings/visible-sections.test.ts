import { describe, expect, it } from 'vitest'
import type { SettingsSection } from '@/core/modules/types'
import { isSectionReadOnly } from './section-context'
import { canOpenSection, visibleSettingsSections } from './visible-sections'

type Item = Pick<SettingsSection, 'group' | 'permission'> & { id: string }
const item = (id: string, group: SettingsSection['group'], permission: SettingsSection['permission'] = 'settings.view'): Item => ({ id, group, permission })

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

  it('keeps a section with several permissions when the user has any of them', () => {
    const sections = [item('users', 'plateforme', ['users.view', 'roles.manage']), item('audit', 'plateforme', 'audit.view')]
    expect(visibleSettingsSections(sections, (p) => p === 'roles.manage').map((s) => s.id)).toEqual(['users'])
    expect(visibleSettingsSections(sections, (p) => p === 'users.view').map((s) => s.id)).toEqual(['users'])
    expect(visibleSettingsSections(sections, (p) => p === 'users.manage').map((s) => s.id)).toEqual([])
  })
})

describe('canOpenSection', () => {
  it('needs the one permission, or any one of several (none: never)', () => {
    const can = (p: string) => p === 'roles.manage'
    expect(canOpenSection({ permission: 'roles.manage' }, can)).toBe(true)
    expect(canOpenSection({ permission: 'users.view' }, can)).toBe(false)
    expect(canOpenSection({ permission: ['users.view', 'roles.manage'] }, can)).toBe(true)
    expect(canOpenSection({ permission: [] }, can)).toBe(false)
  })
})

describe('isSectionReadOnly', () => {
  it('is read-only only when the user holds none of its edit permissions', () => {
    const can = (p: string) => p === 'roles.manage'
    expect(isSectionReadOnly({ editPermission: 'users.manage' }, can)).toBe(true)
    expect(isSectionReadOnly({ editPermission: 'roles.manage' }, can)).toBe(false)
    expect(isSectionReadOnly({ editPermission: ['users.manage', 'roles.manage'] }, can)).toBe(false)
    expect(isSectionReadOnly({ editPermission: ['users.manage', 'settings.manage'] }, can)).toBe(true)
    expect(isSectionReadOnly({ editPermission: undefined }, can)).toBe(false)
  })
})
