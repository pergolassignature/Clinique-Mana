import { assert, assertEquals } from '@std/assert'
import { createHandler, syncOrg } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  calendarHarness,
  connected,
  CONNECTION_ID,
  ORG_ID,
  SECRET,
} from '../_shared/testing/google-calendar-fixtures.ts'
import { jobRequest } from '../_shared/testing/zoom-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/google-calendar-sync'
const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer tok',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)
const BUSY = { start: '2026-10-14T14:00:00Z', end: '2026-10-14T15:00:00Z' }

Deno.test('google-calendar-sync: « Synchroniser » reads her busy times and replaces them', () =>
  run(async () => {
    const h = calendarHarness({ state: { connection: connected() } })
    h.google.busy.push(BUSY)
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { outcome: 'synced' })
    assertEquals(h.state.replaced.map((r) => r.blocks), [[BUSY]])
    // A token valid for another hour is not refreshed.
    assertEquals(h.state.tokenUpdates, [])
    assert(!h.google.calls.some((c) => c.path === '/token'))
  }))

Deno.test('google-calendar-sync: a token about to expire is refreshed first and stored back', () =>
  run(async () => {
    const h = calendarHarness({
      state: {
        connection: connected({ expiresAt: '2026-10-13T15:02:00.000Z' }),
      },
    })
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(res.status, 200)
    assertEquals(h.state.tokenUpdates, ['2026-10-13T16:00:00.000Z'])
    assert(h.state.connection!.access !== 'ya29.fake-initial-access')
    assertEquals(h.state.replaced.length, 1)
  }))

Deno.test('google-calendar-sync: a revoked grant marks the connection needs_reconnect (invalid_grant)', () =>
  run(async () => {
    const h = calendarHarness({
      state: {
        connection: connected({ expiresAt: '2026-10-13T15:01:00.000Z' }),
      },
    })
    h.google.grants.get('1//fake-refresh-initial')!.revoked = true
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { outcome: 'reconnect' })
    assertEquals(h.state.reconnects, ['invalid_grant'])
    assertEquals(h.state.replaced.length, 0)
  }))

Deno.test('google-calendar-sync: a grant without the free/busy scope → needs_reconnect (scope_missing)', () =>
  run(async () => {
    const h = calendarHarness({
      state: { connection: connected({ scopes: ['openid', 'email'] }) },
    })
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(await res.json(), { outcome: 'reconnect' })
    assertEquals(h.state.reconnects, ['scope_missing'])
  }))

Deno.test('google-calendar-sync: Google down → the error code recorded, the busy times kept', () =>
  run(async () => {
    const h = calendarHarness({ state: { connection: connected() } })
    h.deps.fetch = () => Promise.resolve(new Response('', { status: 503 }))
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(await res.json(), { outcome: 'error' })
    assertEquals(h.state.errors, ['provider_error'])
    assertEquals(h.state.reconnects, [])
    assertEquals(h.state.replaced.length, 0)
  }))

Deno.test('google-calendar-sync: a connection replaced meanwhile (stale) → 404, nothing kept', () =>
  run(async () => {
    const h = calendarHarness({
      state: { connection: connected(), staleReplace: true },
    })
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(res.status, 404)
  }))

Deno.test('google-calendar-sync: nothing connected → 404, Google never asked', () =>
  run(async () => {
    const h = calendarHarness()
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(res.status, 404)
    assertEquals(h.google.calls.length, 0)
  }))

Deno.test('google-calendar-sync: without appointments.self → 403', () =>
  run(async () => {
    const h = calendarHarness({ permissions: ['appointments.view'] })
    const res = await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(res.status, 403)
  }))

Deno.test('google-calendar-sync: a busy answer never stores more than start and end', () =>
  run(async () => {
    const h = calendarHarness({ state: { connection: connected() } })
    const base = h.deps.fetch
    h.deps.fetch = (input, init) => {
      const url = new Request(input, init).url
      if (!url.includes('/calendar/v3/freeBusy')) return base(input, init)
      return Promise.resolve(Response.json({
        calendars: {
          primary: {
            busy: [{ ...BUSY, summary: 'Rendez-vous privé' }, {
              start: 'not a date',
              end: '2026-10-14T15:00:00Z',
            }],
          },
        },
      }))
    }
    await createHandler(h.deps)(post({ action: 'sync' }))
    assertEquals(h.state.replaced[0].blocks, [BUSY])
    assert(!JSON.stringify(h.service.calls).includes('Rendez-vous privé'))
  }))

Deno.test('google-calendar-sync: the job syncs each due connection of the clinic', () =>
  run(async () => {
    const h = calendarHarness({
      state: { connection: connected(), due: [CONNECTION_ID] },
    })
    h.google.busy.push(BUSY)
    const res = await createHandler(h.deps)(
      await jobRequest('appointments.google_busy_sync', URL_),
    )
    assertEquals(res.status, 200)
    assertEquals(h.state.replaced.length, 1)
    const finish = h.service.calls.find((c) => c.fn === 'finish_job_run')
    assert(finish)
  }))

Deno.test('google-calendar-sync: the job skips a clinic with Rendez-vous off or no Google application', async () => {
  const off = calendarHarness({
    moduleEnabled: false,
    state: { connection: connected(), due: [CONNECTION_ID] },
  })
  const ac = new AbortController()
  assertEquals(
    await syncOrg(off.deps)(ORG_ID, off.service.client, ac.signal),
    'module_disabled',
  )
  const bare = calendarHarness({
    state: {
      connection: connected(),
      due: [CONNECTION_ID],
      secrets: { google_oauth_client_id: null },
    },
  })
  assertEquals(
    await syncOrg(bare.deps)(ORG_ID, bare.service.client, ac.signal),
    'not_configured',
  )
  assertEquals(off.state.replaced.length + bare.state.replaced.length, 0)
})

Deno.test('google-calendar-sync: the job counts outcomes by kind (codes only)', async () => {
  const h = calendarHarness({
    state: { connection: connected(), due: [CONNECTION_ID, CONNECTION_ID] },
  })
  const ac = new AbortController()
  assertEquals(
    await syncOrg(h.deps)(ORG_ID, h.service.client, ac.signal),
    'synced=2',
  )
})
