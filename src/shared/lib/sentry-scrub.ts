import type { BrowserOptions } from '@sentry/react'

type SentryEvent = Parameters<NonNullable<BrowserOptions['beforeSend']>>[0]

/** 7 digits or more in a row: an account number, a SIN, a phone number… */
const LONG_DIGIT_RUNS = /[0-9]{7,}/g

export const redactDigitRuns = (text: string) => text.replace(LONG_DIGIT_RUNS, '[redacted]')

/**
 * Sentry's `beforeSend` backstop (`main.tsx`). Reports should already carry no personal data
 * (`moduleErrorMessage` sends the message only), but a raw object passed to `captureException`
 * elsewhere is serialized into `extra.__serialized__`, and the console integration records logged
 * values. So:
 * - PostgreSQL's `details` and `hint` (which can hold row values, « Failing row contains (…) ») are
 *   dropped from `extra.__serialized__`;
 * - console breadcrumbs lose their logged `data.arguments`;
 * - runs of 7+ digits are redacted in the event message, exception values and breadcrumb messages.
 *
 * Mutates and returns the event. If scrubbing throws, returns null: the event is dropped rather
 * than sent unscrubbed.
 */
export function scrubSentryEvent<T extends SentryEvent>(event: T): T | null {
  try {
    const serialized = event.extra?.__serialized__
    if (serialized && typeof serialized === 'object') {
      const fields = serialized as Record<string, unknown>
      delete fields.details
      delete fields.hint
    }
    if (typeof event.message === 'string') event.message = redactDigitRuns(event.message)
    for (const exception of event.exception?.values ?? []) {
      if (typeof exception.value === 'string') exception.value = redactDigitRuns(exception.value)
    }
    for (const breadcrumb of event.breadcrumbs ?? []) {
      if (typeof breadcrumb.message === 'string') breadcrumb.message = redactDigitRuns(breadcrumb.message)
      if (breadcrumb.category === 'console' && breadcrumb.data) delete breadcrumb.data.arguments
    }
    return event
  } catch {
    return null
  }
}
