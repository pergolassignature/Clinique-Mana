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
import { ADMIN_ID, ORG_ID } from '../_shared/testing/email-fixtures.ts'
import { LINK_ID } from '../_shared/testing/link-fixtures.ts'
import {
  PROFESSIONAL_EMAIL,
  PROFESSIONAL_ID,
  professionalsAccess,
  professionalsEmailContext,
  SUBMISSION_ID,
} from '../_shared/testing/professionals-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-invite'
const APP = 'http://localhost:5173'
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const OTHER_ID = '00000000-0000-4000-8000-0000000000f9'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: APP,
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
}
const INVITE = ['professionals.view', 'professionals.invite']
const EXPIRES = '2026-10-15T15:00:00+00:00'

const post = (body: unknown, token: string | null = 'tok') =>
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

function harness(opts: {
  access?: Record<string, unknown>
  rpc?: Record<string, RpcRoute>
  userRpc?: Record<string, RpcRoute>
  /** Per bucket, the consume_rate_limit answer. */
  limits?: Record<string, { allowed: boolean }>
  mailpit?: Responder
  env?: Record<string, string>
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: { data: opts.access ?? professionalsAccess(INVITE) },
      revoke_professional_invitation: { data: null },
      request_professional_update: {
        data: {
          submission_id: SUBMISSION_ID,
          email: PROFESSIONAL_EMAIL,
          first_name: 'Nadia',
        },
      },
      ...opts.userRpc,
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
      create_professional_invitation: {
        data: {
          link_id: LINK_ID,
          submission_id: SUBMISSION_ID,
          email: PROFESSIONAL_EMAIL,
          first_name: 'Nadia',
          expires_at: EXPIRES,
        },
      },
      get_email_context: (args) => ({
        data: professionalsEmailContext(String(args.p_template_key)),
      }),
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
    ALLOWED_ORIGINS: APP,
  }, fn)

const args = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.find((c) => c.fn === fn)?.args

const buckets = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.fn === 'consume_rate_limit').map((c) => c.args.p_bucket)

async function errorOf(res: Response) {
  const body = await res.json()
  return { status: res.status, ...body.error, body }
}

/** The token in the emailed link (HTML and text parts agree). */
function emailedToken(body: string): string {
  const sent = JSON.parse(body)
  const match = /\/invitation#t=([A-Za-z0-9_-]{43})/.exec(sent.Text)
  assert(match, 'no link in the email')
  assert(sent.HTML.includes(`#t=${match[1]}`))
  return match[1]
}

const send = (over: Record<string, unknown> = {}, token?: string | null) =>
  post({ action: 'send', professional_id: PROFESSIONAL_ID, ...over }, token)

Deno.test('professionals-invite: CORS preflight, GET → 405, no token → 401 without any service call', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const preflight = await handler(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: APP } }),
    )
    assertEquals(preflight.status, 200)
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), APP)
    assertEquals(preflight.headers.get('Access-Control-Max-Age'), '600')
    const other = await handler(
      new Request(URL_, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.test' },
      }),
    )
    assertEquals(other.headers.get('Access-Control-Allow-Origin'), null)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    const anonymous = await handler(send({}, null))
    assertEquals(anonymous.status, 401)
    assertEquals(anonymous.headers.get('Access-Control-Allow-Origin'), APP)
    assertEquals(service.calls, [])
  })
})

Deno.test('professionals-invite: without professionals.invite (the conseillère) → 403; module off → 403 module_disabled; nothing done', async () => {
  await run(async () => {
    const denied = harness({
      access: professionalsAccess(['professionals.view']),
    })
    const error = await errorOf(await denied.handler(send()))
    assertEquals([error.status, error.code], [403, 'forbidden'])
    const off = harness({
      access: professionalsAccess(INVITE, { modules: [] }),
    })
    const disabled = await errorOf(await off.handler(send()))
    assertEquals([disabled.status, disabled.code], [403, 'module_disabled'])
    for (const h of [denied, off]) {
      assertEquals([h.service.calls, h.http.calls], [[], []])
      assertEquals(h.user.calls.map((c) => c.fn), ['get_my_access'])
    }
  })
})

