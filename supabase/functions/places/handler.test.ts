import { assert, assertEquals, assertFalse } from '@std/assert'
import {
  createHandler,
  REPORT_EVERY_MS,
  resetPlacesReportsForTests,
} from './handler.ts'
import { MAX_SUGGESTIONS, PLACES_TIMEOUT_MS } from './google.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import {
  FAKE_ERROR_MARKER,
  FAKE_PLACES,
  FAKE_PLACES_KEY,
  fakePlaces,
} from '../_shared/testing/fake-places.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { accessFixture, ORG_ID } from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/places'
const NOW = Date.parse('2026-10-08T15:00:00.000Z')
const SESSION = '3519edfe-0f75-4a30-bfe4-7cbd89340b2c'
const GOOGLE = 'https://places.googleapis.com'

const post = (
  body: unknown,
  init: {
    token?: string | null
    headers?: Record<string, string>
    signal?: AbortSignal
  } = {},
) => {
  const token = init.token === undefined ? 'tok' : init.token
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: init.signal,
  })
}

const typed = (input: string) => ({
  action: 'autocomplete',
  input,
  session: SESSION,
})
const picked = (placeId: string) => ({
  action: 'details',
  place_id: placeId,
  session: SESSION,
})

function harness(opts: {
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  limit?: RpcRoute
  access?: Record<string, unknown> | null
  now?: () => number
} = {}) {
  const google = fakePlaces()
  const user = fakeSupabase({
    user: { id: 'u1' },
    rpc: {
      get_my_access: {
        data: opts.access === undefined ? accessFixture([]) : opts.access,
      },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: opts.limit ??
        { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }] },
    },
  })
  const env: Record<string, string | undefined> = {
    GOOGLE_PLACES_API_KEY: FAKE_PLACES_KEY,
    APP_URL: 'https://app.cliniquemana.com',
    ...opts.env,
  }
  let clock = NOW
  const deps: Deps = {
    env: (key) => env[key],
    fetch: opts.fetch ?? google.fetch,
    now: () => new Date(opts.now?.() ?? clock),
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return {
    handler: createHandler(deps),
    google,
    service,
    user,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const run = (fn: () => Promise<void>) =>
  withEnv(
    {
      SENTRY_DSN: undefined,
      ALLOWED_ORIGINS: 'https://app.cliniquemana.com',
      INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    },
    async () => {
      resetPlacesReportsForTests()
      await fn()
    },
  )

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

/** The JSON report lines written while fn ran. */
async function reports(fn: () => Promise<void>) {
  const logged = await captureConsole('error', fn)
  return logged.map((args) => JSON.parse(String(args[0])))
}

Deno.test('places: autocomplete → Google suggestions, with the session token, Canada only, French, biased to Québec', async () => {
  await run(async () => {
    const { handler, google, service } = harness()
    const res = await handler(post(typed('1234 saint-denis')))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      suggestions: [{
        place_id: FAKE_PLACES.plateau.id,
        main_text: '1234 Rue Saint-Denis',
        secondary_text: 'Montréal, QC, Canada',
      }],
    })
    assertEquals(google.calls, [{
      action: 'autocomplete',
      sessionToken: SESSION,
    }])
    // One hit per caller, keyed on org and user (hashed), on the places bucket.
    assertEquals(
      service.calls.map((c) => [c.fn, c.args.p_bucket, c.args.p_max]),
      [['consume_rate_limit', 'places.user', 600]],
    )
  })
})

Deno.test('places: the Google request carries the key in a header, never in the URL, and the expected body', async () => {
  await run(async () => {
    const seen: Request[] = []
    const google = fakePlaces()
    const { handler } = harness({
      fetch: async (input, init) => {
        const req = new Request(input, init)
        seen.push(req.clone())
        return await google.handler(req)
      },
    })
    await handler(post(typed('rue wellington')))
    await handler(post(picked(FAKE_PLACES.verdun.id)))
    const [auto, details] = seen
    assertEquals(
      new URL(auto.url).origin + new URL(auto.url).pathname,
      `${GOOGLE}/v1/places:autocomplete`,
    )
    assertEquals(auto.headers.get('X-Goog-Api-Key'), FAKE_PLACES_KEY)
    assertFalse(auto.url.includes(FAKE_PLACES_KEY))
    assertEquals(await auto.json(), {
      input: 'rue wellington',
      sessionToken: SESSION,
      languageCode: 'fr',
      regionCode: 'ca',
      includedRegionCodes: ['ca'],
      locationBias: {
        rectangle: {
          low: { latitude: 44.9, longitude: -79.8 },
          high: { latitude: 49.5, longitude: -64.0 },
        },
      },
    })
    const detailsUrl = new URL(details.url)
    assertEquals(
      detailsUrl.origin + detailsUrl.pathname,
      `${GOOGLE}/v1/places/${FAKE_PLACES.verdun.id}`,
    )
    assertEquals(detailsUrl.searchParams.get('sessionToken'), SESSION)
    assertEquals(
      details.headers.get('X-Goog-FieldMask'),
      'addressComponents,formattedAddress',
    )
    assertFalse(details.url.includes(FAKE_PLACES_KEY))
  })
})

