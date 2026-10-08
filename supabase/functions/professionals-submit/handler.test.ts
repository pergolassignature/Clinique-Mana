import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch, type Responder } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'
import {
  PROFESSIONAL_ID,
  professionalsAccess,
  professionalsEmailContext,
  PROVIDER_ID,
  REVIEWER_EMAILS,
  REVIEWER_IDS,
  SUBMISSION_ID,
} from '../_shared/testing/professionals-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-submit'
const APP = 'http://localhost:5173'
const OTHER_ID = '00000000-0000-4000-8000-0000000000f9'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: APP,
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
}
const SELF = ['professionals.self']

const post = (body: unknown = {}, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: APP,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), { status })

const NOTICE = {
  org_id: ORG_ID,
  professional_id: PROFESSIONAL_ID,
  submission_id: SUBMISSION_ID,
  kind: 'onboarding',
  full_name: 'Nadia Côté',
  reviewers: REVIEWER_IDS.map((user_id, i) => ({
    user_id,
    email: REVIEWER_EMAILS[i],
  })),
}

function harness(opts: {
  access?: Record<string, unknown>
  submit?: RpcRoute
  notice?: RpcRoute
  rpc?: Record<string, RpcRoute>
  limits?: Record<string, { allowed: boolean }>
  mailpit?: Responder | Responder[]
  env?: Record<string, string>
} = {}) {
  const user = fakeSupabase({
    user: { id: PROVIDER_ID },
    rpc: {
      get_my_access: {
        data: opts.access ??
          professionalsAccess(SELF, { user_id: PROVIDER_ID, role: 'provider' }),
      },
      submit_my_submission: opts.submit ?? { data: null },
    },
  })
  let logIds = 0
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: (args) => {
        const allowed = opts.limits?.[String(args.p_bucket)]?.allowed ?? true
        return {
          data: [{ allowed, hits: 1, retry_after_seconds: allowed ? 0 : 600 }],
        }
      },
      get_professional_submission_notice_for_service: opts.notice ??
        { data: NOTICE },
      get_email_context: (args) => ({
        data: professionalsEmailContext(String(args.p_template_key)),
      }),
      queue_email: () => ({
        data: `6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d${
          String(++logIds).padStart(2, '0')
        }`,
      }),
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
      ...opts.rpc,
    },
  })
  const http = fakeFetch({ [MAILPIT]: opts.mailpit ?? json(200, { ID: 'm' }) })
  const env = { ...ENV, ...opts.env }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: http.fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service, http }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: APP,
  }, fn)

const calls = (
  list: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => list.filter((c) => c.fn === fn).map((c) => c.args)

/** Every console.error line a run writes, parsed. */
async function reports(
  fn: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const logged = await captureConsole('error', fn)
  return logged.map((l) => JSON.parse(String(l[0])))
}

Deno.test('professionals-submit: CORS, method, auth, permission and module gates; nothing done when refused', async () => {
  await run(async () => {
    const { handler, service, user } = harness()
    const preflight = await handler(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: APP } }),
    )
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), APP)
    assertEquals((await handler(new Request(URL_))).status, 405)
    assertEquals((await handler(post({}, null))).status, 401)
    assertEquals([service.calls, user.calls], [[], []])

    const staff = harness({
      access: professionalsAccess(['professionals.view']),
    })
    const forbidden = await staff.handler(post())
    assertEquals(forbidden.status, 403)
    assertEquals((await forbidden.json()).error.code, 'forbidden')
    const off = harness({ access: professionalsAccess(SELF, { modules: [] }) })
    const disabled = await off.handler(post())
    assertEquals((await disabled.json()).error.code, 'module_disabled')
    for (const h of [staff, off]) {
      assertEquals(h.service.calls, [])
      assertEquals(h.user.calls.map((c) => c.fn), ['get_my_access'])
    }

    const notObject = harness()
    assertEquals((await notObject.handler(post([1]))).status, 400)
    assertEquals(notObject.service.calls, [])
  })
})

Deno.test('professionals-submit: submit as the caller, then one email per reviewer, in parallel; 200 { ok } only', async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    // Never trusted: the actor and the submission are the server's.
    const res = await handler(
      post({ submission_id: OTHER_ID, p_actor: OTHER_ID, org_id: OTHER_ID }),
    )
    assertEquals(res.status, 200)
    const text = await res.text()
    assertEquals(JSON.parse(text), { ok: true })
    for (const email of REVIEWER_EMAILS) assert(!text.includes(email))

    assertEquals(user.calls.map((c) => c.fn), [
      'get_my_access',
      'submit_my_submission',
    ])
    assertEquals(calls(user.calls, 'submit_my_submission'), [{}])
    assertEquals(
      calls(service.calls, 'get_professional_submission_notice_for_service'),
      [{ p_actor: PROVIDER_ID }],
    )
    // The limit first, before the submission.
    assertEquals(service.calls[0].args.p_bucket, 'professionals.submit_user')

    const queued = calls(service.calls, 'queue_email')
    assertEquals(
      queued.map((q) => [q.p_to_email, q.p_to_profile_id]).sort(),
      REVIEWER_EMAILS.map((e, i) => [e, REVIEWER_IDS[i]]),
    )
    for (const q of queued) {
      assertEquals(q.p_template_key, 'professionals.submission_received')
      assertEquals(q.p_subject_type, 'professional')
      assertEquals(q.p_subject_id, PROFESSIONAL_ID)
      assertEquals(q.p_sent_by, PROVIDER_ID)
    }
    assertEquals(http.calls.length, 2)
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.Subject, 'Nadia Côté a envoyé son profil')
    assert(
      sent.Text.includes(`${APP}/professionnels/${PROFESSIONAL_ID}/documents`),
    )
    // An explicit send: the 5 s guard per reviewer, not the 60 s address limit.
    const buckets = calls(service.calls, 'consume_rate_limit').map((a) =>
      a.p_bucket
    )
    assert(buckets.includes('emails.repeat_guard'))
    assert(!buckets.includes('emails.same_address'))
  })
})

