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
import { ADMIN_ID, ORG_ID } from '../_shared/testing/email-fixtures.ts'
import {
  PROFESSIONAL_EMAIL,
  PROFESSIONAL_ID,
  professionalsAccess,
  professionalsEmailContext,
  PROVIDER_ID,
} from '../_shared/testing/professionals-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-documents'
const APP = 'http://localhost:5173'
const DOC_ID = '00000000-0000-4000-8000-0000000000e1'
const OTHER_ID = '00000000-0000-4000-8000-0000000000f9'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: APP,
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
}
const REVIEW = ['professionals.documents.review']
const REASON = 'La photo est floue.'
const FIRST_NAME = 'Nadia'
const BODY = { action: 'reject', document_id: DOC_ID, reason: REASON }

const post = (body: unknown = BODY, token: string | null = 'tok') =>
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
  document_id: DOC_ID,
  profile_id: PROVIDER_ID,
  email: PROFESSIONAL_EMAIL,
  first_name: FIRST_NAME,
  clinic_name: 'Clinique MANA',
  type_name: 'Photo professionnelle',
  reason: REASON,
  uploaded_by_professional: true,
}

function harness(opts: {
  access?: Record<string, unknown>
  reject?: RpcRoute
  notice?: RpcRoute
  rpc?: Record<string, RpcRoute>
  limits?: Record<string, { allowed: boolean }>
  mailpit?: Responder | Responder[]
  env?: Record<string, string>
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: { data: opts.access ?? professionalsAccess(REVIEW) },
      reject_professional_document: opts.reject ?? { data: null },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: (args) => {
        const allowed = opts.limits?.[String(args.p_bucket)]?.allowed ?? true
        return {
          data: [{ allowed, hits: 1, retry_after_seconds: allowed ? 0 : 4 }],
        }
      },
      get_professional_document_rejection_for_service: opts.notice ??
        { data: NOTICE },
      get_email_context: (args) => ({
        data: professionalsEmailContext(String(args.p_template_key)),
      }),
      queue_email: { data: '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d01' },
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

/** No address and no name in a text. */
function assertNoPersonalData(text: string, label = '') {
  for (const secret of [PROFESSIONAL_EMAIL, FIRST_NAME, REASON]) {
    assert(!text.includes(secret), `${label}: ${secret} in ${text}`)
  }
}

Deno.test('professionals-documents: CORS, method, auth, permission and module gates; nothing done when refused', async () => {
  await run(async () => {
    const { handler, service, user } = harness()
    const preflight = await handler(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: APP } }),
    )
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), APP)
    assertEquals((await handler(new Request(URL_))).status, 405)
    assertEquals((await handler(post(BODY, null))).status, 401)
    assertEquals([service.calls, user.calls], [[], []])

    const viewer = harness({
      access: professionalsAccess(['professionals.view']),
    })
    const forbidden = await viewer.handler(post())
    assertEquals(forbidden.status, 403)
    assertEquals((await forbidden.json()).error.code, 'forbidden')
    const off = harness({
      access: professionalsAccess(REVIEW, { modules: [] }),
    })
    const disabled = await off.handler(post())
    assertEquals(disabled.status, 403)
    assertEquals((await disabled.json()).error.code, 'module_disabled')
    for (const h of [viewer, off]) {
      assertEquals(h.service.calls, [])
      assertEquals(h.user.calls.map((c) => c.fn), ['get_my_access'])
    }
  })
})

Deno.test('professionals-documents: a malformed body → 400, never echoing the input; nothing refused', async () => {
  await run(async () => {
    const cases: [string, unknown][] = [
      ['bad uuid', { ...BODY, document_id: 'pas-un-id' }],
      ['missing reason', { action: 'reject', document_id: DOC_ID }],
      ['reason not a string', { ...BODY, reason: 42 }],
      ['reason over the cap', { ...BODY, reason: 'x'.repeat(4001) }],
      ['unknown action', { ...BODY, action: 'verify' }],
      ['missing action', { document_id: DOC_ID, reason: REASON }],
      ['not an object', [BODY]],
    ]
    for (const [label, body] of cases) {
      const { handler, user, service } = harness()
      const res = await handler(post(body))
      assertEquals(res.status, 400, label)
      const text = await res.text()
      assertEquals(JSON.parse(text).error.code, 'invalid_request', label)
      assert(!text.includes('pas-un-id') && !text.includes('verify'), label)
      assertNoPersonalData(text, label)
      assertEquals(user.calls.map((c) => c.fn), ['get_my_access'], label)
      assertEquals(service.calls, [], label)
    }
  })
})

