import { describe, expect, it } from 'vitest'
import { roleLabel } from './roles'

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

  it('falls back to the database name for a role added later', () => {
    expect(roleLabel('bookkeeper', 'Comptable')).toBe('Comptable')
  })

  it('falls back to the key when there is no database name', () => {
    expect(roleLabel('bookkeeper')).toBe('bookkeeper')
    expect(roleLabel('bookkeeper', null)).toBe('bookkeeper')
  })
})