Deno.test('places: details → the mapped address, ending the session with the same token', async () => {
  await run(async () => {
    const { handler, google } = harness()
    const res = await handler(post(picked(FAKE_PLACES.unit.id)))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      address: {
        line1: '3450, rue Drummond',
        line2: '402',
        city: 'Montréal',
        province: 'QC',
        postal_code: 'H3G 1Y2',
        country: 'CA',
      },
    })
    assertEquals(google.calls, [{
      action: 'details',
      sessionToken: SESSION,
      placeId: FAKE_PLACES.unit.id,
      fieldMask: 'addressComponents,formattedAddress',
    }])
  })
})

Deno.test('places: at most 5 suggestions; query predictions and odd place ids are skipped', async () => {
  await run(async () => {
    const answer = {
      suggestions: [
        { queryPrediction: { text: { text: 'pizza' } } },
        { placePrediction: { placeId: 'bad id!', text: { text: 'x' } } },
        ...Array.from({ length: 7 }, (_, i) => ({
          placePrediction: {
            placeId: `ChIJfakeMany0000${i}`,
            text: { text: `${i} Rue A, Montréal` },
          },
        })),
      ],
    }
    const { handler } = harness({
      fetch: () => Promise.resolve(Response.json(answer)),
    })
    const body = await (await handler(post(typed('rue a')))).json()
    assertEquals(body.suggestions.length, MAX_SUGGESTIONS)
    // Without a structured format, the full text is the main line.
    assertEquals(body.suggestions[0], {
      place_id: 'ChIJfakeMany00000',
      main_text: '0 Rue A, Montréal',
      secondary_text: '',
    })
  })
})

Deno.test('places: invalid bodies → 400 without calling Google or the limiter', async () => {
  await run(async () => {
    const { handler, google, service } = harness()
    const bodies: unknown[] = [
      typed('ab'),
      typed('   ab   '),
      typed('x'.repeat(201)),
      typed('rue\u0000 denis'),
      { action: 'autocomplete', input: 'rue saint-denis' },
      {
        action: 'autocomplete',
        input: 'rue saint-denis',
        session: 'not a token!',
      },
      {
        action: 'autocomplete',
        input: 'rue saint-denis',
        session: 'a'.repeat(37),
      },
      { ...typed('rue saint-denis'), org_id: ORG_ID },
      picked('ChIJ/../../etc'),
      picked('short'),
      picked('x'.repeat(513)),
      { action: 'search', input: 'rue saint-denis', session: SESSION },
      'not json',
    ]
    for (const body of bodies) {
      assertEquals(
        (await errorOf(await handler(post(body)))).status,
        400,
        JSON.stringify(body),
      )
    }
    assertEquals(google.calls, [])
    assertEquals(service.calls, [])
  })
})

Deno.test('places: a body over 2 KB → 413', async () => {
  await run(async () => {
    const { handler } = harness()
    const res = await handler(
      post({ ...typed('rue saint-denis'), pad: 'x'.repeat(3_000) }),
    )
    assertEquals(res.status, 413)
  })
})

Deno.test('places: no session → 401; a profile that is not active → 403; GET → 405; OPTIONS → the allowed origin', async () => {
  await run(async () => {
    const { handler, google } = harness()
    assertEquals(
      (await errorOf(
        await handler(post(typed('rue saint-denis'), { token: null })),
      )).code,
      'unauthenticated',
    )
    const disabled = harness({
      access: { ...accessFixture([]), status: 'disabled' },
    })
    assertEquals(
      (await errorOf(await disabled.handler(post(typed('rue saint-denis')))))
        .status,
      403,
    )
    assertEquals(
      (await handler(
        new Request(URL_, {
          method: 'GET',
          headers: { Authorization: 'Bearer tok' },
        }),
      )).status,
      405,
    )
    const preflight = await handler(
      new Request(URL_, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.cliniquemana.com' },
      }),
    )
    assertEquals(
      preflight.headers.get('Access-Control-Allow-Origin'),
      'https://app.cliniquemana.com',
    )
    const foreign = await handler(
      new Request(URL_, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      }),
    )
    assertEquals(foreign.headers.get('Access-Control-Allow-Origin'), null)
    assertEquals(google.calls, [])
  })
})

