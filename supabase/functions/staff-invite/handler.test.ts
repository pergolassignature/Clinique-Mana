import { assert, assertEquals, assertMatch } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { hashToken } from '../_shared/links.ts'
import { fakeFetch, type Responder } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ADMIN_NAME,
  emailContextFixture,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'
import {
  INVITATION_ID,
  INVITEE_EMAIL,
} from '../_shared/testing/link-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/staff-invite'
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const OTHER_ID = '00000000-0000-4000-8000-0000000000f9'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: 'http://localhost:5173',
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
}
const MANAGE = ['users.manage', 'users.view']

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const INVITE = {
  email: '  Nouvelle@Mana.test ',
  display_name: ' Nouvelle Personne ',
  role: 'counselor',
}

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), { status })

function harness(opts: {
  permissions?: string[]
  rpc?: Record<string, RpcRoute>
  /** Per bucket, the consume_rate_limit answer. */
  limits?: Record<string, { allowed: boolean }>
  mailpit?: Responder
  env?: Record<string, string>
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: { data: accessFixture(opts.permissions ?? MANAGE) },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: (args) => {
        const allowed = opts.limits?.[String(args.p_bucket)]?.allowed ?? true
        return {
          data: [{
            allowed,
            hits: 1,
            retry_after_seconds: allowed ? 0 : 900,
          }],
        }
      },
      create_staff_invitation: {
        data: [{ id: INVITATION_ID, expires_at: '2026-10-15T15:00:00+00:00' }],
      },
      renew_staff_invitation: {
        data: [{
          email: INVITEE_EMAIL,
          display_name: 'Nouvelle Personne',
          expires_at: '2026-10-15T15:00:00+00:00',
        }],
      },
      get_email_context: { data: emailContextFixture() },
      queue_email: { data: LOG_ID },
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
    ALLOWED_ORIGINS: undefined,
  }, fn)

const args = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.find((c) => c.fn === fn)?.args

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

/** The token in the emailed link (HTML and text parts agree). */
function emailedToken(body: string): string {
  const sent = JSON.parse(body)
  const match = /\/invitation#t=([A-Za-z0-9_-]{43})/.exec(sent.Text)
  assert(match, 'no link in the email')
  assert(sent.HTML.includes(`#t=${match[1]}`))
  return match[1]
}

Deno.test('staff-invite: no users.manage (the conseillère) → 403; no token → 401; nothing done', async () => {
  await run(async () => {
    const denied = harness({ permissions: ['clients.view'] })
    const error = await errorOf(await denied.handler(post(INVITE)))
    assertEquals([error.status, error.code], [403, 'forbidden'])
    assertEquals((await denied.handler(post(INVITE, null))).status, 401)
    assertEquals([denied.service.calls, denied.http.calls], [[], []])
  })
})

Deno.test('staff-invite: invite → service create with the verified actor, emailed link, 200 { invitation_id, expires_at } only', async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    const res = await handler(post({
      ...INVITE,
      // Never trusted: the actor is the verified caller.
      p_actor: OTHER_ID,
      actor: OTHER_ID,
      invited_by: OTHER_ID,
      org_id: OTHER_ID,
    }))
    assertEquals(res.status, 200)
    const text = await res.text()
    assertEquals(JSON.parse(text), {
      invitation_id: INVITATION_ID,
      expires_at: '2026-10-15T15:00:00+00:00',
    })

    const created = args(service.calls, 'create_staff_invitation')!
    assertEquals(created.p_actor, ADMIN_ID)
    assertEquals(created.p_email, INVITEE_EMAIL)
    assertEquals(created.p_display_name, 'Nouvelle Personne')
    assertEquals(created.p_role, 'counselor')
    assertMatch(String(created.p_token_hash), /^\\x[0-9a-f]{64}$/)
    // Only verifyAuth's RPC on the caller's client.
    assertEquals(user.calls.map((c) => c.fn), ['get_my_access'])

    // The emailed token hashes to the stored hash, and is not in the answer.
    assertEquals(http.calls.length, 1)
    const token = emailedToken(http.calls[0].body)
    assertEquals(await hashToken(token), created.p_token_hash)
    assert(!text.includes(token))
    // The expiry comes from create: no peek.
    assertEquals(args(service.calls, 'peek_secure_link'), undefined)

    const queued = args(service.calls, 'queue_email')!
    assertEquals(queued.p_to_email, INVITEE_EMAIL)
    assertEquals(queued.p_to_profile_id, null)
    assertEquals(queued.p_subject_type, 'staff_invitation')
    assertEquals(queued.p_subject_id, INVITATION_ID)
    assertEquals(queued.p_sent_by, ADMIN_ID)
    assertEquals(args(service.calls, 'get_email_context'), {
      p_org_id: ORG_ID,
      p_template_key: 'core.staff_invite',
    })

    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.To, [{ Email: INVITEE_EMAIL }])
    assert(sent.Text.includes('Bonjour Nouvelle Personne'))
    assert(sent.Text.includes(`${ADMIN_NAME} vous invite`))
    // 15:00 UTC is 11 h 00 in Toronto (EDT).
    assert(sent.Text.includes('15 octobre 2026'))
    assertEquals(sent.Subject, 'Votre accès à Clinique MANA (local)')
  })
})

