import { assert, assertEquals } from '@std/assert'
import { createHandler, JOB } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import { FAKE_JOIN_ORIGIN } from '../_shared/testing/fake-zoom.ts'
import {
  APPOINTMENT_ID,
  CONNECTION_ID,
  jobRequest,
  MAILPIT,
  ORG_ID,
  SECRET,
  task,
  zoomHarness,
} from '../_shared/testing/zoom-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/appointments-video-sync'
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)
const connected = () => ({
  state: 'connected' as const,
  access: 'zoom-access-initial',
  refresh: 'zoom-refresh-initial',
  expiresAt: '2026-10-13T16:00:00.000Z',
})
const completion = (h: ReturnType<typeof zoomHarness>) =>
  h.state.completions.map((c) => ({
    connection: c.p_connection_id,
    external: c.p_external_id,
    url: c.p_join_url,
    error: c.p_error_code,
  }))
const go = async (h: ReturnType<typeof zoomHarness>) => {
  const res = await createHandler(h.deps)(await jobRequest(JOB, URL_))
  assertEquals([res.status, await res.json()], [200, { runs: 1 }])
  return h.service.calls.find((c) => c.fn === 'finish_job_run')!.args
}

Deno.test('appointments-video-sync: only a signed job request runs', () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(
      new Request(URL_, { method: 'POST' }),
    )
    assertEquals(res.status, 401)
    assertEquals(h.service.calls, [])
  }))

Deno.test('appointments-video-sync: a wanted meeting is created on her account, recorded, and its link emailed once', () =>
  run(async () => {
    const h = zoomHarness({
      state: {
        connection: connected(),
        tasks: [task()],
        emailOnCreate: true,
        recipients: [{
          email: 'alice@exemple.test',
          first_name: 'Alice',
          language: 'fr',
          clinic_name: 'Clinique MANA',
          professional_name: 'Pro Un',
          starts_at: '2026-10-15T18:30:00+00:00',
          join_url: `${FAKE_JOIN_ORIGIN}/j/88000000000?pwd=fake`,
        }],
      },
    })
    const finish = await go(h)
    assertEquals(finish.p_status, 'ok')
    assert(String(finish.p_detail).startsWith('Réunions : 1 créées'))
    const meeting = h.zoom.meetings.get('88000000000')!
    assertEquals(
      [meeting.start_time, meeting.duration, meeting.timezone],
      ['2026-10-15T18:30:00Z', 50, 'America/Toronto'],
    )
    assertEquals(completion(h), [{
      connection: CONNECTION_ID,
      external: '88000000000',
      url: `${FAKE_JOIN_ORIGIN}/j/88000000000?pwd=fake`,
      error: null,
    }])
    assertEquals(
      h.mail.calls.filter((c) => `POST ${c.url}` === MAILPIT).length,
      1,
    )
    assertEquals(h.state.emailed, [
      `${FAKE_JOIN_ORIGIN}/j/88000000000?pwd=fake`,
    ])
  }))

Deno.test('appointments-video-sync: a move patches the meeting; a meeting gone at Zoom is made again', () =>
  run(async () => {
    const h = zoomHarness({ state: { connection: connected() } })
    // One meeting that exists, one that Zoom no longer has.
    h.zoom.meetings.set('77', {
      id: 77,
      owner: 'fakeZoomUser01',
      start_time: 'x',
      duration: 50,
      timezone: 'America/Toronto',
      join_url: `${FAKE_JOIN_ORIGIN}/j/77`,
      deleted: false,
    })
    h.state.tasks = [
      task({
        meeting_connection_id: CONNECTION_ID,
        meeting_connection_state: 'connected',
        meeting_external_id: '77',
        meeting_join_url: `${FAKE_JOIN_ORIGIN}/j/77`,
        starts_at: '2026-10-16T18:30:00+00:00',
        ends_at: '2026-10-16T19:20:00+00:00',
      }),
      task({
        appointment_id: '00000000-0000-4000-8000-00000000e002',
        meeting_connection_id: CONNECTION_ID,
        meeting_connection_state: 'connected',
        meeting_external_id: '66',
        meeting_join_url: `${FAKE_JOIN_ORIGIN}/j/66`,
      }),
    ]
    await go(h)
    assertEquals(h.zoom.meetings.get('77')!.start_time, '2026-10-16T18:30:00Z')
    assertEquals(completion(h).map((c) => c.external), ['77', '88000000000'])
  }))