Deno.test('places: any active profile may use it (a provider, no permission needed)', async () => {
  await run(async () => {
    const { handler } = harness({
      access: { ...accessFixture([]), role: 'provider' },
    })
    assertEquals((await handler(post(typed('rue laurier')))).status, 200)
  })
})

Deno.test('places: no key → 503 not_configured before the limiter or Google; reported once on a deployed project, never locally', async () => {
  await run(async () => {
    const deployed = harness({ env: { GOOGLE_PLACES_API_KEY: undefined } })
    const lines = await reports(async () => {
      for (let i = 0; i < 3; i++) {
        assertEquals(
          await errorOf(await deployed.handler(post(typed('rue saint-denis')))),
          {
            status: 503,
            code: 'not_configured',
            message: 'Address suggestions are not configured',
          },
        )
      }
    })
    assertEquals(lines.map((l) => [l.fn, l.code, l.ids]), [[
      'places',
      'places_key_missing',
      { org_id: ORG_ID },
    ]])
    assertEquals(deployed.service.calls, [])
    assertEquals(deployed.google.calls, [])

    resetPlacesReportsForTests()
    const local = harness({
      env: { GOOGLE_PLACES_API_KEY: '  ', APP_URL: 'http://localhost:5173' },
    })
    const localLines = await reports(async () => {
      assertEquals(
        (await local.handler(post(typed('rue saint-denis')))).status,
        503,
      )
    })
    assertEquals(localLines, [])
  })
})

Deno.test('places: GOOGLE_PLACES_BASE_URL is used only on a dev machine; elsewhere the key never leaves for it', async () => {
  await run(async () => {
    const google = fakePlaces()
    const seen: string[] = []
    const spy: typeof fetch = async (input, init) => {
      const req = new Request(input, init)
      seen.push(new URL(req.url).origin)
      return await google.handler(req)
    }
    const local = harness({
      fetch: spy,
      env: {
        APP_URL: 'http://localhost:5173',
        GOOGLE_PLACES_BASE_URL:
          'http://host.docker.internal:55391/ignored/path',
      },
    })
    assertEquals((await local.handler(post(typed('rue laurier')))).status, 200)
    assertEquals(seen, ['http://host.docker.internal:55391'])

    const deployed = harness({
      fetch: spy,
      env: { GOOGLE_PLACES_BASE_URL: 'https://attacker.example' },
    })
    const lines = await reports(async () => {
      assertEquals(
        (await errorOf(await deployed.handler(post(typed('rue laurier')))))
          .code,
        'not_configured',
      )
    })
    assertEquals(seen.length, 1)
    assertEquals(lines.map((l) => l.code), ['places_base_url_ignored'])
  })
})

Deno.test('places: rate limited → 429 with Retry-After, Google not called; limiter down → 503 not_configured', async () => {
  await run(async () => {
    const limited = harness({
      limit: {
        data: [{ allowed: false, hits: 601, retry_after_seconds: 120 }],
      },
    })
    const res = await limited.handler(post(typed('rue saint-denis')))
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '120')
    assertEquals(limited.google.calls, [])

    const down = harness({ limit: { error: { message: 'boom' } } })
    await captureConsole('error', async () => {
      assertEquals(
        (await errorOf(await down.handler(post(typed('rue saint-denis')))))
          .code,
        'not_configured',
      )
    })
    assertEquals(down.google.calls, [])
  })
})

Deno.test('places: Google refusing the key → 503 not_configured; its error body is never returned nor reported', async () => {
  await run(async () => {
    const { handler } = harness({ env: { GOOGLE_PLACES_API_KEY: 'wrong-key' } })
    let body = ''
    const lines = await reports(async () => {
      const res = await handler(post(typed('rue saint-denis')))
      assertEquals(res.status, 503)
      body = await res.text()
    })
    assertEquals(JSON.parse(body).error.code, 'not_configured')
    assertFalse(body.includes(FAKE_ERROR_MARKER))
    assertEquals(lines.map((l) => l.code), ['places_key_rejected'])
    assertFalse(JSON.stringify(lines).includes(FAKE_ERROR_MARKER))
  })
})

