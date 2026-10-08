import { describe, expect, it } from 'vitest'
import { isUnder, SETTINGS_BASE_PATH, settingsSectionPath } from './paths'

describe('settingsSectionPath', () => {
  it('puts the section under /parametres, by its French path (decision #24)', () => {
    expect(SETTINGS_BASE_PATH).toBe('/parametres')
    expect(settingsSectionPath({ path: 'identite' })).toBe('/parametres/identite')
  })

  it('honours another mount point', () => {
    expect(settingsSectionPath({ path: 'identite' }, '/admin/reglages')).toBe('/admin/reglages/identite')
  })
})

describe('isUnder', () => {
  it('matches the path itself and what is below it, case-insensitively', () => {
    expect(isUnder('/parametres/identite', '/parametres/identite')).toBe(true)
    expect(isUnder('/parametres/identite/x', '/parametres/identite')).toBe(true)
    expect(isUnder('/Parametres/Identite', '/parametres/identite')).toBe(true)
  })

  it('does not match a sibling that only shares a prefix', () => {
    expect(isUnder('/parametres/identite-bis', '/parametres/identite')).toBe(false)
    expect(isUnder('/parametres', '/parametres/identite')).toBe(false)
  })
})