Deno.test('professionals-documents: the RPC refusals are passed on (P0001 → 400 with field, 42501 → 403, other → 500 reported); nothing emailed', async () => {
  await run(async () => {
    const refusals: [string, string][] = [
      ['Indiquez pourquoi le document est refusé.', 'reason'],
      ['Document introuvable.', 'document'],
      ['Ce document ne peut plus être refusé.', 'status'],
    ]
    for (const [message, hint] of refusals) {
      const { handler, service, http } = harness({
        reject: { error: { code: 'P0001', message, hint } },
      })
      const logged = await reports(async () => {
        const res = await handler(post())
        assertEquals(res.status, 400, hint)
        assertEquals(await res.json(), {
          error: {
            code: 'invalid_request',
            message,
            refusal: true,
            field: hint,
          },
        })
      })
      assertEquals(logged, [], hint)
      assertEquals(service.calls, [], hint)
      assertEquals(http.calls, [], hint)
    }

    const denied = harness({
      reject: { error: { code: '42501', message: 'Permission refusée' } },
    })
    const forbidden = await denied.handler(post())
    assertEquals(forbidden.status, 403)
    assertEquals((await forbidden.json()).error.code, 'forbidden')
    assertEquals(denied.service.calls, [])

    const broken = harness({ reject: { error: { code: 'XX000' } } })
    const logged = await reports(async () => {
      const res = await broken.handler(post())
      assertEquals(res.status, 500)
      assertEquals((await res.json()).error.code, 'internal')
    })
    assertEquals(logged.map((l) => [l.code, l.ids]), [[
      'reject_failed',
      { org_id: ORG_ID, document_id: DOC_ID },
    ]])
    assertEquals(broken.service.calls, [])
  })
})

Deno.test('professionals-documents: refuse as the caller, then the email to the professional; 200 { ok, emailed }', async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    // Never trusted: the actor and the clinic are the server's.
    const logged = await reports(async () => {
      const res = await handler(
        post({ ...BODY, p_actor: OTHER_ID, org_id: OTHER_ID }),
      )
      assertEquals(res.status, 200)
      const text = await res.text()
      assertEquals(JSON.parse(text), {
        ok: true,
        emailed: true,
        email_problem: null,
      })
      assertNoPersonalData(text, 'answer')
    })
    assertEquals(logged, [])

    assertEquals(user.calls.map((c) => c.fn), [
      'get_my_access',
      'reject_professional_document',
    ])
    assertEquals(calls(user.calls, 'reject_professional_document'), [
      { p_doc_id: DOC_ID, p_reason: REASON },
    ])
    assertEquals(
      calls(service.calls, 'get_professional_document_rejection_for_service'),
      [{ p_actor: ADMIN_ID, p_doc_id: DOC_ID }],
    )
    assertEquals(
      service.calls[0].fn,
      'get_professional_document_rejection_for_service',
    )

    const queued = calls(service.calls, 'queue_email')
    assertEquals(queued.length, 1)
    assertEquals(queued[0].p_template_key, 'professionals.document_rejected')
    assertEquals(queued[0].p_to_email, PROFESSIONAL_EMAIL)
    assertEquals(queued[0].p_to_profile_id, PROVIDER_ID)
    assertEquals(queued[0].p_subject_type, 'professional')
    assertEquals(queued[0].p_subject_id, PROFESSIONAL_ID)
    assertEquals(queued[0].p_sent_by, ADMIN_ID)
    assertEquals(queued[0].p_org_id, ORG_ID)

    assertEquals(http.calls.length, 1)
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.To[0].Email, PROFESSIONAL_EMAIL)
    assertEquals(sent.Subject, 'Un document est à reprendre')
    for (
      const part of [
        'Bonjour Nadia',
        'Clinique MANA',
        '«\u202FPhoto professionnelle\u202F»',
        REASON,
        `${APP}/mes-documents`,
      ]
    ) {
      assert(sent.Text.includes(part), `${part} in ${sent.Text}`)
    }
    // An explicit send: the 5 s guard per reviewer, not the 60 s address
    // limit, so a second refusal for the same professional goes out too.
    const buckets = calls(service.calls, 'consume_rate_limit').map((a) =>
      a.p_bucket
    )
    assert(buckets.includes('emails.repeat_guard'), buckets.join())
    assert(!buckets.includes('emails.same_address'), buckets.join())
  })
})

Deno.test('professionals-documents: a file staff uploaded is refused but not emailed', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      notice: { data: { ...NOTICE, uploaded_by_professional: false } },
    })
    const logged = await reports(async () => {
      const res = await handler(post())
      assertEquals([res.status, await res.json()], [200, {
        ok: true,
        emailed: false,
        email_problem: null,
      }])
    })
    assertEquals(logged, [])
    assertEquals(service.calls.map((c) => c.fn), [
      'get_professional_document_rejection_for_service',
    ])
    assertEquals(http.calls, [])
  })
})

