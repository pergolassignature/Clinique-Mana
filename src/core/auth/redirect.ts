const FALLBACK = '/accueil'

/**
 * Returns `target` only if it is a same-origin path; otherwise '/accueil'.
 * Prevents open redirects after login: the URL parser treats "\" as "/" and strips
 * tab/CR/LF, so those characters (and any control character) are rejected outright,
 * and the result is re-checked against the current origin.
 */
export function safeRedirect(target: string | null): string {
  if (!target || !/^\/(?![/\\])/.test(target) || /[\p{Cc}\\]/u.test(target)) return FALLBACK
  try {
    const url = new URL(target, window.location.origin)
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : FALLBACK
  } catch {
    return FALLBACK
  }
}