Deno.test('professionals-invite: send → service create with the verified actor, emailed link, 200 { ok, expires_at } only', async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    const res = await handler(send({
      // Never trusted: the actor, the org and the address are the server's.
      p_actor: OTHER_ID,
      actor: OTHER_ID,
      org_id: OTHER_ID,
      email: 'attaquant@exemple.test',
    }))
    assertEquals(res.status, 200)
    const text = await res.text()
    assertEquals(JSON.parse(text), { ok: true, expires_at: EXPIRES })

    const created = args(service.calls, 'create_professional_invitation')!
    assertEquals(created.p_actor, ADMIN_ID)
    assertEquals(created.p_id, PROFESSIONAL_ID)
    assertMatch(String(created.p_token_hash), /^\\x[0-9a-f]{64}$/)
    assertEquals(Object.keys(created).sort(), [
      'p_actor',
      'p_id',
      'p_token_hash',
    ])
    // Only verifyAuth's RPC on the caller's client.
    assertEquals(user.calls.map((c) => c.fn), ['get_my_access'])

    // The emailed token hashes to the stored hash; it is not in the answer.
    assertEquals(http.calls.length, 1)
    const token = emailedToken(http.calls[0].body)
    assertEquals(await hashToken(token), created.p_token_hash)
    assert(!text.includes(token) && !text.includes('#t='))

    assertEquals(args(service.calls, 'get_email_context'), {
      p_org_id: ORG_ID,
      p_template_key: 'professionals.invite',
    })
    const queued = args(service.calls, 'queue_email')!
    assertEquals(queued.p_to_email, PROFESSIONAL_EMAIL)
    assertEquals(queued.p_subject_type, 'professional')
    assertEquals(queued.p_subject_id, PROFESSIONAL_ID)
    assertEquals(queued.p_sent_by, ADMIN_ID)
    assertEquals(queued.p_view_permission, 'professionals.view')
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.To, [{ Email: PROFESSIONAL_EMAIL }])
    assertEquals(
      sent.Subject,
      'Bienvenue dans l’équipe de Clinique MANA (local)',
    )
    assert(sent.Text.includes('Bonjour Nadia'))
    assert(sent.Text.includes('15 octobre 2026'))
    assert(sent.Text.includes(`${APP}/invitation#t=`))
    // Every invitation email is explicit (P4-425): the double-click guard,
    // never the 60 s same-address limit (« Révoquer » then « Envoyer »).
    assert(!buckets(service.calls).includes('emails.same_address'))
    // The file's guard, then the caller's limit, before the link is issued.
    assertEquals(buckets(service.calls).slice(0, 2), [
      'professionals.invite_file',
      'professionals.invite_user',
    ])
    assert(
      service.calls.findIndex((c) =>
        c.fn === 'create_professional_invitation'
      ) > 1,
    )
  })
})

Deno.test('professionals-invite: resend and new_link → a new token each, explicit re-send, no link in the answer', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    for (const action of ['resend', 'new_link']) {
      const res = await handler(
        post({ action, professional_id: PROFESSIONAL_ID }),
      )
      assertEquals(res.status, 200)
      assertEquals(await res.json(), { ok: true, expires_at: EXPIRES })
    }
    const hashes = service.calls
      .filter((c) => c.fn === 'create_professional_invitation')
      .map((c) => c.args.p_token_hash)
    assertEquals(new Set(hashes).size, 2)
    assertEquals(
      await Promise.all(http.calls.map((c) => hashToken(emailedToken(c.body)))),
      hashes,
    )
    assert(buckets(service.calls).includes('emails.repeat_guard'))
    assert(!buckets(service.calls).includes('emails.same_address'))
  })
})

Deno.test("professionals-invite: revoke → the caller's RPC, no limit, no email, 200 { ok }", async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    const res = await handler(
      post({ action: 'revoke', professional_id: PROFESSIONAL_ID }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { ok: true })
    assertEquals(args(user.calls, 'revoke_professional_invitation'), {
      p_id: PROFESSIONAL_ID,
    })
    assertEquals([service.calls, http.calls], [[], []])

    const none = harness({
      userRpc: {
        revoke_professional_invitation: {
          error: {
            code: 'P0001',
            message: 'Aucune invitation en cours.',
            hint: 'invitation',
          },
        },
      },
    })
    const error = await errorOf(
      await none.handler(
        post({ action: 'revoke', professional_id: PROFESSIONAL_ID }),
      ),
    )
    assertEquals(
      [error.status, error.code, error.message, error.refusal, error.field],
      [
        400,
        'invalid_request',
        'Aucune invitation en cours.',
        true,
        'invitation',
      ],
    )
  })
})

