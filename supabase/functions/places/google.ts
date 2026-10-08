/**
 * The two Places API (New) calls `places` makes (P4-220), with the key in a
 * header (never in a URL), a timeout, and Google's answer reduced to what the
 * app needs. Google's error bodies are never read into anything returned,
 * logged or reported: a failure is a `PlacesError` whose `code` is ours.
 *
 * - `autocomplete`: `POST /v1/places:autocomplete`, Canadian results only
 *   (`includedRegionCodes`), French (`languageCode: 'fr'`, legacy parity),
 *   biased to southern Québec (`locationBias`), with the session token.
 * - `details`: `GET /v1/places/{id}?sessionToken=…`, field mask
 *   `addressComponents,formattedAddress` only (Essentials-tier fields), which
 *   ends the session: Google bills the session's autocompletes and this call
 *   as one session.
 */
import { z } from 'zod'
import {
  type AddressComponent,
  type PlaceAddress,
  toPlaceAddress,
} from './address.ts'

/** Google's origin. A local fake replaces it only on a dev machine (`handler.ts`). */
export const GOOGLE_PLACES_ORIGIN = 'https://places.googleapis.com'

/** Each call is cut after this (the field waits for it while the person types). */
export const PLACES_TIMEOUT_MS = 5_000

/** Largest answer read from Google (an autocomplete answer is a few kB). */
const MAX_ANSWER_BYTES = 256 * 1024

/** At most this many suggestions reach the app (Google returns up to 5). */
export const MAX_SUGGESTIONS = 5

/**
 * Southern Québec, where nearly every address typed lives (a bias, not a
 * restriction: the rest of Canada still comes up). The legacy rectangle
 * stopped at 47.5° N and −71°, so Québec City's east, the Saguenay and the
 * Bas-Saint-Laurent ranked low.
 */
export const QUEBEC_BIAS = {
  rectangle: {
    low: { latitude: 44.9, longitude: -79.8 },
    high: { latitude: 49.5, longitude: -64.0 },
  },
} as const

/** One suggestion, as the function answers it. */
export interface Suggestion {
  place_id: string
  main_text: string
  secondary_text: string
}

/**
 * Why a call failed, as our own code:
 * - `places_timeout`, `places_unreachable`: no answer;
 * - `places_key_rejected`: 401/403 (bad key, API not enabled, restriction);
 * - `places_not_found`: 404 (an unknown or expired place id);
 * - `places_bad_request`: 400 (an argument Google refused);
 * - `places_quota`: 429;
 * - `places_http_<status>`: another status;
 * - `places_unusable_answer`: a 2xx that is not the expected JSON.
 */
export class PlacesError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'PlacesError'
  }
}

/** What a place id looks like (Google's are URL-safe base64, `ChIJ…`). */
export const PLACE_ID = /^[A-Za-z0-9_-]{8,512}$/

/** A session token Google accepts: URL- and filename-safe base64, at most 36 characters. */
export const SESSION_TOKEN = /^[A-Za-z0-9_-]{8,36}$/

const textSchema = z.looseObject({ text: z.string().optional() }).optional()

const autocompleteSchema = z.looseObject({
  suggestions: z.array(
    z.looseObject({
      placePrediction: z.looseObject({
        placeId: z.string().optional(),
        text: textSchema,
        structuredFormat: z.looseObject({
          mainText: textSchema,
          secondaryText: textSchema,
        }).optional(),
      }).optional(),
    }),
  ).optional(),
})

const detailsSchema = z.looseObject({
  formattedAddress: z.string().optional(),
  addressComponents: z.array(
    z.looseObject({
      longText: z.string().optional(),
      shortText: z.string().optional(),
      types: z.array(z.string()).optional(),
    }),
  ).optional(),
})

interface CallOptions {
  fetch: typeof fetch
  key: string
  /** `GOOGLE_PLACES_ORIGIN`, or the local fake's. */
  origin: string
  /** The caller's request signal: a closed connection stops the call. */
  signal?: AbortSignal
  timeoutMs?: number
}

/** Maps a non-2xx status to our code. */
function statusCode(status: number): string {
  if (status === 401 || status === 403) return 'places_key_rejected'
  if (status === 404) return 'places_not_found'
  if (status === 400) return 'places_bad_request'
  if (status === 429) return 'places_quota'
  return `places_http_${status}`
}

/** One request to Google; the parsed JSON body of a 2xx, or a PlacesError. */
async function call(
  url: string,
  init: RequestInit,
  options: CallOptions,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? PLACES_TIMEOUT_MS)
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout
  let res: Response
  try {
    res = await options.fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        'X-Goog-Api-Key': options.key,
      },
      signal,
      redirect: 'error',
    })
  } catch {
    throw new PlacesError(
      timeout.aborted ? 'places_timeout' : 'places_unreachable',
    )
  }
  try {
    if (!res.ok) throw new PlacesError(statusCode(res.status))
    const declared = Number(res.headers.get('Content-Length'))
    if (declared > MAX_ANSWER_BYTES) {
      throw new PlacesError('places_unusable_answer')
    }
    let text: string
    try {
      text = await res.text()
    } catch {
      throw new PlacesError(
        timeout.aborted ? 'places_timeout' : 'places_unreachable',
      )
    }
    if (text.length > MAX_ANSWER_BYTES) {
      throw new PlacesError('places_unusable_answer')
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new PlacesError('places_unusable_answer')
    }
  } finally {
    // Never read Google's error body; release it.
    if (!res.bodyUsed) await res.body?.cancel().catch(() => {})
  }
}

/** Suggestions for `input` (already validated), at most `MAX_SUGGESTIONS`. */
export async function autocomplete(
  input: string,
  sessionToken: string,
  options: CallOptions,
): Promise<Suggestion[]> {
  const body = await call(`${options.origin}/v1/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      sessionToken,
      languageCode: 'fr',
      regionCode: 'ca',
      includedRegionCodes: ['ca'],
      locationBias: QUEBEC_BIAS,
    }),
  }, options)
  const parsed = autocompleteSchema.safeParse(body)
  if (!parsed.success) throw new PlacesError('places_unusable_answer')
  const suggestions: Suggestion[] = []
  for (const { placePrediction: p } of parsed.data.suggestions ?? []) {
    const placeId = p?.placeId
    // Query predictions (no place id) and odd ids are skipped.
    if (!placeId || !PLACE_ID.test(placeId)) continue
    const main = p.structuredFormat?.mainText?.text?.trim() ||
      p.text?.text?.trim()
    if (!main) continue
    suggestions.push({
      place_id: placeId,
      main_text: main.slice(0, 200),
      secondary_text: (p.structuredFormat?.secondaryText?.text?.trim() ?? '')
        .slice(0, 200),
    })
    if (suggestions.length === MAX_SUGGESTIONS) break
  }
  return suggestions
}

/** The address of `placeId` (validated), ending the session. */
export async function details(
  placeId: string,
  sessionToken: string,
  options: CallOptions,
): Promise<PlaceAddress> {
  const query = new URLSearchParams({
    languageCode: 'fr',
    regionCode: 'ca',
    sessionToken,
  })
  const body = await call(
    `${options.origin}/v1/places/${encodeURIComponent(placeId)}?${query}`,
    {
      method: 'GET',
      headers: { 'X-Goog-FieldMask': 'addressComponents,formattedAddress' },
    },
    options,
  )
  const parsed = detailsSchema.safeParse(body)
  if (!parsed.success) throw new PlacesError('places_unusable_answer')
  return toPlaceAddress(
    (parsed.data.addressComponents ?? []) as AddressComponent[],
    parsed.data.formattedAddress,
  )
}
