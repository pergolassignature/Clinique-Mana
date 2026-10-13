import { t } from '@/i18n'
import type { StripeCharge, StripePayer } from '../api/stripe'

const S = 'modules.billing.stripe'

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  interac: 'Interac',
}

/** « Visa •••• 4242, exp. 12/2030 »: never more than the last four digits. */
export function cardLabel(card: NonNullable<StripePayer['card']>): string {
  const brand = (card.brand && BRANDS[card.brand]) || t(`${S}.card`)
  const expiry =
    card.exp_month && card.exp_year
      ? ` ${t(`${S}.expires`, { month: String(card.exp_month).padStart(2, '0'), year: String(card.exp_year) })}`
      : ''
  return `${brand} •••• ${card.last4}${expiry}`
}

export const chargeStatusLabel = (status: StripeCharge['status']): string => t(`${S}.chargeStatus.${status}`)
export const chargeStatusVariant = (status: StripeCharge['status']): 'info' | 'success' | 'error' =>
  status === 'pending' ? 'info' : status === 'succeeded' ? 'success' : 'error'

const KNOWN_FAILURES = ['card_declined', 'insufficient_funds', 'expired_card', 'authentication_required', 'abandoned'] as const

/** The address to give Stripe for its events (`stripe-webhook`, the clinic in `?org=`). */
export function stripeWebhookUrl(orgId: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-webhook?org=${encodeURIComponent(orgId)}`
}

/** Why Stripe refused a charge, in plain French (« Fonds insuffisants »). */
export function failureLabel(code: string | null): string {
  const known = KNOWN_FAILURES.find((k) => k === code)
  return t(`${S}.failures.${known ?? 'other'}`)
}
