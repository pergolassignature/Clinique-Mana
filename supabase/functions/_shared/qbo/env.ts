/**
 * Where the QuickBooks functions reach Intuit (plan §8, FQ), and what they
 * ask for.
 *
 * Intuit's origins are fixed: the consent page (`appcenter.intuit.com`), the
 * token endpoint (`oauth.platform.intuit.com`), the revocation endpoint
 * (`developer.api.intuit.com`) and the API, production or the developer
 * sandbox (PS Hub had production only). On a dev machine (`APP_URL` local,
 * like the Gmail fake) `QBO_APPCENTER_BASE_URL`, `QBO_OAUTH_BASE_URL`,
 * `QBO_REVOKE_BASE_URL` and `QBO_API_BASE_URL` point them at the local fake
 * (`npm run fake:qbo`, port 55394); `QBO_APPCENTER_PUBLIC_URL` is the consent
 * page as the browser reaches it. A stray value on a hosted project is
 * ignored, so a key can never be sent elsewhere.
 */
import { isLocalAppUrl } from '../local.ts'

export const QBO_APPCENTER_ORIGIN = 'https://appcenter.intuit.com'
export const QBO_OAUTH_ORIGIN = 'https://oauth.platform.intuit.com'
export const QBO_REVOKE_ORIGIN = 'https://developer.api.intuit.com'
export const QBO_API_ORIGINS = {
  production: 'https://quickbooks.api.intuit.com',
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
} as const

export type QboEnvironment = keyof typeof QBO_API_ORIGINS
export const QBO_ENVIRONMENTS = ['production', 'sandbox'] as const

/** The only scope asked: the accounting API (no payments, no OpenID). */
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'

/** Intuit's API version pinned for every call (PS Hub mixed 70, 75 and none). */
export const QBO_MINOR_VERSION = '75'

/** The org secrets of the integration (set in « QuickBooks », never in code). */
export const SECRET_CLIENT_ID = 'qbo_client_id'
export const SECRET_CLIENT_SECRET = 'qbo_client_secret'

/** The app path Intuit sends the browser back to (fixed: never from a request). */
export const RETURN_PATH = '/facturation/retour-quickbooks'

export interface QboOrigins {
  /** The consent page, as the functions name it in the URL they build. */
  appcenter: string
  /** The consent page as the browser reaches it (differs only with the local fake). */
  appcenterPublic: string
  oauth: string
  revoke: string
  /** The API of an environment. */
  api: (environment: QboEnvironment) => string
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

/** The origins the functions use (Intuit, or the local fake on a dev machine). */
export function qboOrigins(
  env: (key: string) => string | undefined,
): QboOrigins {
  const appcenter = override(
    env,
    'QBO_APPCENTER_BASE_URL',
    QBO_APPCENTER_ORIGIN,
  )
  const localApi = override(env, 'QBO_API_BASE_URL', '')
  return {
    appcenter,
    appcenterPublic: appcenter === QBO_APPCENTER_ORIGIN
      ? appcenter
      : override(env, 'QBO_APPCENTER_PUBLIC_URL', appcenter),
    oauth: override(env, 'QBO_OAUTH_BASE_URL', QBO_OAUTH_ORIGIN),
    revoke: override(env, 'QBO_REVOKE_BASE_URL', QBO_REVOKE_ORIGIN),
    api: (environment) => localApi || QBO_API_ORIGINS[environment],
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
