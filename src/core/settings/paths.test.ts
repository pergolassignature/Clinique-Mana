import { describe, expect, it } from 'vitest'
import { SETTINGS_BASE_PATH, settingsSectionPath } from './paths'

describe('settingsSectionPath', () => {
  it('puts the section under /parametres', () => {
    expect(SETTINGS_BASE_PATH).toBe('/parametres')
    expect(settingsSectionPath({ id: 'modules' })).toBe('/parametres/modules')
  })

  it('honours another mount point', () => {
    expect(settingsSectionPath({ id: 'modules' }, '/admin/reglages')).toBe('/admin/reglages/modules')
  })
})
