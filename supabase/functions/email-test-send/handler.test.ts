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
import {
  accessFixture,
  ADMIN_EMAIL,
  ADMIN_ID,
  emailContextFixture,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/email-test-send'
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: 'http://localhost:5173',
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
}

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), { status })

function harness(opts: {
  access?: Record<string, unknown>
  env?: Record<string, string>
  rpc?: Record<string, RpcRoute>
  /** Per bucket, the consume_rate_limit row. */
  limits?: Record<string, { allowed: boolean; hits: number }>
  mailpit?: Responder
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: { get_my_access: { data: opts.access ?? accessFixture() } },
  })
  const service = fakeSupabase({
    rpc: {
      get_email_context: { data: emailContextFixture() },
      consume_rate_limit: (args) => {
        const limit = opts.limits?.[String(args.p_bucket)]
        return {
          data: [{
            allowed: limit?.allowed ?? true,
            hits: limit?.hits ?? 1,
            retry_after_seconds: limit?.allowed === false ? 1_800 : 0,
          }],
        }
      },
      queue_email: { data: LOG_ID },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
      ...opts.rpc,
    },
  })
  const http = fakeFetch({
    [MAILPIT]: opts.mailpit ?? json(200, { ID: 'mp-1' }),
  })
  const env = { ...ENV, ...opts.env }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: http.fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), service, http }
}

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

/** The rate-limit key secret is read from `Deno.env`; no Sentry. */
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)

const args = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.find((c) => c.fn === fn)?.args

Deno.test('email-test-send: no token → 401; the conseillère → 403; nothing sent', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    assertEquals((await handler(post({}, null))).status, 401)
    const denied = harness({ access: accessFixture(['clients.view']) })
    const error = await errorOf(
      await denied.handler(post({ template_key: 'core.staff_invite' })),
    )
    assertEquals([error.status, error.code], [403, 'forbidden'])
    assertEquals([service.calls, denied.service.calls, http.calls], [
      [],
      [],
      [],
    ])
  })
})

Deno.test('email-test-send: always to the caller own address, even with a `to` in the body', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(post({
      template_key: 'core.staff_invite',
      to: 'someone@else.test',
      org_id: 'another-org',
    }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { email_log_id: LOG_ID })

    assertEquals(args(service.calls, 'get_email_context'), {
      p_org_id: ORG_ID,
      p_template_key: 'core.staff_invite',
    })
    const queued = args(service.calls, 'queue_email')!
    assertEquals(queued.p_to_email, ADMIN_EMAIL)
    assertEquals(queued.p_to_profile_id, ADMIN_ID)
    assertEquals(queued.p_subject_type, 'email_test')
    assertEquals(queued.p_subject_id, ADMIN_ID)
    assertEquals(queued.p_sent_by, ADMIN_ID)

    assertEquals(http.calls.length, 1)
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.To, [{ Email: ADMIN_EMAIL }])
    assertEquals(sent.Subject, '[Test] Votre accès à Clinique MANA')
    assertEquals(sent.Tags, [`email_log_id-${LOG_ID}`])
    assert(!http.calls[0].body.includes('someone@else.test'))
  })
})

Deno.test('email-test-send: sends the draft when one is given', async () => {
  await run(async () => {
    const { handler, http } = harness()
    const res = await handler(post({
      template_key: 'core.staff_invite',
      subject: 'Brouillon : {{clinic.name}}',
      body: 'Bonjour {{invitee.display_name}}',
      button_label: '',
    }))
    assertEquals(res.status, 200)
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.Subject, '[Test] Brouillon : Clinique MANA')
    assert(sent.Text.includes('Bonjour Ana Gagnon'))
    assert(!sent.HTML.includes('Créer mon accès'))
  })
})

Deno.test('email-test-send: a partial draft → 400, nothing read', async () => {
  await run(async () => {
    const { handler, service } = harness()
    for (
      const body of [
        { template_key: 'core.staff_invite', subject: 'Objet seul' },
        { template_key: 'core.staff_invite', button_label: 'Bouton seul' },
        { template_key: 'core.staff_invite', subject: '', body: 'Texte' },
        { template_key: 'pas une clé' },
      ]
    ) {
      const error = await errorOf(await handler(post(body)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
    }
    assertEquals(service.calls, [])
  })
})

Deno.test('email-test-send: the 11th test in an hour → 429 with Retry-After', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      limits: { 'emails.test': { allowed: false, hits: 11 } },
    })
    const res = await handler(post({ template_key: 'core.staff_invite' }))
    assertEquals(res.headers.get('Retry-After'), '1800')
    const error = await errorOf(res)
    assertEquals([error.status, error.code], [429, 'rate_limited'])
    assertEquals(args(service.calls, 'queue_email'), undefined)
    assertEquals(http.calls, [])
  })
})

Deno.test('email-test-send: unknown placeholder in the draft → 400 missing_variable', async () => {
  await run(async () => {
    const { handler, http } = harness()
    const error = await errorOf(
      await handler(post({
        template_key: 'core.staff_invite',
        subject: 'Objet',
        body: 'Bonjour {{patient.name}}',
      })),
    )
    assertEquals([error.status, error.code], [400, 'missing_variable'])
    assertEquals(http.calls, [])
  })
})

Deno.test('email-test-send: Resend without an API key → 503 not_configured', async () => {
  await run(async () => {
    const { handler } = harness({
      env: { EMAIL_TRANSPORT: 'resend' },
      rpc: { get_org_secret: { data: null } },
    })
    await captureConsole('error', async () => {
      const error = await errorOf(
        await handler(post({ template_key: 'core.staff_invite' })),
      )
      assertEquals([error.status, error.code], [503, 'not_configured'])
    })
  })
})

Deno.test('email-test-send: a provider failure → 502 provider_error', async () => {
  await run(async () => {
    const { handler, service } = harness({ mailpit: json(500, {}) })
    await captureConsole('error', async () => {
      const error = await errorOf(
        await handler(post({ template_key: 'core.staff_invite' })),
      )
      assertEquals([error.status, error.code], [502, 'provider_error'])
    })
    assertEquals(args(service.calls, 'mark_email_failed')?.p_id, LOG_ID)
  })
})

Deno.test('email-test-send: a disabled module → 403 module_disabled', async () => {
  await run(async () => {
    const { handler } = harness({
      rpc: {
        get_email_context: {
          data: emailContextFixture({ module_enabled: false }),
        },
      },
    })
    const error = await errorOf(
      await handler(post({ template_key: 'core.staff_invite' })),
    )
    assertEquals([error.status, error.code], [403, 'module_disabled'])
  })
})

Deno.test('email-test-send: a send-path failure → its code (500), reported once', async () => {
  await run(async () => {
    const { handler } = harness({
      rpc: { get_email_context: { error: { code: 'XX000' } } },
    })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(
        await handler(post({ template_key: 'core.staff_invite' })),
      )
      assertEquals([error.status, error.code], [500, 'internal'])
    })
    assertEquals(logged.length, 1)
    assertEquals(JSON.parse(String(logged[0][0])).code, 'email_context_failed')
  })
})