Deno.test('professionals-submit: a refusal → 400 with message, field and sections; nothing emailed', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      submit: {
        error: {
          code: 'P0001',
          message: 'Certaines sections sont incomplètes.',
          hint: 'sections',
          details: 'personal,consent',
        },
      },
    })
    const res = await handler(post())
    assertEquals(res.status, 400)
    assertEquals(await res.json(), {
      error: {
        code: 'invalid_request',
        message: 'Certaines sections sont incomplètes.',
        refusal: true,
        field: 'sections',
        sections: ['personal', 'consent'],
      },
    })
    assertEquals(
      calls(service.calls, 'get_professional_submission_notice_for_service'),
      [],
    )
    assertEquals(http.calls, [])

    // An inactive file (4b.1, P4-303): the provider's wording, nothing emailed.
    const inactiveMessage =
      'Votre dossier est inactif : communiquez avec la clinique pour le réactiver.'
    const inactive = harness({
      submit: {
        error: { code: 'P0001', message: inactiveMessage, hint: 'status' },
      },
    })
    const closed = await inactive.handler(post())
    assertEquals(closed.status, 400)
    assertEquals(await closed.json(), {
      error: {
        code: 'invalid_request',
        message: inactiveMessage,
        refusal: true,
        field: 'status',
      },
    })
    assertEquals(
      calls(
        inactive.service.calls,
        'get_professional_submission_notice_for_service',
      ),
      [],
    )
    assertEquals(inactive.http.calls, [])

    const denied = harness({
      submit: { error: { code: '42501', message: 'Permission refusée' } },
    })
    assertEquals((await denied.handler(post())).status, 403)

    const broken = harness({ submit: { error: { code: 'XX000' } } })
    const logged = await reports(async () => {
      const error = await broken.handler(post())
      assertEquals(error.status, 500)
    })
    assertEquals(logged.map((l) => l.code), ['submit_failed'])
  })
})

Deno.test("professionals-submit: the caller's limit → 429 before the submission", async () => {
  await run(async () => {
    const { handler, user } = harness({
      limits: { 'professionals.submit_user': { allowed: false } },
    })
    const res = await handler(post())
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '600')
    assertEquals(user.calls.map((c) => c.fn), ['get_my_access'])
  })
})

Deno.test('professionals-submit: once submitted, an email problem still answers 200, reported with ids only', async () => {
  await run(async () => {
    const cases: [string, Parameters<typeof harness>[0], string[]][] = [
      ['notice RPC error', { notice: { error: { code: 'XX000' } } }, [
        'notice_failed',
      ]],
      ['no submitted submission', { notice: { data: null } }, [
        'notice_missing',
      ]],
      ['another org', { notice: { data: { ...NOTICE, org_id: OTHER_ID } } }, [
        'notice_invalid',
      ]],
      ['no reviewer', { notice: { data: { ...NOTICE, reviewers: [] } } }, [
        'no_reviewer',
      ]],
      ['APP_URL', { env: { APP_URL: 'http://app.example.com' } }, [
        'app_url_invalid',
      ]],
    ]
    for (const [label, opts, codes] of cases) {
      const { handler, http } = harness(opts)
      const logged = await reports(async () => {
        const res = await handler(post())
        assertEquals([res.status, await res.json()], [200, { ok: true }], label)
      })
      assertEquals(logged.map((l) => l.code), codes, label)
      assertEquals(http.calls, [], label)
    }

    // One reviewer's provider failure: the other is still sent; one report per kind.
    const partial = harness({
      mailpit: [
        json(200, { ID: 'm' }),
        json(500, {}),
        json(500, {}),
        json(500, {}),
      ],
    })
    const logged = await reports(async () => {
      const res = await partial.handler(post())
      assertEquals(res.status, 200)
    })
    const codes = logged.map((l) => l.code)
    assert(codes.includes('reviewer_email_provider_error'), codes.join())
    assertEquals(
      codes.filter((c) => c === 'reviewer_email_provider_error').length,
      1,
    )
    const text = JSON.stringify(logged)
    for (const email of REVIEWER_EMAILS) assert(!text.includes(email))
    const mine = logged.find((l) => l.code === 'reviewer_email_provider_error')!
    assertEquals(mine.ids, {
      org_id: ORG_ID,
      professional_id: PROFESSIONAL_ID,
      submission_id: SUBMISSION_ID,
    })
  })
})
