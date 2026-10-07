import { describe, expect, it } from 'vitest'
import { SETTINGS_BASE_PATH, settingsSectionPath } from './paths'

describe('settingsSectionPath', () => {
  it('puts the section under /parametres, by its French path (decision #24)', () => {
    expect(SETTINGS_BASE_PATH).toBe('/parametres')
    expect(settingsSectionPath({ path: 'identite' })).toBe('/parametres/identite')
  })

  it('honours another mount point', () => {
    expect(settingsSectionPath({ path: 'identite' }, '/admin/reglages')).toBe('/admin/reglages/identite')
  })
})