Deno.test("professionals-invite: request_update → the caller's RPC with the sections, token-free questionnaire link, 200 { ok, submission_id }", async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    const res = await handler(post({
      action: 'request_update',
      professional_id: PROFESSIONAL_ID,
      sections: ['portrait', 'motifs'],
    }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { ok: true, submission_id: SUBMISSION_ID })
    assertEquals(args(user.calls, 'request_professional_update'), {
      p_id: PROFESSIONAL_ID,
      p_sections: ['portrait', 'motifs'],
    })
    assertEquals(
      args(service.calls, 'create_professional_invitation'),
      undefined,
    )
    assertEquals(
      args(service.calls, 'get_email_context')?.p_template_key,
      'professionals.profile_update',
    )
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.To, [{ Email: PROFESSIONAL_EMAIL }])
    assert(sent.Text.includes(`${APP}/mon-profil/questionnaire`))
    assert(!sent.Text.includes('#t='))
    assertEquals(
      args(service.calls, 'queue_email')?.p_subject_id,
      PROFESSIONAL_ID,
    )
  })
})

Deno.test('professionals-invite: an invalid body → 400, nothing done', async () => {
  await run(async () => {
    for (
      const body of [
        {},
        { action: 'send' },
        { action: 'send', professional_id: 'not-a-uuid' },
        { action: 'invite', professional_id: PROFESSIONAL_ID },
        { action: 'send', professional_id: PROFESSIONAL_ID, sections: ['bio'] },
        { action: 'request_update', professional_id: PROFESSIONAL_ID },
        {
          action: 'request_update',
          professional_id: PROFESSIONAL_ID,
          sections: [],
        },
        {
          action: 'request_update',
          professional_id: PROFESSIONAL_ID,
          sections: ['Portrait; drop'],
        },
        [{ action: 'send', professional_id: PROFESSIONAL_ID }],
        null,
      ]
    ) {
      const { handler, service, user } = harness()
      const error = await errorOf(await handler(post(body)))
      assertEquals(
        [error.status, error.code],
        [400, 'invalid_request'],
        JSON.stringify(body),
      )
      assertEquals(service.calls, [])
      assertEquals(user.calls.map((c) => c.fn), ['get_my_access'])
    }
  })
})

Deno.test('professionals-invite: refusals of the RPCs → 400 with message and field; 42501 → 403; nothing sent', async () => {
  await run(async () => {
    const message = 'Ce professionnel a déjà un compte.'
    const p0001 = harness({
      rpc: {
        create_professional_invitation: {
          error: { code: 'P0001', message, hint: 'account' },
        },
      },
    })
    const error = await errorOf(await p0001.handler(send()))
    assertEquals(error.body, {
      error: {
        code: 'invalid_request',
        message,
        refusal: true,
        field: 'account',
      },
    })
    assertEquals(p0001.http.calls, [])

    const denied = harness({
      rpc: {
        create_professional_invitation: {
          error: { code: '42501', message: 'Permission refusée' },
        },
      },
    })
    const forbidden = await errorOf(await denied.handler(send()))
    assertEquals([forbidden.status, forbidden.code], [403, 'forbidden'])

    const busy = harness({
      userRpc: {
        request_professional_update: {
          error: {
            code: 'P0001',
            message: 'Une soumission est déjà en cours.',
            hint: 'submission',
          },
        },
      },
    })
    const refused = await errorOf(
      await busy.handler(post({
        action: 'request_update',
        professional_id: PROFESSIONAL_ID,
        sections: ['portrait'],
      })),
    )
    assertEquals([refused.status, refused.field], [400, 'submission'])

    // An inactive file (4b.1, P4-303: private.lock_active_professional).
    const inactiveMessage = "Ce dossier est inactif : réactivez-le d'abord."
    const inactive = harness({
      userRpc: {
        request_professional_update: {
          error: { code: 'P0001', message: inactiveMessage, hint: 'status' },
        },
      },
    })
    const closed = await errorOf(
      await inactive.handler(post({
        action: 'request_update',
        professional_id: PROFESSIONAL_ID,
        sections: ['portrait'],
      })),
    )
    assertEquals(closed.body, {
      error: {
        code: 'invalid_request',
        message: inactiveMessage,
        refusal: true,
        field: 'status',
      },
    })
    for (const h of [denied, busy, inactive]) assertEquals(h.http.calls, [])
  })
})

