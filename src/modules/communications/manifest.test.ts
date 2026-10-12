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

  it('loads its audit labels in their own chunk', async () => {
    const labels = await communicationsManifest.audit!()
    expect(Array.isArray(labels.tables)).toBe(true)
  })
})
