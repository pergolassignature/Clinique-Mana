import { afterEach, describe, expect, it, vi } from 'vitest'
import { coreSettingsSections } from '@/core/settings/sections'
import { ALL_MODULES } from './modules'
import { AUTH_STORAGE_KEY } from '@/core/supabase/client'
import { hasStoredSession, preloadRouteCode, routePage } from './route-preload'

const at = (pathname: string, search = '') => ({ pathname, search, origin: window.location.origin })

const spyPreloads = () => {
  const pages = [...coreSettingsSections.map((s) => s.component), ...ALL_MODULES.flatMap((m) => m.routes.map((r) => r.component))]
  return pages.map((page) => vi.spyOn(page as { preload: () => Promise<void> }, 'preload').mockResolvedValue(undefined))
}

const sectionPreload = (id: string) => {
  const section = coreSettingsSections.find((s) => s.id === id)
  if (!section) throw new Error(id)
  return (section.component as { preload: () => Promise<void> }).preload
}

afterEach(() => vi.restoreAllMocks())

describe('preloadRouteCode', () => {
  it('starts loading the settings section at the URL, case-insensitively', () => {
    const spies = spyPreloads()
    preloadRouteCode(at('/parametres/Identite'))
    expect(sectionPreload('identity')).toHaveBeenCalledTimes(1)
    expect(spies.filter((s) => s.mock.calls.length > 0)).toHaveLength(1)
  })

  it('starts loading a module page at its route', () => {
    spyPreloads()
    const route = ALL_MODULES.flatMap((m) => m.routes).find((r) => r.path === 'professionnels')
    preloadRouteCode(at('/professionnels'))
    expect((route?.component as { preload: () => Promise<void> }).preload).toHaveBeenCalledTimes(1)
  })

  it("uses the login page's redirect target", () => {
    spyPreloads()
    preloadRouteCode(at('/connexion', `?redirect=${encodeURIComponent('/parametres/fiscalite?x=1')}`))
    expect(sectionPreload('tax')).toHaveBeenCalledTimes(1)
  })

  it('loads nothing for a page outside the registry, or an unsafe redirect', () => {
    const spies = spyPreloads()
    preloadRouteCode(at('/accueil'))
    preloadRouteCode(at('/parametres'))
    preloadRouteCode(at('/connexion', '?redirect=//evil.example/parametres/identite'))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('names the page at the URL', () => {
    expect(routePage(at('/parametres/journal'))).toBe(coreSettingsSections.find((s) => s.id === 'audit')?.component)
    expect(routePage(at('/accueil'))).toBeUndefined()
  })

  it('swallows a failed preload (rendering retries it)', async () => {
    spyPreloads()
    vi.mocked(sectionPreload('identity')).mockRejectedValue(new Error('offline'))
    expect(() => preloadRouteCode(at('/parametres/identite'))).not.toThrow()
    await Promise.resolve()
  })
})

describe('hasStoredSession', () => {
  afterEach(() => window.localStorage.removeItem(AUTH_STORAGE_KEY))

  it("reflects auth-js's stored session key", () => {
    expect(hasStoredSession()).toBe(false)
    window.localStorage.setItem(AUTH_STORAGE_KEY, '{}')
    expect(hasStoredSession()).toBe(true)
  })

  it('is false when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(hasStoredSession()).toBe(false)
  })
})