Deno.test('places: an unknown place id → 404 not_found, not reported', async () => {
  await run(async () => {
    const { handler } = harness()
    const lines = await reports(async () => {
      const res = await handler(post(picked('ChIJunknownPlace0000')))
      const text = await res.text()
      assertEquals(res.status, 404)
      assertEquals(JSON.parse(text).error.code, 'not_found')
      assertFalse(text.includes(FAKE_ERROR_MARKER))
    })
    assertEquals(lines, [])
  })
})

Deno.test('places: Google failures → 502 provider_error with our own code reported, never the typed text', async () => {
  await run(async () => {
    const cases: Array<[string, typeof fetch]> = [
      [
        'places_unreachable',
        () => Promise.reject(new TypeError('connection refused')),
      ],
      [
        'places_quota',
        () =>
          Promise.resolve(
            Response.json({ error: { message: FAKE_ERROR_MARKER } }, {
              status: 429,
            }),
          ),
      ],
      [
        'places_http_500',
        () => Promise.resolve(new Response(FAKE_ERROR_MARKER, { status: 500 })),
      ],
      [
        'places_bad_request',
        () => Promise.resolve(new Response(FAKE_ERROR_MARKER, { status: 400 })),
      ],
      [
        'places_unusable_answer',
        () => Promise.resolve(new Response('<html>', { status: 200 })),
      ],
      [
        'places_unusable_answer',
        () => Promise.resolve(Response.json({ suggestions: 'nope' })),
      ],
    ]
    for (const [code, fetchFn] of cases) {
      resetPlacesReportsForTests()
      const { handler } = harness({ fetch: fetchFn })
      let text = ''
      const lines = await reports(async () => {
        const res = await handler(post(typed('1234 rue Saint-Denis')))
        assertEquals(res.status, 502, code)
        text = await res.text()
      })
      assertEquals(JSON.parse(text).error.code, 'provider_error')
      assertFalse(text.includes(FAKE_ERROR_MARKER))
      assertEquals(lines.map((l) => [l.code, l.ids]), [[code, {
        org_id: ORG_ID,
      }]], code)
      assertFalse(JSON.stringify(lines).includes('Saint-Denis'))
    }
  })
})

Deno.test('places: a Google call slower than the timeout → 502, reported places_timeout', async () => {
  await run(async () => {
    const hang: typeof fetch = (input, init) =>
      new Promise((_resolve, reject) => {
        new Request(input, init).signal.addEventListener(
          'abort',
          () => reject(new DOMException('timed out', 'TimeoutError')),
        )
      })
    const { handler } = harness({ fetch: hang })
    const started = performance.now()
    const lines = await reports(async () => {
      assertEquals((await handler(post(typed('rue saint-denis')))).status, 502)
    })
    assert(performance.now() - started >= PLACES_TIMEOUT_MS - 50)
    assertEquals(lines.map((l) => l.code), ['places_timeout'])
  })
})

Deno.test('places: the caller leaving stops the Google call and reports nothing', async () => {
  await run(async () => {
    const controller = new AbortController()
    const called = Promise.withResolvers<void>()
    const hang: typeof fetch = (input, init) =>
      new Promise((_resolve, reject) => {
        new Request(input, init).signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
        )
        called.resolve()
      })
    const { handler } = harness({ fetch: hang })
    const lines = await reports(async () => {
      const pending = handler(
        post(typed('rue saint-denis'), { signal: controller.signal }),
      )
      // The person typed on once Google was asked (the body is read by then).
      await called.promise
      controller.abort()
      assertEquals((await pending).status, 502)
    })
    assertEquals(lines, [])
  })
})

Deno.test('places: a repeated failure is reported once per 5 minutes per code', async () => {
  await run(async () => {
    const { handler, advance } = harness({
      fetch: () => Promise.resolve(new Response('x', { status: 503 })),
    })
    const lines = await reports(async () => {
      await handler(post(typed('rue saint-denis')))
      await handler(post(typed('rue saint-denis')))
      advance(REPORT_EVERY_MS - 1)
      await handler(post(typed('rue saint-denis')))
      advance(1)
      await handler(post(typed('rue saint-denis')))
    })
    assertEquals(lines.map((l) => l.code), [
      'places_http_503',
      'places_http_503',
    ])
  })
})