Deno.test('staff-invite: each call has a new token', async () => {
  await run(async () => {
    const { handler, service } = harness()
    await handler(post(INVITE))
    await handler(post(INVITE))
    const hashes = service.calls
      .filter((c) => c.fn === 'create_staff_invitation')
      .map((c) => c.args.p_token_hash)
    assertEquals(new Set(hashes).size, 2)
  })
})

Deno.test('staff-invite: « Renvoyer » → service renew with the verified actor, explicitResend', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(post({
      invitation_id: INVITATION_ID,
      p_actor: OTHER_ID,
    }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      invitation_id: INVITATION_ID,
      expires_at: '2026-10-15T15:00:00+00:00',
    })
    const renewed = args(service.calls, 'renew_staff_invitation')!
    assertEquals(renewed.p_actor, ADMIN_ID)
    assertEquals(renewed.p_id, INVITATION_ID)
    assertEquals(
      await hashToken(emailedToken(http.calls[0].body)),
      renewed.p_token_hash,
    )
    // The expiry comes from renew: no peek.
    assertEquals(args(service.calls, 'peek_secure_link'), undefined)
    assertEquals(args(service.calls, 'create_staff_invitation'), undefined)
    // explicitResend: the 5 s guard instead of the 60 s same-address limit.
    const buckets = service.calls
      .filter((c) => c.fn === 'consume_rate_limit')
      .map((c) => c.args.p_bucket)
    assert(buckets.includes('emails.repeat_guard'))
    assert(!buckets.includes('emails.same_address'))
  })
})

Deno.test('staff-invite: a P0001 from the RPC → 400 with its message; 42501 → 403; nothing sent', async () => {
  await run(async () => {
    const message =
      'Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».'
    const p0001 = harness({
      rpc: { create_staff_invitation: { error: { code: 'P0001', message } } },
    })
    const error = await errorOf(await p0001.handler(post(INVITE)))
    assertEquals([error.status, error.code, error.message], [
      400,
      'invalid_request',
      message,
    ])
    assertEquals(p0001.http.calls, [])

    const denied = harness({
      rpc: {
        renew_staff_invitation: {
          error: { code: '42501', message: 'Permission refusée' },
        },
      },
    })
    const forbidden = await errorOf(
      await denied.handler(post({ invitation_id: INVITATION_ID })),
    )
    assertEquals([forbidden.status, forbidden.code], [403, 'forbidden'])
    assertEquals(denied.http.calls, [])
  })
})

Deno.test('staff-invite: another RPC error → 500, reported; nothing sent', async () => {
  await run(async () => {
    const { handler, http } = harness({
      rpc: { create_staff_invitation: { error: { code: 'XX000' } } },
    })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(await handler(post(INVITE)))
      assertEquals([error.status, error.code], [500, 'internal'])
    })
    assertEquals(JSON.parse(String(logged.at(-1)?.[0])).code, 'invite_failed')
    assertEquals(http.calls, [])
  })
})

Deno.test('staff-invite: the per-caller limit → 429 before any token or RPC', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      limits: { 'invites.staff_user': { allowed: false } },
    })
    const res = await handler(post(INVITE))
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '900')
    assertEquals(service.calls.map((c) => c.fn), ['consume_rate_limit'])
    assertEquals(service.calls[0].args.p_bucket, 'invites.staff_user')
    assertEquals(http.calls, [])
  })
})

