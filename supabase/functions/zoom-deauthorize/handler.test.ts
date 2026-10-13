import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  NOW,
  ORG_ID,
  SECRET,
  zoomHarness,
} from '../_shared/testing/zoom-fixtures.ts'

const WEBHOOK_SECRET = 'zoom-webhook-secret'
const run = (fn: () => Promise<void>) =>
  withEnv({ INTERNAL_FUNCTION_SECRET: SECRET, SENTRY_DSN: undefined }, fn)

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}

async function event(
  body: unknown,
  opts: { org?: string; secret?: string; at?: string; signature?: string } = {},
): Promise<Request> {
  const raw = JSON.stringify(body)
  const ts = String(Math.floor(Date.parse(opts.at ?? NOW) / 1000))
  const signature = opts.signature ??
    `v0=${await hmac(opts.secret ?? WEBHOOK_SECRET, `v0:${ts}:${raw}`)}`
  return new Request(
    `http://fn.test/functions/v1/zoom-deauthorize?org=${opts.org ?? ORG_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zm-signature': signature,
        'x-zm-request-timestamp': ts,
      },
      body: raw,
    },
  )
}

const deauthorized = {
  event: 'app_deauthorized',
  payload: { account_id: 'acc', user_id: 'fakeZoomUser01', client_id: 'x' },
}

Deno.test("zoom-deauthorize: a signed app_deauthorized ends the clinic's connection of that Zoom user", () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(await event(deauthorized))
    assertEquals([res.status, await res.json()], [200, {
      outcome: 'ended',
      count: 1,
    }])
    const call = h.service.calls.find((c) =>
      c.fn === 'zoom_deauthorized_for_service'
    )!
    assertEquals(call.args, {
      p_org_id: ORG_ID,
      p_external_user_id: 'fakeZoomUser01',
    })
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), null)
  }))

Deno.test('zoom-deauthorize: the endpoint validation is answered with the HMAC of the plain token', () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(
      await event({
        event: 'endpoint.url_validation',
        payload: { plainToken: 'plain-123' },
      }),
    )
    assertEquals(await res.json(), {
      plainToken: 'plain-123',
      encryptedToken: await hmac(WEBHOOK_SECRET, 'plain-123'),
    })
  }))

Deno.test('zoom-deauthorize: refused before any work: bad org, no signature, wrong secret, an old timestamp, no secret set', () =>
  run(async () => {
    const h = zoomHarness()
    const handler = createHandler(h.deps)
    assertEquals(
      (await handler(await event(deauthorized, { org: 'x' }))).status,
      400,
    )
    const unsigned = new Request(
      `http://fn.test/functions/v1/zoom-deauthorize?org=${ORG_ID}`,
      { method: 'POST', body: '{}' },
    )
    assertEquals((await handler(unsigned)).status, 401)
    assertEquals(
      (await handler(await event(deauthorized, { secret: 'other' }))).status,
      401,
    )
    assertEquals(
      (await handler(
        await event(deauthorized, { at: '2026-10-13T14:00:00.000Z' }),
      )).status,
      401,
    )
    assertEquals(
      h.service.calls.some((c) => c.fn === 'zoom_deauthorized_for_service'),
      false,
    )
    const none = zoomHarness({
      state: { secrets: { zoom_webhook_secret: null } },
    })
    assertEquals(
      (await createHandler(none.deps)(await event(deauthorized))).status,
      401,
    )
  }))

Deno.test('zoom-deauthorize: another event is acknowledged and skipped; GET → 405', () =>
  run(async () => {
    const h = zoomHarness()
    const handler = createHandler(h.deps)
    const res = await handler(await event({ event: 'meeting.started' }))
    assertEquals(await res.json(), { outcome: 'skipped' })
    assertEquals(
      (await handler(new Request('http://fn.test/x?org=' + ORG_ID))).status,
      405,
    )
  }))