Deno.test('appointments-video-sync: a meeting no longer wanted is deleted at Zoom; on an ended connection it is forgotten', () =>
  run(async () => {
    const h = zoomHarness({ state: { connection: connected() } })
    h.zoom.meetings.set('55', {
      id: 55,
      owner: 'fakeZoomUser01',
      start_time: 'x',
      duration: 50,
      timezone: 'UTC',
      join_url: `${FAKE_JOIN_ORIGIN}/j/55`,
      deleted: false,
    })
    h.state.tasks = [
      task({
        wants_video: false,
        target_connection_id: null,
        meeting_connection_id: CONNECTION_ID,
        meeting_connection_state: 'connected',
        meeting_external_id: '55',
        meeting_join_url: `${FAKE_JOIN_ORIGIN}/j/55`,
      }),
      task({
        appointment_id: '00000000-0000-4000-8000-00000000e003',
        wants_video: false,
        target_connection_id: null,
        meeting_connection_id: '00000000-0000-4000-8000-00000000d009',
        meeting_connection_state: 'disconnected',
        meeting_external_id: '44',
        meeting_join_url: `${FAKE_JOIN_ORIGIN}/j/44`,
      }),
    ]
    await go(h)
    assertEquals(h.zoom.meetings.get('55')!.deleted, true)
    assertEquals(completion(h), [
      { connection: null, external: null, url: null, error: null },
      { connection: null, external: null, url: null, error: null },
    ])
    assertEquals(
      h.zoom.calls.filter((c) => c.method === 'DELETE').length,
      1,
    )
  }))

Deno.test('appointments-video-sync: a meeting on a connection waiting for a reconnection is kept', () =>
  run(async () => {
    const h = zoomHarness({
      state: {
        connection: { ...connected(), state: 'needs_reconnect' },
        tasks: [task({
          target_connection_id: null,
          meeting_connection_id: CONNECTION_ID,
          meeting_connection_state: 'needs_reconnect',
          meeting_external_id: '33',
          meeting_join_url: `${FAKE_JOIN_ORIGIN}/j/33`,
        })],
      },
    })
    await go(h)
    assertEquals(h.zoom.calls, [])
    assertEquals(completion(h), [{
      connection: CONNECTION_ID,
      external: '33',
      url: `${FAKE_JOIN_ORIGIN}/j/33`,
      error: null,
    }])
  }))

Deno.test('appointments-video-sync: an access token near its end is refreshed first, both new tokens stored', () =>
  run(async () => {
    const h = zoomHarness({
      state: {
        connection: { ...connected(), expiresAt: '2026-10-13T15:02:00.000Z' },
        tasks: [task()],
      },
    })
    await go(h)
    assertEquals(h.zoom.calls.map((c) => c.path), [
      '/oauth/token',
      '/v2/users/me/meetings',
    ])
    const stored = h.service.calls.find((c) =>
      c.fn === 'set_zoom_tokens_for_service'
    )!
    assert(String(stored.args.p_refresh_token).startsWith('zoom-refresh-'))
    assert(stored.args.p_refresh_token !== 'zoom-refresh-initial')
  }))

Deno.test('appointments-video-sync: a refused grant marks the connection to reconnect; the task waits', () =>
  run(async () => {
    const h = zoomHarness({
      state: {
        connection: { ...connected(), expiresAt: '2026-10-13T15:02:00.000Z' },
        tasks: [task()],
      },
    })
    h.zoom.grants.get('zoom-refresh-initial')!.revoked = true
    const finish = await go(h)
    assertEquals(finish.p_status, 'ok')
    assertEquals(h.state.reconnects, ['invalid_grant'])
    assertEquals(completion(h)[0].error, 'needs_reconnect')
  }))

Deno.test('appointments-video-sync: a 401 is cured by one refresh; Zoom down records an attempt', () =>
  run(async () => {
    const h = zoomHarness({
      state: { connection: connected(), tasks: [task()] },
    })
    h.zoom.tokens.get('zoom-access-initial')!.revoked = true
    await go(h)
    assertEquals(h.zoom.calls.map((c) => [c.path, c.status]), [
      ['/v2/users/me/meetings', 401],
      ['/oauth/token', 200],
      ['/v2/users/me/meetings', 201],
    ])
    assertEquals(completion(h)[0].error, null)

    const down = zoomHarness({
      state: { connection: connected(), tasks: [task()] },
    })
    down.zoom.failures.push(503)
    await go(down)
    assertEquals(completion(down), [{
      connection: null,
      external: null,
      url: null,
      error: 'zoom_provider_error',
    }])
  }))

Deno.test('appointments-video-sync: due connections are refreshed even without a task', () =>
  run(async () => {
    const h = zoomHarness({
      state: { connection: connected(), refreshDue: [CONNECTION_ID] },
    })
    const finish = await go(h)
    assert(String(finish.p_detail).endsWith('connexions renouvelées : 1'))
    assertEquals(h.zoom.calls.map((c) => c.path), ['/oauth/token'])
  }))

Deno.test('appointments-video-sync: the module off → the run fails module_disabled, nothing touched', () =>
  run(async () => {
    const h = zoomHarness({ moduleEnabled: false, state: { tasks: [task()] } })
    const finish = await go(h)
    assertEquals([finish.p_status, finish.p_detail], [
      'error',
      'module_disabled',
    ])
    assertEquals(
      h.service.calls.some((c) => c.fn === 'claim_video_tasks_for_service'),
      false,
    )
    assertEquals(APPOINTMENT_ID.length, 36)
    assertEquals(ORG_ID.length, 36)
  }))
