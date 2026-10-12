/**
 * A per-isolate throttle on a repeated report (`resend-webhook`'s
 * `createReportThrottle`, shared so `sms-webhook` does not import that
 * handler): a missing org secret would otherwise be reported on every
 * delivery, since anyone can post to a webhook and the provider retries.
 */

/** One report per key per this window. */
const DEFAULT_WINDOW_MS = 60 * 60 * 1000
/** Keys remembered (per isolate); the oldest is evicted. */
const DEFAULT_MAX_KEYS = 256

/**
 * True when `key` was not reported within the window: records it now. A Map
 * keeps insertion order, and a report re-inserts its key, so the first key is
 * the one reported longest ago (evicted past `max`).
 */
export function createReportThrottle(
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX_KEYS,
): (key: string, nowMs: number) => boolean {
  const last = new Map<string, number>()
  return (key, nowMs) => {
    const at = last.get(key)
    if (at !== undefined && nowMs - at < windowMs) return false
    last.delete(key)
    last.set(key, nowMs)
    if (last.size > max) last.delete(last.keys().next().value!)
    return true
  }
}
