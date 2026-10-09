/**
 * A fake Google Places API (New), the two calls `places` makes (P4-220):
 * `POST /v1/places:autocomplete` and `GET /v1/places/{id}`. One fake for the
 * Deno tests (`fakePlaces().fetch`) and local development
 * (`scripts/fake-places.ts`, `npm run fake:places`). Test-only: no
 * `index.ts` imports it, so it is never deployed.
 *
 * Behaviour, as Google's:
 * - the key is `X-Goog-Api-Key` (`FAKE_PLACES_KEY`); a wrong or missing one
 *   → 403 with an error body;
 * - autocomplete answers the canned places whose text holds every typed word
 *   (accents and case ignored), at most 5, in Google's shape;
 * - details needs `X-Goog-FieldMask` (400 without) and answers only the
 *   masked fields; an unknown id → 404.
 * Error bodies carry `FAKE_ERROR_MARKER`, so tests can prove the function
 * never passes them on.
 *
 * The canned places are the Québec cases the address mapping must handle:
 * Montréal arrondissements (Le Plateau-Mont-Royal, Verdun), Lévis, Gatineau
 * (Hull), a rural rang without a locality, a numbered route, a unit, a road
 * without a number or full postal code, and Ontario for contrast.
 */
import type { AddressComponent } from '../../places/address.ts'

/** The local fake's key (`supabase/functions/.env.example`). */
export const FAKE_PLACES_KEY = 'local-dev-google-places-key'

/** Present in every error body the fake sends. */
export const FAKE_ERROR_MARKER = 'FAKE-GOOGLE-ERROR-BODY'

/** One canned place. */
export interface FakePlace {
  id: string
  main: string
  secondary: string
  formattedAddress: string
  components: AddressComponent[]
}

const c = (
  types: string[],
  longText: string,
  shortText = longText,
): AddressComponent => ({ longText, shortText, types })

const QC = c(['administrative_area_level_1', 'political'], 'Québec', 'QC')
const CANADA = c(['country', 'political'], 'Canada', 'CA')
const MONTREAL = c(['locality', 'political'], 'Montréal')
const MTL_REGION = c(
  ['administrative_area_level_2', 'political'],
  'Communauté-Urbaine-de-Montréal',
)
const postal = (code: string) => c(['postal_code'], code)

/** The canned places, keyed by a short name for tests. */
export const FAKE_PLACES = {
  plateau: {
    id: 'ChIJfakePlateau000001',
    main: '1234 Rue Saint-Denis',
    secondary: 'Montréal, QC, Canada',
    formattedAddress: '1234 Rue Saint-Denis, Montréal, QC H2X 3J6, Canada',
    components: [
      c(['street_number'], '1234'),
      c(['route'], 'Rue Saint-Denis'),
      c(
        ['sublocality_level_1', 'sublocality', 'political'],
        'Le Plateau-Mont-Royal',
      ),
      MONTREAL,
      MTL_REGION,
      QC,
      CANADA,
      postal('H2X 3J6'),
    ],
  },
  verdun: {
    id: 'ChIJfakeVerdun0000002',
    main: '4100 Rue Wellington',
    secondary: 'Verdun, Montréal, QC, Canada',
    formattedAddress: '4100 Rue Wellington, Verdun, QC H4G 1V7, Canada',
    components: [
      c(['street_number'], '4100'),
      c(['route'], 'Rue Wellington'),
      c(['sublocality_level_1', 'sublocality', 'political'], 'Verdun'),
      MONTREAL,
      MTL_REGION,
      QC,
      CANADA,
      postal('H4G 1V7'),
    ],
  },
  levis: {
    id: 'ChIJfakeLevis00000003',
    main: '5955 Rue Saint-Laurent',
    secondary: 'Lévis, QC, Canada',
    formattedAddress: '5955 Rue Saint-Laurent, Lévis, QC G6V 3P5, Canada',
    components: [
      c(['street_number'], '5955'),
      c(['route'], 'Rue Saint-Laurent'),
      c(['sublocality_level_1', 'sublocality', 'political'], 'Desjardins'),
      c(['locality', 'political'], 'Lévis'),
      QC,
      CANADA,
      postal('G6V 3P5'),
    ],
  },
  gatineau: {
    id: 'ChIJfakeGatineau00004',
    main: '25 Rue Laurier',
    secondary: 'Gatineau, QC, Canada',
    formattedAddress: '25 Rue Laurier, Gatineau, QC J8X 4C8, Canada',
    components: [
      c(['street_number'], '25'),
      c(['route'], 'Rue Laurier'),
      c(['sublocality_level_1', 'sublocality', 'political'], 'Hull'),
      c(['locality', 'political'], 'Gatineau'),
      c(['administrative_area_level_2', 'political'], 'Gatineau'),
      QC,
      CANADA,
      postal('J8X 4C8'),
    ],
  },
  rural: {
    id: 'ChIJfakeRang00000005',
    main: '1500 Rang Saint-Joseph',
    secondary: 'Saint-Liboire, QC, Canada',
    formattedAddress:
      '1500 Rang Saint-Joseph, Saint-Liboire, QC J0H 1R0, Canada',
    components: [
      c(['street_number'], '1500'),
      c(['route'], 'Rang Saint-Joseph'),
      c(['administrative_area_level_3', 'political'], 'Saint-Liboire'),
      c(['administrative_area_level_2', 'political'], 'Les Maskoutains'),
      QC,
      CANADA,
      postal('J0H 1R0'),
    ],
  },
  route132: {
    id: 'ChIJfakeRoute13200006',
    main: '2200 Route 132',
    secondary: 'Sainte-Flavie, QC, Canada',
    formattedAddress: '2200 Route 132, Sainte-Flavie, QC G0J 2L0, Canada',
    components: [
      c(['street_number'], '2200'),
      c(['route'], 'Route 132'),
      c(['locality', 'political'], 'Sainte-Flavie'),
      QC,
      CANADA,
      postal('G0J 2L0'),
    ],
  },
  unit: {
    id: 'ChIJfakeUnit00000007',
    main: '402-3450 Rue Drummond',
    secondary: 'Montréal, QC, Canada',
    formattedAddress: '3450 Rue Drummond #402, Montréal, QC H3G 1Y2, Canada',
    components: [
      c(['subpremise'], '402'),
      c(['street_number'], '3450'),
      c(['route'], 'Rue Drummond'),
      MONTREAL,
      MTL_REGION,
      QC,
      CANADA,
      postal('H3G 1Y2'),
    ],
  },
  noNumber: {
    id: 'ChIJfakeLacEcho000008',
    main: 'Chemin du Lac-Écho',
    secondary: 'Prévost, QC, Canada',
    formattedAddress: 'Chemin du Lac-Écho, Prévost, QC J0R, Canada',
    components: [
      c(['route'], 'Chemin du Lac-Écho'),
      c(['locality', 'political'], 'Prévost'),
      QC,
      CANADA,
      c(['postal_code_prefix', 'postal_code'], 'J0R'),
    ],
  },
  toronto: {
    id: 'ChIJfakeToronto00009',
    main: '100 Queen Street West',
    secondary: 'Toronto, ON, Canada',
    formattedAddress: '100 Queen St W, Toronto, ON M5H 2N2, Canada',
    components: [
      c(['street_number'], '100'),
      c(['route'], 'Queen Street West', 'Queen St W'),
      c(['locality', 'political'], 'Toronto'),
      c(['administrative_area_level_1', 'political'], 'Ontario', 'ON'),
      CANADA,
      postal('M5H 2N2'),
    ],
  },
} as const satisfies Record<string, FakePlace>

