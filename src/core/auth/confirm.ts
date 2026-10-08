import { safeRedirect } from './redirect'

/** The email-link types `/connexion/confirmer` verifies (design §5). */
export type ConfirmType = 'recovery' | 'email' | 'email_change'

const CONFIRM_TYPES: readonly string[] = ['recovery', 'email', 'email_change'] satisfies ConfirmType[]

/** Validates `?type=`; anything else → null (the page shows the error state). */
export function parseConfirmType(value: string | null): ConfirmType | null {
  return value !== null && CONFIRM_TYPES.includes(value) ? (value as ConfirmType) : null
}

/**
 * Where a magic link lands. `next` may be a path or an absolute URL (`{{ .RedirectTo }}` is
 * absolute): an absolute URL must be on `origin` and is reduced to its path. Then safeRedirect;
 * '/accueil' by default.
 */
export function confirmNext(next: string | null, origin: string): string {
  if (!next) return safeRedirect(null)
  let absolute: URL | null = null
  try {
    absolute = new URL(next)
  } catch {
    // Not an absolute URL: a path, checked by safeRedirect.
  }
  if (!absolute) return safeRedirect(next)
  if (absolute.origin !== origin) return safeRedirect(null)
  return safeRedirect(absolute.pathname + absolute.search + absolute.hash)
}
