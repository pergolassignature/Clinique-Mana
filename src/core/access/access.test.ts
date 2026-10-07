import { describe, expect, it } from 'vitest'
import { can, parseAccess, type Access } from './access'

const base = {
  user_id: '44444444-4444-4444-4444-444444444444',
  org_id: '00000000-0000-0000-0000-000000000001',
  org_name: 'Clinique MANA',
  org_timezone: 'America/Toronto',
  display_name: 'Adjointe',
  email: 'adjointe@mana.test',
  status: 'active',
  role: 'admin_assistant',
  permissions: ['settings.view', 'professionals.view'],
  modules: ['core', 'professionals'],
}

describe('parseAccess', () => {
  it('reports a missing profile', () => {
    expect(parseAccess(null)).toEqual({ problem: 'profile_not_found' })
  })

  it('reports a disabled profile', () => {
    expect(parseAccess({ ...base, status: 'disabled' })).toEqual({ problem: 'profile_disabled' })
  })

  it('reports a profile without role', () => {
    expect(parseAccess({ ...base, role: null })).toEqual({ problem: 'no_role' })
  })

  it('returns access for an active profile with a role', () => {
    const result = parseAccess(base)
    expect('access' in result && result.access.role).toBe('admin_assistant')
  })

  it('accepts a custom role and keeps the enabled modules', () => {
    const result = parseAccess({ ...base, role: 'reception' })
    expect('access' in result && result.access.role).toBe('reception')
    expect('access' in result && result.access.modules).toEqual(['core', 'professionals'])
  })

  it('throws on an unexpected payload', () => {
    expect(() => parseAccess({ hello: 'world' })).toThrow()
  })

  it('throws when modules are missing', () => {
    expect(() => parseAccess({ ...base, modules: undefined })).toThrow()
  })
})

describe('can', () => {
  const access = base as Access

  it('is true for a held permission', () => {
    expect(can(access, 'settings.view')).toBe(true)
  })

  it('is false for a missing permission', () => {
    expect(can(access, 'settings.manage')).toBe(false)
  })

  it('is false without access', () => {
    expect(can(null, 'settings.view')).toBe(false)
  })
})
