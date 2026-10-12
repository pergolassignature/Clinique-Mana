import { describe, expect, it } from 'vitest'
import { communicationsManifest } from './index'

describe('communicationsManifest', () => {
  it('uses the English module key and depends on core only', () => {
    expect(communicationsManifest.key).toBe('communications')
    expect(communicationsManifest.labelKey).toBe('modules.communications.name')
    expect(communicationsManifest.dependsOn).toEqual([])
  })

  it('has route paths relative to the app root and code-splits every page', () => {
    for (const route of communicationsManifest.routes) expect(route.path.startsWith('/')).toBe(false)
    for (const page of [...communicationsManifest.routes, ...communicationsManifest.settingsSections].map((x) => x.component)) {
      expect(typeof page.preload).toBe('function')
    }
  })

  it('« Textos » (batch SM): the page and its settings section, with the SMS permissions', () => {
    const nav = [communicationsManifest.nav].flat()
    expect(nav).toContainEqual(expect.objectContaining({ path: '/textos', permission: 'communications.sms' }))
    expect(communicationsManifest.routes).toContainEqual(expect.objectContaining({ path: 'textos', permission: 'communications.sms' }))
    expect(communicationsManifest.settingsSections).toContainEqual(
      expect.objectContaining({ id: 'sms', path: 'textos', permission: 'communications.sms_manage', editPermission: 'communications.sms_manage' }),
    )
  })

  it('loads its audit labels in their own chunk', async () => {
    const labels = await communicationsManifest.audit!()
    expect(labels.tables).toContain('sms_consents')
  })
})