Deno.test('professionals-invite: another RPC error or answer → 500, reported with ids only; nothing sent', async () => {
  await run(async () => {
    for (
      const [route, code] of [
        [
          { error: { code: 'XX000', message: 'boom p1@x.test' } },
          'invite_failed',
        ],
        [{ data: { email: PROFESSIONAL_EMAIL } }, 'invite_invalid'],
      ] as const
    ) {
      const { handler, http } = harness({
        rpc: { create_professional_invitation: route },
      })
      const logged = await captureConsole('error', async () => {
        const error = await errorOf(await handler(send()))
        assertEquals([error.status, error.code], [500, 'internal'])
      })
      const line = JSON.parse(String(logged.at(-1)?.[0]))
      assertEquals(line.code, code)
      assertEquals(line.ids, {
        org_id: ORG_ID,
        professional_id: PROFESSIONAL_ID,
      })
      assertEquals(http.calls, [])
    }
  })
})

Deno.test('professionals-invite: the per-caller limit → 429 before any token or RPC', async () => {
  await run(async () => {
    const { handler, service, user, http } = harness({
      limits: { 'professionals.invite_user': { allowed: false } },
    })
    for (
      const body of [
        { action: 'send', professional_id: PROFESSIONAL_ID },
        {
          action: 'request_update',
          professional_id: PROFESSIONAL_ID,
          sections: ['portrait'],
        },
      ]
    ) {
      const res = await handler(post(body))
      assertEquals(res.status, 429)
      assertEquals(res.headers.get('Retry-After'), '900')
    }
    // send: the file's guard, then the caller's limit; request_update: the
    // caller's limit only.
    assertEquals(buckets(service.calls), [
      'professionals.invite_file',
      'professionals.invite_user',
      'professionals.invite_user',
    ])
    assertEquals(service.calls.length, 3)
    assertEquals(user.calls.map((c) => c.fn), [
      'get_my_access',
      'get_my_access',
    ])
    assertEquals(http.calls, [])
  })
})

Deno.test("professionals-invite: a double click on « Renvoyer » / « Nouveau lien » → the second is refused by the file's guard before any link is issued", async () => {
  await run(async () => {
    // The file's guard holds one hit per key, as its 5 s window does; the
    // other buckets allow everything.
    const seen = new Set<string>()
    const { handler, service, http } = harness({
      rpc: {
        consume_rate_limit: (a) => {
          const guarded = a.p_bucket === 'professionals.invite_file'
          const key = String(a.p_key_hash)
          const allowed = !guarded || !seen.has(key)
          if (guarded) seen.add(key)
          return {
            data: [{
              allowed,
              hits: 1,
              retry_after_seconds: allowed ? 0 : 5,
            }],
          }
        },
      },
    })
    const first = await handler(
      post({ action: 'resend', professional_id: PROFESSIONAL_ID }),
    )
    assertEquals(first.status, 200)
    for (const action of ['resend', 'new_link', 'send']) {
      const again = await handler(
        post({ action, professional_id: PROFESSIONAL_ID }),
      )
      const error = await errorOf(again)
      assertEquals([error.status, error.code], [429, 'rate_limited'], action)
      assertEquals(again.headers.get('Retry-After'), '5')
      // Nothing created: no ids next to the error.
      assertEquals(error.body.professional_id, undefined)
    }
    // One link issued, the one emailed; the refused clicks did not count
    // against the caller's hourly limit.
    assertEquals(
      service.calls.filter((c) => c.fn === 'create_professional_invitation')
        .length,
      1,
    )
    assertEquals(http.calls.length, 1)
    assertEquals(
      buckets(service.calls).filter((b) => b === 'professionals.invite_user')
        .length,
      1,
    )
    // Another file is not held back.
    const other = await handler(
      post({ action: 'resend', professional_id: OTHER_ID }),
    )
    assertEquals(other.status, 200)
  })
})