Deno.test('professionals-documents: once refused, a notice or setup problem still answers 200, not emailed, reported with ids only', async () => {
  await run(async () => {
    const cases: [string, Parameters<typeof harness>[0], string, string][] = [
      [
        'notice RPC error',
        { notice: { error: { code: 'XX000' } } },
        'notice_failed',
        'internal',
      ],
      ['no notice', { notice: { data: null } }, 'notice_missing', 'internal'],
      [
        'another org',
        { notice: { data: { ...NOTICE, org_id: OTHER_ID } } },
        'notice_invalid',
        'internal',
      ],
      [
        'another document',
        { notice: { data: { ...NOTICE, document_id: OTHER_ID } } },
        'notice_invalid',
        'internal',
      ],
      [
        'malformed',
        { notice: { data: { ...NOTICE, uploaded_by_professional: 'oui' } } },
        'notice_invalid',
        'internal',
      ],
      [
        'APP_URL',
        { env: { APP_URL: 'http://app.example.com' } },
        'app_url_invalid',
        'server_misconfigured',
      ],
    ]
    for (const [label, opts, code, problem] of cases) {
      const { handler, http, service } = harness(opts)
      const logged = await reports(async () => {
        const res = await handler(post())
        assertEquals([res.status, await res.json()], [200, {
          ok: true,
          emailed: false,
          email_problem: problem,
        }], label)
      })
      assertEquals(logged.map((l) => l.code), [code], label)
      assertEquals(logged[0].fn, 'professionals-documents', label)
      assertEquals(logged[0].ids, {
        org_id: ORG_ID,
        document_id: DOC_ID,
        ...(code === 'app_url_invalid' && { professional_id: PROFESSIONAL_ID }),
      }, label)
      assertNoPersonalData(JSON.stringify(logged), label)
      assertEquals(calls(service.calls, 'queue_email'), [], label)
      assertEquals(http.calls, [], label)
    }
  })
})

Deno.test('professionals-documents: a blocked or failed send answers 200 with its code; no address nor name logged', async () => {
  await run(async () => {
    // The provider fails (every retry): the row is marked failed.
    const failing = harness({
      mailpit: [json(500, {}), json(500, {}), json(500, {})],
    })
    const logged = await captureConsole('error', async () => {
      const res = await failing.handler(post())
      const text = await res.text()
      assertEquals([res.status, JSON.parse(text)], [200, {
        ok: true,
        emailed: false,
        email_problem: 'provider_error',
      }])
      assertNoPersonalData(text, 'answer')
    })
    const codes = logged.map((l) => JSON.parse(String(l[0])).code)
    assert(codes.includes('rejection_email_provider_error'), codes.join())
    assertEquals(calls(failing.service.calls, 'mark_email_failed').length, 1)
    assertNoPersonalData(JSON.stringify(logged), 'reports')

    // The repeat guard refuses (a second refusal within 5 s): retry_after.
    const guarded = harness({
      limits: { 'emails.repeat_guard': { allowed: false } },
    })
    const limited = await reports(async () => {
      const res = await guarded.handler(post())
      assertEquals([res.status, await res.json()], [200, {
        ok: true,
        emailed: false,
        email_problem: 'rate_limited',
        retry_after: 4,
      }])
    })
    assertEquals(limited.map((l) => l.code), ['rejection_email_rate_limited'])
    assertEquals(guarded.http.calls, [])

    // A recipient address the send path refuses.
    const bad = harness({
      notice: { data: { ...NOTICE, email: 'pas une adresse' } },
    })
    const refused = await reports(async () => {
      const res = await bad.handler(post())
      assertEquals((await res.json()).email_problem, 'invalid_recipient')
    })
    assertEquals(refused.map((l) => l.code), [
      'rejection_email_invalid_recipient',
    ])
    assert(!JSON.stringify(refused).includes('pas une adresse'))

    // The send path's own failure (thrown, already reported there): internal.
    const broken = harness({
      rpc: { get_email_context: { error: { code: 'XX000' } } },
    })
    const thrown = await reports(async () => {
      const res = await broken.handler(post())
      assertEquals([res.status, await res.json()], [200, {
        ok: true,
        emailed: false,
        email_problem: 'internal',
      }])
    })
    assertEquals(thrown.map((l) => l.code), ['email_context_failed'])
    assertNoPersonalData(JSON.stringify(thrown), 'thrown')
  })
})
