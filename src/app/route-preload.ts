import { matchPath } from 'react-router-dom'
import { safeRedirect } from '@/core/auth/redirect'
import { AUTH_STORAGE_KEY } from '@/core/supabase/client'
import { isUnder, settingsSectionPath } from '@/core/settings/paths'
import { coreSettingsSections } from '@/core/settings/sections'
import type { LazyPage } from '@/shared/lib/lazy-page'
import { ALL_MODULES } from './modules'
import { publicPageAt } from './public-pages'

/** The page a signed-in user is about to see: the login page's `?redirect=` target, else the URL. */
function destination(location: Pick<Location, 'pathname' | 'search' | 'origin'>): string {
  if (location.pathname.toLowerCase() !== '/connexion') return location.pathname
  const target = safeRedirect(new URLSearchParams(location.search).get('redirect'))
  return new URL(target, location.origin).pathname
}

type RouteLocation = Pick<Location, 'pathname' | 'search' | 'origin'>

/**
 * The registered page at the URL (a code-split public page, settings section or module route), or
 * at the login redirect target.
 */
export function routePage(location: RouteLocation = window.location): LazyPage | undefined {
  const pathname = destination(location)
  const sections = [...coreSettingsSections, ...ALL_MODULES.flatMap((m) => m.settingsSections)]
  return (
    publicPageAt(pathname) ??
    sections.find((s) => isUnder(pathname, settingsSectionPath(s)))?.component ??
    ALL_MODULES.flatMap((m) => m.routes).find((r) => matchPath(`/${r.path}`, pathname))?.component
  )
}

/**
 * Starts loading the code of the page at the current URL (a public page, a settings section or a
 * module route),
 * so a reload or deep link fetches that chunk in parallel with get_my_access instead of after it.
 * Code only: nothing renders before RequireAuth has the verified access (#11), and the route's
 * own guard still decides what shows. Permissions are not checked here; chunks are static code,
 * the same for every user, with no data in them.
 */
export function preloadRouteCode(location: RouteLocation = window.location): void {
  void routePage(location)?.preload().catch(() => {
    // Ignored: rendering the page loads it again and reports a real failure.
  })
}

/**
 * Whether auth-js has a session stored in this browser (a reload or a new tab while signed in).
 * A hint for loading code early only: it says nothing about whether the session is valid, and
 * nothing renders from it.
 */
export function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) !== null
  } catch {
    return false
  }
}