Deno.test('staff-invite: an invalid body → 400 naming the refused field, nothing done', async () => {
  await run(async () => {
    for (
      const [body, field] of [
        [{}, 'email'],
        [{ ...INVITE, email: 'pas une adresse' }, 'email'],
        [{ ...INVITE, email: 'a@b.ca, c@d.ca' }, 'email'],
        [{ ...INVITE, display_name: '   ' }, 'display_name'],
        [{ ...INVITE, display_name: 'x'.repeat(81) }, 'display_name'],
        [{ ...INVITE, role: '' }, 'role'],
        [{ invitation_id: 'not-a-uuid' }, undefined],
        [[INVITE], undefined],
        [null, undefined],
      ] as const
    ) {
      const { handler, service } = harness()
      const error = await errorOf(await handler(post(body)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
      assertEquals(error.field, field, JSON.stringify(body).slice(0, 40))
      assertEquals(service.calls, [])
    }
  })
})

Deno.test('staff-invite: a refused recipient keeps the invitation id: 400 with field email', async () => {
  await run(async () => {
    const { handler, http } = harness({
      rpc: {
        renew_staff_invitation: {
          data: [{
            email: 'pas une adresse',
            display_name: 'Nouvelle Personne',
            expires_at: '2026-10-15T15:00:00+00:00',
          }],
        },
      },
    })
    const res = await handler(post({ invitation_id: INVITATION_ID }))
    assertEquals(res.status, 400)
    assertEquals(await res.json(), {
      error: {
        code: 'invalid_request',
        message: 'Invitation created, email not sent',
        field: 'email',
      },
      invitation_id: INVITATION_ID,
    })
    assertEquals(http.calls, [])
  })
})

Deno.test('staff-invite: an APP_URL that links cannot use → 500 before anything is created', async () => {
  await run(async () => {
    const { handler, service } = harness({
      env: { APP_URL: 'http://app.example.com' },
    })
    await captureConsole('error', async () => {
      const error = await errorOf(await handler(post(INVITE)))
      assertEquals([error.status, error.code], [500, 'server_misconfigured'])
    })
    assertEquals(args(service.calls, 'create_staff_invitation'), undefined)
  })
})

Deno.test('staff-invite: an email failure keeps the invitation id: 502 provider_error, 503 not_configured, 429', async () => {
  await run(async () => {
    const provider = harness({ mailpit: json(500, {}) })
    await captureConsole('error', async () => {
      const res = await provider.handler(post(INVITE))
      assertEquals(res.status, 502)
      assertEquals(await res.json(), {
        error: {
          code: 'provider_error',
          message: 'Invitation created, email not sent',
        },
        invitation_id: INVITATION_ID,
      })
    })

    const unconfigured = harness({ env: { EMAIL_TRANSPORT: 'carrier-pigeon' } })
    await captureConsole('error', async () => {
      const res = await unconfigured.handler(post(INVITE))
      // APP_URL is fine, the transport is not: the invitation exists.
      assertEquals(res.status, 503)
      const body = await res.json()
      assertEquals(body.error.code, 'not_configured')
      assertEquals(body.invitation_id, INVITATION_ID)
    })

    const limited = harness({
      limits: { 'emails.repeat_guard': { allowed: false } },
    })
    const res = await limited.handler(post({ invitation_id: INVITATION_ID }))
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '900')
    assertEquals((await res.json()).invitation_id, INVITATION_ID)
  })
})

Deno.test('staff-invite: create answers another shape → 500, reported create_invalid; nothing sent', async () => {
  await run(async () => {
    for (const data of [INVITATION_ID, [], [{ id: INVITATION_ID }]]) {
      const { handler, http } = harness({
        rpc: { create_staff_invitation: { data } },
      })
      const logged = await captureConsole('error', async () => {
        const error = await errorOf(await handler(post(INVITE)))
        assertEquals([error.status, error.code], [500, 'internal'])
      })
      assertEquals(
        JSON.parse(String(logged.at(-1)?.[0])).code,
        'create_invalid',
      )
      assertEquals(http.calls, [])
    }
  })
})
