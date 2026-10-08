import { describe, expect, it } from 'vitest'
import { isBaseRoleKey, roleLabel } from './roles'

describe('roleLabel', () => {
  it('returns the French label of a known role', () => {
    expect(roleLabel('admin')).toBe('Administrateur')
    expect(roleLabel('counselor')).toBe('Conseillère')
    expect(roleLabel('admin_assistant')).toBe('Adjointe administrative')
    expect(roleLabel('provider')).toBe('Professionnel')
  })

  it('prefers the i18n label over the database name for a known role', () => {
    expect(roleLabel('counselor', 'Autre nom')).toBe('Conseillère')
  })

  it('falls back to the database name for a custom role', () => {
    expect(roleLabel('bookkeeper', 'Comptable')).toBe('Comptable')
  })

  it('falls back to the key when there is no database name', () => {
    expect(roleLabel('bookkeeper')).toBe('bookkeeper')
    expect(roleLabel('bookkeeper', null)).toBe('bookkeeper')
  })
})

describe('isBaseRoleKey', () => {
  it('is true for the four base roles only', () => {
    expect(['admin', 'counselor', 'admin_assistant', 'provider'].every(isBaseRoleKey)).toBe(true)
    expect(isBaseRoleKey('custom_0a1b2c3d')).toBe(false)
    expect(isBaseRoleKey('toString')).toBe(false)
  })
})
