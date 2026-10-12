/**
 * Where the Gmail functions reach Google, and what they ask for.
 *
 * Google's origins are fixed; on a dev machine (`APP_URL` local, like the
 * places fake) `GMAIL_API_BASE_URL`, `GOOGLE_OAUTH_BASE_URL` and
 * `GOOGLE_ACCOUNTS_BASE_URL` point the three at the local fake
 * (`npm run fake:gmail`, port 55392): the API, the token endpoint and the
 * consent page. `GOOGLE_ACCOUNTS_PUBLIC_URL` is the consent page as the
 * browser reaches it (the fake listens on 127.0.0.1 while the functions reach
 * it through host.docker.internal). A stray value on a hosted project is
 * ignored, so a key can never be sent elsewhere.
 */
import { isLocalAppUrl } from '../local.ts'

/** Google's origins. */
export const GMAIL_API_ORIGIN = 'https://gmail.googleapis.com'
export const GOOGLE_OAUTH_ORIGIN = 'https://oauth2.googleapis.com'
export const GOOGLE_ACCOUNTS_ORIGIN = 'https://accounts.google.com'

/**
 * The scopes asked at consent (roadmap §2.4 bis): read and change the
 * mailbox, send from it. Nothing else (PS Hub added settings and calendar).
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
] as const

/** The scope the sync needs; a grant without it is `scope_missing`. */
export const REQUIRED_SCOPE = GMAIL_SCOPES[0]

/** The org secrets of the integration (set in « Courriels Gmail », never in code). */
export const SECRET_CLIENT_ID = 'google_oauth_client_id'
export const SECRET_CLIENT_SECRET = 'google_oauth_client_secret'
export const SECRET_PUBSUB_TOKEN = 'gmail_pubsub_token'

/** The app path Google sends the browser back to (fixed: never from a request). */
export const RETURN_PATH = '/courriels/retour-google'

export interface GmailOrigins {
  api: string
  oauth: string
  /** The consent page, as the functions name it in the URL they build. */
  accounts: string
  /** The consent page as the browser reaches it (differs from `accounts` only with the local fake). */
  accountsPublic: string
}

function override(
  env: (key: string) => string | undefined,
  key: string,
  fallback: string,
): string {
  const raw = env(key)?.trim()
  if (!raw || !isLocalAppUrl(env('APP_URL'))) return fallback
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : fallback
  } catch {
    return fallback
  }
}

/** The origins the functions use (Google, or the local fake on a dev machine). */
export function gmailOrigins(
  env: (key: string) => string | undefined,
): GmailOrigins {
  const accounts = override(
    env,
    'GOOGLE_ACCOUNTS_BASE_URL',
    GOOGLE_ACCOUNTS_ORIGIN,
  )
  return {
    api: override(env, 'GMAIL_API_BASE_URL', GMAIL_API_ORIGIN),
    oauth: override(env, 'GOOGLE_OAUTH_BASE_URL', GOOGLE_OAUTH_ORIGIN),
    accounts,
    accountsPublic: accounts === GOOGLE_ACCOUNTS_ORIGIN
      ? accounts
      : override(env, 'GOOGLE_ACCOUNTS_PUBLIC_URL', accounts),
  }
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
