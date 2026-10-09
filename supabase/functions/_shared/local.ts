/**
 * What counts as a local development address (the app's own `APP_URL`, a
 * template's URL when the app is local). One list for `isLocalAppUrl`, the
 * CORS warning (`auth.ts`) and `safeUrl` (`format.ts`). Dependency-free.
 */

/** The hostnames of a local address, as `URL.hostname` spells them. */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
])

/**
 * True when `appUrl` is a local `http` URL (`http://localhost:5173`): local
 * dev. Gates what only a dev machine may do (the console email transport,
 * the local Documenso fake, P3-34, local `http:` links in emails).
 */
export function isLocalAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl || !URL.canParse(appUrl.trim())) return false
  const url = new URL(appUrl.trim())
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}
