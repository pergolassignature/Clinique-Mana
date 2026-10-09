/**
 * Shapes checked in several functions. Dependency-free.
 *
 * Stricter local patterns stay where they are on purpose: `jobs.ts`
 * (`[A-Za-z0-9_]`, stored in `scheduled_job_runs`) and `signing-webhook`
 * (`[a-z0-9_]`, Documenso's event codes).
 */

/** A uuid in any case (ids from a request, a provider or a webhook). */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A uuid as Postgres prints it (lower case): an object path segment. */
export const LOWER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * A function name, error name or code safe to log or report. Upper case is
 * allowed on purpose: codes can be a SQLSTATE (`42P01`) or a PostgREST code
 * (`PGRST202`).
 */
export const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/
