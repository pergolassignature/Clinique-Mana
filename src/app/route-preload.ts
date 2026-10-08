import { matchPath } from 'react-router-dom'
import { safeRedirect } from '@/core/auth/redirect'
import { settingsSectionPath } from '@/core/settings/paths'
import { coreSettingsSections } from '@/core/settings/sections'
import { ALL_MODULES } from './modules'

// Case-insensitive, like React Router's matching (and SettingsLayout's).
const isUnder = (pathname: string, path: string) => {
  const location = pathname.toLowerCase()
  const target = path.toLowerCase()
  return location === target || location.startsWith(`${target}/`)
}

/** The page a signed-in user is about to see: the login page's `?redirect=` target, else the URL. */
function destination(location: Pick<Location, 'pathname' | 'search' | 'origin'>): string {
  if (location.pathname.toLowerCase() !== '/connexion') return location.pathname
  const target = safeRedirect(new URLSearchParams(location.search).get('redirect'))
  return new URL(target, location.origin).pathname
}

/**
 * Starts loading the code of the page at the current URL (a settings section or a module route),
 * so a reload or deep link fetches that chunk in parallel with get_my_access instead of after it.
 * Code only: nothing renders before RequireAuth has the verified access (#11), and the route's
 * own guard still decides what shows. Permissions are not checked here; chunks are static code,
 * the same for every user, with no data in them.
 */
export function preloadRouteCode(location: Pick<Location, 'pathname' | 'search' | 'origin'> = window.location): void {
  const pathname = destination(location)
  const sections = [...coreSettingsSections, ...ALL_MODULES.flatMap((m) => m.settingsSections)]
  const page =
    sections.find((s) => isUnder(pathname, settingsSectionPath(s)))?.component ??
    ALL_MODULES.flatMap((m) => m.routes).find((r) => matchPath(`/${r.path}`, pathname))?.component
  void page?.preload?.().catch(() => {
    // Ignored: rendering the page loads it again and reports a real failure.
  })
}
