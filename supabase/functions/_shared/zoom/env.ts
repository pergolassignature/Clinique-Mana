/**
 * Where the Zoom functions reach Zoom (RZ), and the clinic's settings they
 * read.
 *
 * Zoom's origins are fixed; on a dev machine (`APP_URL` local, like the Gmail
 * fake) `ZOOM_OAUTH_BASE_URL` and `ZOOM_API_BASE_URL` point both at the local
 * fake (`npm run fake:zoom`, port 55394), and `ZOOM_OAUTH_PUBLIC_URL` is the
 * consent page as the browser reaches it (the fake listens on 127.0.0.1
 * while the functions reach it through host.docker.internal). A stray value
 * on a hosted project is ignored, so a token can never be sent elsewhere.
 */
import { isLocalAppUrl } from '../local.ts'

/** Zoom's OAuth origin (consent page, token and revoke endpoints). */
export const ZOOM_OAUTH_ORIGIN = 'https://zoom.us'
/** Zoom's API origin (`/v2/...`). */
export const ZOOM_API_ORIGIN = 'https://api.zoom.us'

/** The org secrets of the integration (Paramètres → Vidéoconférence, never in code). */
export const SECRET_CLIENT_ID = 'zoom_client_id'
export const SECRET_CLIENT_SECRET = 'zoom_client_secret'
/** The app's « Secret Token », which signs Zoom's event notifications. */
export const SECRET_WEBHOOK = 'zoom_webhook_secret'

/** The app path Zoom sends the browser back to (fixed: never from a request). */
export const RETURN_PATH = '/mon-agenda/videoconference'

/** What a meeting is called at Zoom: never a client's name. */
export const MEETING_TOPIC = 'Rendez-vous MANA'

export interface ZoomOrigins {
  /** The token and revoke endpoints, as the functions reach them. */
  oauth: string
  /** The consent page as the browser reaches it. */
  oauthPublic: string
  api: string
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

/** The origins the functions use (Zoom, or the local fake on a dev machine). */
export function zoomOrigins(
  env: (key: string) => string | undefined,
): ZoomOrigins {
  const oauth = override(env, 'ZOOM_OAUTH_BASE_URL', ZOOM_OAUTH_ORIGIN)
  return {
    oauth,
    oauthPublic: oauth === ZOOM_OAUTH_ORIGIN
      ? oauth
      : override(env, 'ZOOM_OAUTH_PUBLIC_URL', oauth),
    api: override(env, 'ZOOM_API_BASE_URL', ZOOM_API_ORIGIN),
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
