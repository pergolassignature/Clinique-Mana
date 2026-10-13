/**
 * Where the Stripe functions reach Stripe (Facturation FS), and the clinic's
 * settings they read.
 *
 * Stripe's API origin is fixed; on a dev machine (`APP_URL` local, like the
 * Zoom and Gmail fakes) `STRIPE_API_BASE_URL` points at the local fake
 * (`npm run fake:stripe`, port 55397). A stray value on a hosted project is
 * ignored, so a key can never be sent elsewhere.
 */
import { isLocalAppUrl } from '../local.ts'

/** Stripe's API origin. */
export const STRIPE_API_ORIGIN = 'https://api.stripe.com'
/** Where Stripe Checkout pages live (the only URL a function hands a browser). */
export const STRIPE_CHECKOUT_ORIGIN = 'https://checkout.stripe.com'

/** The org secrets of the integration (Paramètres → Paiements en ligne, never in code). */
export const SECRET_KEY = 'stripe_secret_key'
/** Signs Stripe's webhook events (`whsec_…`). */
export const SECRET_WEBHOOK = 'stripe_webhook_secret'

/** The app's pages a checkout comes back to (fixed: never from a request). */
export const CARD_PATH = '/carte'
export const PAY_PATH = '/payer'

/** Card amounts are in Canadian dollars. */
export const CURRENCY = 'cad'

/** The API origin the functions use (Stripe, or the local fake on a dev machine). */
export function stripeApiOrigin(
  env: (key: string) => string | undefined,
): string {
  const raw = env('STRIPE_API_BASE_URL')?.trim()
  if (!raw || !isLocalAppUrl(env('APP_URL'))) return STRIPE_API_ORIGIN
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : STRIPE_API_ORIGIN
  } catch {
    return STRIPE_API_ORIGIN
  }
}

/**
 * Whether a Checkout URL Stripe answered may be handed to a browser: Stripe's
 * checkout origin, or (on a dev machine only) the local fake's page.
 */
export function isCheckoutUrl(
  url: unknown,
  env: (key: string) => string | undefined,
): url is string {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    if (parsed.origin === STRIPE_CHECKOUT_ORIGIN) return true
    return stripeApiOrigin(env) !== STRIPE_API_ORIGIN &&
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  } catch {
    return false
  }
}
