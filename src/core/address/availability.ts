import { FunctionCallError } from '@/core/supabase/functions'

/**
 * When the address suggestions are unavailable, every address field of the tab works as a plain
 * input, quietly (P4-221): no toast, no error under the field, no request per keystroke. One pause
 * for the whole tab (module state), so a missing key costs one call, not one per field or letter.
 *
 * - not configured (no Google key, Google refusing it, the limiter down), no session, no access:
 *   10 minutes;
 * - too many requests: the `Retry-After` the function sent (1 minute when absent);
 * - a refused request (`invalid_request`: that text, not the service) or an unknown place
 *   (`not_found`): no pause;
 * - anything else (network, Google slow or failing, an unexpected answer): 1 minute.
 * After the pause, the next typed letters try again.
 */

const LONG_PAUSE_MS = 10 * 60_000
const SHORT_PAUSE_MS = 60_000
const LONG_CODES = new Set(['not_configured', 'unauthenticated', 'forbidden', 'module_disabled', 'auth_unavailable', 'server_misconfigured'])

let pausedUntil = 0

/** How long to pause after `error`, in milliseconds (0: do not pause, e.g. an unknown place id). */
export function pauseFor(error: unknown): number {
  if (!(error instanceof FunctionCallError)) return SHORT_PAUSE_MS
  if (error.code === 'not_found' || error.code === 'invalid_request') return 0
  if (LONG_CODES.has(error.code)) return LONG_PAUSE_MS
  if (error.code === 'rate_limited') return (error.retryAfter ?? 60) * 1000
  return SHORT_PAUSE_MS
}

/** Records a failure; later searches wait out the pause. */
export function pauseSuggestions(error: unknown, now = Date.now()): void {
  const ms = pauseFor(error)
  if (ms > 0) pausedUntil = Math.max(pausedUntil, now + ms)
}

/** True while suggestions are paused. */
export function suggestionsPaused(now = Date.now()): boolean {
  return now < pausedUntil
}

/** Tests only: suggestions available again. */
export function resetSuggestionsPause(): void {
  pausedUntil = 0
}