/** One call the fake answered (tests read it; the local server clears it). */
export interface FakePlacesCall {
  action: 'autocomplete' | 'details'
  sessionToken: string | null
  placeId?: string
  fieldMask?: string | null
}

const fold = (v: string) =>
  v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Google's error shape, with the marker in the message. */
const googleError = (status: number, statusText: string) =>
  json(status, {
    error: {
      code: status,
      message: `${FAKE_ERROR_MARKER}: ${statusText}`,
      status: statusText,
    },
  })

/** The fake: its handler (any host), a fetch over it, and its call log. */
export function fakePlaces(
  options: { key?: string; places?: FakePlace[] } = {},
): {
  handler: (req: Request) => Promise<Response>
  fetch: typeof fetch
  calls: FakePlacesCall[]
} {
  const key = options.key ?? FAKE_PLACES_KEY
  const places: FakePlace[] = options.places ?? Object.values(FAKE_PLACES)
  const calls: FakePlacesCall[] = []

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.headers.get('X-Goog-Api-Key') !== key) {
      return googleError(403, 'PERMISSION_DENIED')
    }
    if (req.method === 'POST' && url.pathname === '/v1/places:autocomplete') {
      let body: { input?: unknown; sessionToken?: unknown }
      try {
        body = await req.json()
      } catch {
        return googleError(400, 'INVALID_ARGUMENT')
      }
      if (typeof body.input !== 'string') {
        return googleError(400, 'INVALID_ARGUMENT')
      }
      calls.push({
        action: 'autocomplete',
        sessionToken: typeof body.sessionToken === 'string'
          ? body.sessionToken
          : null,
      })
      const words = fold(body.input).split(/[\s,]+/).filter(Boolean)
      const found = places.filter((p) => {
        const haystack = fold(`${p.main} ${p.secondary}`)
        return words.every((w) => haystack.includes(w))
      }).slice(0, 5)
      return json(200, {
        suggestions: found.map((p) => ({
          placePrediction: {
            place: `places/${p.id}`,
            placeId: p.id,
            text: { text: `${p.main}, ${p.secondary}` },
            structuredFormat: {
              mainText: { text: p.main },
              secondaryText: { text: p.secondary },
            },
            types: ['street_address', 'geocode'],
          },
        })),
      })
    }
    const detail = /^\/v1\/places\/([^/:]+)$/.exec(url.pathname)
    if (req.method === 'GET' && detail) {
      const placeId = decodeURIComponent(detail[1])
      const mask = req.headers.get('X-Goog-FieldMask')
      calls.push({
        action: 'details',
        sessionToken: url.searchParams.get('sessionToken'),
        placeId,
        fieldMask: mask,
      })
      if (!mask) return googleError(400, 'INVALID_ARGUMENT')
      const place = places.find((p) => p.id === placeId)
      if (!place) return googleError(404, 'NOT_FOUND')
      const fields = new Set(mask.split(',').map((f) => f.trim()))
      return json(200, {
        ...(fields.has('formattedAddress') &&
          { formattedAddress: place.formattedAddress }),
        ...(fields.has('addressComponents') && {
          addressComponents: place.components.map((comp) => ({
            ...comp,
            languageCode: 'fr',
          })),
        }),
      })
    }
    return googleError(404, 'NOT_FOUND')
  }

  const fetchFake = (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(input, init))
  return { handler, fetch: fetchFake as typeof fetch, calls }
}