Deno.test('professionals-invite: once the link has rotated, the email is sent even if the caller has gone', async () => {
  await run(async () => {
    const controller = new AbortController()
    const { handler, http, service } = harness({
      rpc: {
        create_professional_invitation: () => {
          // The tab closes while the link is being issued.
          controller.abort()
          return {
            data: {
              link_id: LINK_ID,
              submission_id: SUBMISSION_ID,
              email: PROFESSIONAL_EMAIL,
              first_name: 'Nadia',
              expires_at: EXPIRES,
            },
          }
        },
      },
    })
    const req = new Request(URL_, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: APP,
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({
        action: 'new_link',
        professional_id: PROFESSIONAL_ID,
      }),
      signal: controller.signal,
    })
    const res = await handler(req)
    assert(req.signal.aborted)
    assertEquals(res.status, 200)
    assertEquals(http.calls.length, 1)
    assertEquals(
      await hashToken(emailedToken(http.calls[0].body)),
      args(service.calls, 'create_professional_invitation')!.p_token_hash,
    )
  })
})

Deno.test('professionals-invite: an APP_URL links cannot use → 500 before anything is created', async () => {
  await run(async () => {
    const { handler, service, user } = harness({
      env: { APP_URL: 'http://app.example.com' },
    })
    await captureConsole('error', async () => {
      for (
        const body of [
          { action: 'new_link', professional_id: PROFESSIONAL_ID },
          {
            action: 'request_update',
            professional_id: PROFESSIONAL_ID,
            sections: ['portrait'],
          },
        ]
      ) {
        const error = await errorOf(await handler(post(body)))
        assertEquals([error.status, error.code], [500, 'server_misconfigured'])
      }
    })
    assertEquals(
      args(service.calls, 'create_professional_invitation'),
      undefined,
    )
    assertEquals(args(user.calls, 'request_professional_update'), undefined)
  })
})

Deno.test('professionals-invite: an email failure keeps what was created: 502, 503, 429, 400 field email', async () => {
  await run(async () => {
    const provider = harness({ mailpit: json(500, {}) })
    await captureConsole('error', async () => {
      const res = await provider.handler(send())
      assertEquals(res.status, 502)
      assertEquals(await res.json(), {
        error: { code: 'provider_error', message: 'Created, email not sent' },
        professional_id: PROFESSIONAL_ID,
      })
      const update = await provider.handler(post({
        action: 'request_update',
        professional_id: PROFESSIONAL_ID,
        sections: ['portrait'],
      }))
      assertEquals(update.status, 502)
      assertEquals((await update.json()).submission_id, SUBMISSION_ID)
    })

    const unconfigured = harness({ env: { EMAIL_TRANSPORT: 'carrier-pigeon' } })
    await captureConsole('error', async () => {
      const error = await errorOf(await unconfigured.handler(send()))
      assertEquals([error.status, error.code], [503, 'not_configured'])
      assertEquals(error.body.professional_id, PROFESSIONAL_ID)
    })

    const limited = harness({
      limits: { 'emails.repeat_guard': { allowed: false } },
    })
    const res = await limited.handler(
      post({ action: 'resend', professional_id: PROFESSIONAL_ID }),
    )
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '900')
    assertEquals((await res.json()).professional_id, PROFESSIONAL_ID)

    const bad = harness({
      rpc: {
        create_professional_invitation: {
          data: {
            email: 'pas une adresse',
            first_name: 'Nadia',
            expires_at: EXPIRES,
          },
        },
      },
    })
    const refused = await errorOf(await bad.handler(send()))
    assertEquals([refused.status, refused.code, refused.field], [
      400,
      'invalid_request',
      'email',
    ])
    assertEquals(bad.http.calls, [])
  })
})

Deno.test('professionals-invite: no token or address in any log or report', async () => {
  await run(async () => {
    const { handler, http } = harness({ mailpit: json(500, {}) })
    const lines: unknown[][] = []
    lines.push(
      ...await captureConsole('error', async () => {
        lines.push(
          ...await captureConsole('warn', async () => {
            lines.push(
              ...await captureConsole('log', async () => {
                await handler(send())
              }),
            )
          }),
        )
      }),
    )
    const token = emailedToken(http.calls[0].body)
    const text = JSON.stringify(lines)
    assert(lines.length > 0, 'the provider failure is reported')
    assert(!text.includes(token))
    assert(!text.includes(PROFESSIONAL_EMAIL))
    assert(!text.includes('#t='))
  })
})
