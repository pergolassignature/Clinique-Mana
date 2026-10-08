import { hasUnsavedChanges } from './unsaved-changes-registry'

/**
 * A deploy while the app is open. Chunk names are hashed and each deploy serves only its own
 * /assets, so a tab opened before the deploy fails to load the chunks it has not loaded yet (a 404:
 * /assets is never rewritten to index.html, see vercel.json). A full reload fixes it: index.html is
 * revalidated (`no-cache`), so it names the new chunks.
 *
 * Only the error boundaries call recoverFromStaleChunk(), for a chunk a render needed. A failed
 * idle prefetch is ignored (navigation loads the page again), so there is deliberately no global
 * `vite:preloadError` reload: a prefetch failing in the background would reload in the middle of a
 * form.
 */

/**
 * What browsers and bundlers say when a chunk cannot be loaded. Also Sentry's `ignoreErrors`
 * (main.tsx): these are handled here, not bugs.
 */
export const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Loading chunk/i, // webpack-style
  /Loading CSS chunk/i, // webpack-style
  /Unable to preload CSS for/i, // Vite's preload helper: the chunk's CSS failed
  /is not a valid JavaScript MIME type/i, // something other than JS was served for a chunk
]

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'ChunkLoadError') return true
  return typeof message === 'string' && CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/** Automatic reloads allowed per window, so a deploy that is really broken cannot loop. */
const MAX_RELOADS = 3
const RELOAD_WINDOW_MS = 60_000
const RELOADS_KEY = 'mana:stale-chunk-reloads'

/** Times of this tab's recent automatic reloads (sessionStorage survives the reload). */
function recentReloads(raw: string | null, now: number): number[] {
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : []
  } catch {
    return [] // Unreadable: start over rather than block recovery for the whole session.
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((time): time is number => typeof time === 'number' && now - time >= 0 && now - time < RELOAD_WINDOW_MS)
}

/** Counts one automatic reload, or returns false when the budget is spent or cannot be tracked. */
function takeReloadAttempt(): boolean {
  const now = Date.now()
  try {
    const recent = recentReloads(window.sessionStorage.getItem(RELOADS_KEY), now)
    if (recent.length >= MAX_RELOADS) return false
    window.sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recent, now]))
    return true
  } catch {
    // Storage blocked: without a count, an automatic reload could loop. The user reloads instead.
    return false
  }
}

/**
 * Reloads the page to pick up the new deploy, and returns true; returns false, doing nothing, when
 * a form has unsaved edits (a reload would lose them), after 3 automatic reloads within 60 s, or
 * when sessionStorage is unavailable. The caller then offers a « Recharger » button.
 */
export function recoverFromStaleChunk(): boolean {
  if (hasUnsavedChanges()) return false
  if (!takeReloadAttempt()) return false
  window.location.reload()
  return true
}
