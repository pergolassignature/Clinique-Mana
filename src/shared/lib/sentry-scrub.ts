import type { BrowserOptions } from '@sentry/react'

type SentryEvent = Parameters<NonNullable<BrowserOptions['beforeSend']>>[0]

/** 7 digits or more in a row: an account number, a SIN, a phone number… */
const LONG_DIGIT_RUNS = /[0-9]{7,}/g

export const redactDigitRuns = (text: string) => text.replace(LONG_DIGIT_RUNS, '[redacted]')

/**
 * Query params Supabase Auth puts in a URL (magic link, recovery, invite, PKCE callback). The
 * implicit flow puts the tokens in the `#…` fragment, which is always dropped.
 */
const AUTH_PARAMS = new Set(['access_token', 'refresh_token', 'code', 'token', 'token_hash', 'type'])

const beforeFragment = (text: string) => {
  const hash = text.indexOf('#')
  return hash === -1 ? text : text.slice(0, hash)
}

/** Drops the auth params from a raw query string (no leading `?`), keeping the others as written. */
function scrubQuery(query: string): string {
  return query
    .split('&')
    .filter((pair) => {
      const equals = pair.indexOf('=')
      const key = equals === -1 ? pair : pair.slice(0, equals)
      let name = key
      try {
        name = decodeURIComponent(key.replace(/\+/g, ' '))
      } catch {
        // A malformed escape: compare the raw key.
      }
      return pair !== '' && !AUTH_PARAMS.has(name)
    })
    .join('&')
}

/** Drops the `#…` fragment and the auth query params from a URL, absolute or relative. */
export function scrubUrl(url: string): string {
  const withoutFragment = beforeFragment(url)
  const queryStart = withoutFragment.indexOf('?')
  if (queryStart === -1) return withoutFragment
  const query = scrubQuery(withoutFragment.slice(queryStart + 1))
  return withoutFragment.slice(0, queryStart) + (query ? `?${query}` : '')
}

type QueryString = NonNullable<NonNullable<SentryEvent['request']>['query_string']>

function scrubQueryString(query: QueryString): QueryString {
  if (typeof query === 'string') {
    const leading = query.startsWith('?') ? '?' : ''
    return leading + scrubQuery(beforeFragment(query.slice(leading.length)))
  }
  if (Array.isArray(query)) return query.filter(([key]) => !AUTH_PARAMS.has(key))
  return Object.fromEntries(Object.entries(query).filter(([key]) => !AUTH_PARAMS.has(key)))
}

/** Breadcrumb data keys that hold a URL: fetch/xhr `url`, navigation `from` / `to`. */
const BREADCRUMB_URL_KEYS = ['url', 'from', 'to'] as const

/**
 * Sentry's `beforeSend` backstop (`main.tsx`). Reports should already carry no personal data
 * (`moduleErrorMessage` sends the message only), but a raw object passed to `captureException`
 * elsewhere is serialized into `extra.__serialized__`, and the console integration records logged
 * values. So:
 * - PostgreSQL's `details` and `hint` (which can hold row values, « Failing row contains (…) ») are
 *   dropped from `extra.__serialized__`;
 * - console breadcrumbs lose their logged `data.arguments`;
 * - runs of 7+ digits are redacted in the event message, exception values and breadcrumb messages;
 * - URLs lose their `#…` fragment and the Supabase Auth params (`access_token`, `code`, `token_hash`…):
 *   `request.url`, `request.query_string`, the `Referer` header, and breadcrumb `data.url` (fetch,
 *   xhr) and `data.from` / `data.to` (navigation). A recovery or invite link would otherwise send a
 *   live session to Sentry. Breadcrumbs only leave inside an event, so no `beforeBreadcrumb`.
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
    const request = event.request
    if (request) {
      if (typeof request.url === 'string') request.url = scrubUrl(request.url)
      if (request.query_string) request.query_string = scrubQueryString(request.query_string)
      const headers = request.headers
      for (const [name, value] of Object.entries(headers ?? {})) {
        if (headers && name.toLowerCase() === 'referer' && typeof value === 'string') headers[name] = scrubUrl(value)
      }
    }
    for (const exception of event.exception?.values ?? []) {
      if (typeof exception.value === 'string') exception.value = redactDigitRuns(exception.value)
    }
    for (const breadcrumb of event.breadcrumbs ?? []) {
      if (typeof breadcrumb.message === 'string') breadcrumb.message = redactDigitRuns(breadcrumb.message)
      const data = breadcrumb.data
      if (!data) continue
      if (breadcrumb.category === 'console') delete data.arguments
      for (const key of BREADCRUMB_URL_KEYS) {
        if (typeof data[key] === 'string') data[key] = scrubUrl(data[key])
      }
    }
    return event
  } catch {
    return null
  }
}
