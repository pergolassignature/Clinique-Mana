/**
 * Where the Google busy-time functions (R6) reach Google, and what they ask for.
 *
 * The OAuth side is Gmail's (the clinic's Google application, the org secrets
 * `google_oauth_client_id` / `_secret`, the token, revoke and consent
 * origins: `gmailOrigins`). The API side is `www.googleapis.com` (FreeBusy and
 * the person's id); on a dev machine (`APP_URL` local) `GOOGLE_CALENDAR_BASE_URL`
 * points it at the local fake (`npm run fake:gmail`), ignored elsewhere.
 */
import { isLocalAppUrl } from '../local.ts'
import { type GmailOrigins, gmailOrigins } from '../gmail/env.ts'

export const GOOGLE_API_ORIGIN = 'https://www.googleapis.com'

/**
 * The scopes asked at consent (AP-41): who she is, and her free / busy times
 * only (never an event's title, attendees or place).
 */
export const CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const

/** The scope the sync needs; a grant without it is `scope_missing`. */
export const FREEBUSY_SCOPE = CALENDAR_SCOPES[2]

/** The app path Google sends the browser back to (fixed: never from a request). */
export const RETURN_PATH = '/mon-agenda/agenda-google'

/** How far ahead the busy times are read (the open slots' reach, AP-42). */
export const SYNC_DAYS = 62

export interface CalendarOrigins extends GmailOrigins {
  /** FreeBusy and the user's id. */
  calendar: string
}

/** The origins the functions use (Google, or the local fake on a dev machine). */
export function calendarOrigins(
  env: (key: string) => string | undefined,
): CalendarOrigins {
  const base = gmailOrigins(env)
  let calendar = GOOGLE_API_ORIGIN
  const raw = env('GOOGLE_CALENDAR_BASE_URL')?.trim()
  if (raw && isLocalAppUrl(env('APP_URL'))) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        calendar = url.origin
      }
    } catch {
      // A stray value: Google's own origin.
    }
  }
  return { ...base, calendar }
}

/** The OAuth redirect URI: `APP_URL` + the fixed return path, or null without a usable `APP_URL`. */
export function redirectUri(
  env: (key: string) => string | undefined,
): string | null {
  const appUrl = env('APP_URL')?.trim()
  if (!appUrl || !URL.canParse(appUrl)) return null
  const url = new URL(appUrl)
  if (url.protocol !== 'https:' && !isLocalAppUrl(appUrl)) return null
  return `${url.origin}${RETURN_PATH}`
}
