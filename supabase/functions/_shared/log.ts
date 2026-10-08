/**
 * Console lines about an error, codes only (CLAUDE.md §7: no address, token
 * or body in a log). A PostgREST / PostgreSQL error's `message`, `details`
 * and `hint` can quote row values (« Failing row contains (…) »), and an Auth
 * error's message can name an address, so none of them is ever printed: only
 * the error's kind (`name`), its code (a SQLSTATE, `PGRST…`, Auth's
 * `error_code`) and its HTTP status, each checked against a strict shape.
 */

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/

/** `name=… code=… status=…` from what the error carries, or `unknown`. */
export function errorTag(error: unknown): string {
  if (error === null || typeof error !== 'object') return 'unknown'
  const e = error as { name?: unknown; code?: unknown; status?: unknown }
  const parts: string[] = []
  // A plain `Error` says nothing more than « an error ».
  if (
    typeof e.name === 'string' && e.name !== 'Error' && SAFE_TOKEN.test(e.name)
  ) {
    parts.push(`name=${e.name}`)
  }
  if (typeof e.code === 'string' && SAFE_TOKEN.test(e.code)) {
    parts.push(`code=${e.code}`)
  }
  if (typeof e.status === 'number' && Number.isInteger(e.status)) {
    parts.push(`status=${e.status}`)
  }
  return parts.length > 0 ? parts.join(' ') : 'unknown'
}

/** One `console.error` line: `[where] what (name=… code=… status=…)`. */
export function logErrorCode(
  where: string,
  what: string,
  error: unknown,
): void {
  console.error(`[${where}] ${what} (${errorTag(error)})`)
}
