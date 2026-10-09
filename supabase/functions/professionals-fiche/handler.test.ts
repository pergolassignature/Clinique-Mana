import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { ficheFileName } from './file-name.ts'
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
  ADMIN_ID,
  emailContextFixture,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/professionals-fiche'
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const PRO_ID = '5eed0000-0000-4000-8000-000000000001'
const FILE_ID = '00000000-0000-4000-8000-0000000000f1'
const PATH = `${ORG_ID}/professionals/${PRO_ID}/${FILE_ID}.pdf`
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: 'http://localhost:5173',
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
}
const PDF = new TextEncoder().encode('%PDF-1.3\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
const VIEWER = ['professionals.view']

/** The migration's template (`…_professionals_fiche_email.sql`), as `get_email_context` returns it. */
const FICHE_CONTEXT = emailContextFixture({
  module_key: 'professionals',
  template: {
    key: 'professionals.fiche',
    subject: 'Fiche de {{professional.name}}',
    body:
      'Bonjour,\n{{message}}\n\nVoici la fiche de {{professional.name}}, en pièce jointe.\n\nRépondez simplement à ce courriel.',
    button_label: null,
    why_line:
      'Vous recevez ce courriel parce que la clinique vous transmet la fiche d’un professionnel.',
    variables: [
      {
        path: 'professional.name',
        label: 'Nom',
        sample: 'Geneviève Tremblay',
        required: true,
        kind: 'text',
      },
      {
        path: 'message',
        label: 'Message',
        sample: 'Bonjour',
        required: false,
        kind: 'text',
      },
    ],
    view_permission: 'professionals.view',
    recipient_mode: 'free',
    allows_attachments: true,
  },
})

const UPLOAD = {
  first_name: 'Geneviève',
  last_name: 'Tremblay',
  bucket: 'documents',
  object_path: PATH,
  size_bytes: PDF.length,
}

const BODY = {
  action: 'email',
  professional_id: PRO_ID,
  file_id: FILE_ID,
  to: '  client@exemple.ca ',
  message: 'Comme convenu, voici la fiche.',
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
  permissions?: string[]
  modules?: string[]
  /** The caller's RPCs (`get_professional_fiche_upload`, `mark_professional_fiche_generated`). */
  userRpc?: Record<string, RpcRoute>
  serviceRpc?: Record<string, RpcRoute>
  /** Per bucket, the consume_rate_limit row. */
  limits?: Record<string, { allowed: boolean; hits: number }>
  download?: () => {
    data?: unknown
    error?: { status?: number; message?: string } | null
  }
  mailpit?: Responder
  env?: Record<string, string>
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(opts.permissions ?? VIEWER),
          modules: opts.modules ?? ['professionals'],
        },
      },
      get_professional_fiche_upload: { data: UPLOAD },
      mark_professional_fiche_generated: { data: '2026-10-08T15:00:00Z' },
      ...opts.userRpc,
    },
  })
  const service = fakeSupabase({
    rpc: {
      get_email_context: { data: FICHE_CONTEXT },
      consume_rate_limit: (args) => {
        const limit = opts.limits?.[String(args.p_bucket)]
        return {
          data: [{
            allowed: limit?.allowed ?? true,
            hits: limit?.hits ?? 1,
            retry_after_seconds: limit?.allowed === false ? 1_200 : 0,
          }],
        }
      },
      queue_email: { data: LOG_ID },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
      ...opts.serviceRpc,
    },
    storage: {
      download: () => opts.download?.() ?? { data: new Blob([PDF]) },
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
  return { handler: createHandler(deps), user, service, http }
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

/** What `reportError` wrote (one console.error line per report; no Sentry here), as text. */
const reported = async (fn: () => Promise<void>) =>
  (await captureConsole('error', fn)).map((call) => call.map(String).join(' '))

const args = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.find((c) => c.fn === fn)?.args
const buckets = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.fn === 'consume_rate_limit').map((c) => c.args.p_bucket)
const caller = (calls: { fn: string }[]) =>
  calls.map((c) => c.fn).filter((fn) => fn !== 'get_my_access')

Deno.test('professionals-fiche: no token → 401; without professionals.view → 403; module off → 403; nothing read or sent', async () => {
  await run(async () => {
    const anonymous = harness()
    assertEquals((await anonymous.handler(post(BODY, null))).status, 401)
    const provider = harness({ permissions: ['professionals.self'] })
    const refused = await errorOf(await provider.handler(post(BODY)))
    assertEquals([refused.status, refused.code], [403, 'forbidden'])
    const off = harness({ modules: [] })
    const disabled = await errorOf(await off.handler(post(BODY)))
    assertEquals([disabled.status, disabled.code], [403, 'module_disabled'])
    for (const h of [anonymous, provider, off]) {
      assertEquals([
        caller(h.user.calls),
        h.service.calls,
        h.service.storageCalls,
        h.http.calls,
      ], [[], [], [], []])
    }
  })
})

Deno.test('professionals-fiche: sends the uploaded file to the typed address, named from the database, then stamps', async () => {
  await run(async () => {
    const { handler, user, service, http } = harness()
    const res = await handler(post(BODY))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { email_log_id: LOG_ID })

    // The check runs as the caller (RLS and the RPC's own rules), never as the service role.
    assertEquals(args(user.calls, 'get_professional_fiche_upload'), {
      p_id: PRO_ID,
      p_file_id: FILE_ID,
    })
    assertEquals(
      args(service.calls, 'get_professional_fiche_upload'),
      undefined,
    )
    // The object the RPC named, read by the service role.
    assertEquals(service.storageCalls, [{
      bucket: 'documents',
      method: 'download',
      args: [PATH],
    }])

    const queued = args(service.calls, 'queue_email')!
    assertEquals(queued.p_template_key, 'professionals.fiche')
    assertEquals(queued.p_to_email, 'client@exemple.ca')
    assertEquals(queued.p_to_profile_id, null)
    assertEquals(queued.p_subject_type, 'professional')
    assertEquals(queued.p_subject_id, PRO_ID)
    assertEquals(queued.p_view_permission, 'professionals.view')
    assertEquals(queued.p_sent_by, ADMIN_ID)
    assertEquals(queued.p_attachment_count, 1)

    // A deliberate send: the double-click guard and the free-recipient limit, not one per minute per address.
    assertEquals(buckets(service.calls), [
      'professionals.fiche_email_user',
      'emails.repeat_guard',
      'emails.free_recipient',
      'emails.org_day',
    ])

    assertEquals(http.calls.length, 1)
    const sent = JSON.parse(http.calls[0].body)
    assertEquals(sent.To, [{ Email: 'client@exemple.ca' }])
    assertEquals(sent.Subject, 'Fiche de Geneviève Tremblay')
    assertEquals(sent.Attachments, [{
      Filename: 'Fiche - Geneviève Tremblay.pdf',
      Content: btoa(String.fromCharCode(...PDF)),
      ContentType: 'application/pdf',
    }])
    assert(sent.Text.includes('Comme convenu, voici la fiche.'))
    assert(sent.Text.includes('Voici la fiche de Geneviève Tremblay'))

    assertEquals(args(user.calls, 'mark_professional_fiche_generated'), {
      p_id: PRO_ID,
    })
  })
})

Deno.test('professionals-fiche: without a message, no empty paragraph', async () => {
  await run(async () => {
    const { handler, http } = harness()
    const { message: _message, ...body } = BODY
    assertEquals((await handler(post({ ...body, message: '   ' }))).status, 200)
    const sent = JSON.parse(http.calls[0].body)
    assertFalse(/<p[^>]*>(?:<br>)?<\/p>/.test(sent.HTML))
    assert(sent.HTML.includes('Bonjour,'))
  })
})

Deno.test('professionals-fiche: a malformed body → 400 before any lookup', async () => {
  await run(async () => {
    const { handler, user, service } = harness()
    for (
      const body of [
        { ...BODY, action: 'download' },
        { ...BODY, professional_id: 'not-a-uuid' },
        { ...BODY, to: undefined },
        { ...BODY, to: 'x'.repeat(255) },
        { ...BODY, message: 'x'.repeat(1_001) },
        { ...BODY, message: 'Bonjour\u202eici' },
        { ...BODY, org_id: ORG_ID },
      ]
    ) {
      const error = await errorOf(await handler(post(body)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
    }
    assertEquals([caller(user.calls), service.calls], [[], []])
  })
})

Deno.test('professionals-fiche: the 31st call in an hour → 429 before the lookup', async () => {
  await run(async () => {
    const { handler, user, http } = harness({
      limits: {
        'professionals.fiche_email_user': { allowed: false, hits: 31 },
      },
    })
    const res = await handler(post(BODY))
    assertEquals(res.headers.get('Retry-After'), '1200')
    assertEquals((await errorOf(res)).status, 429)
    assertEquals([caller(user.calls), http.calls], [[], []])
  })
})

Deno.test('professionals-fiche: the RPC refusals are passed on in French; nothing downloaded or sent', async () => {
  await run(async () => {
    for (
      const message of [
        'Seuls les professionnels actifs peuvent être proposés.',
        'Fichier introuvable.',
        'Professionnel introuvable.',
      ]
    ) {
      const { handler, service, http } = harness({
        userRpc: {
          get_professional_fiche_upload: { error: { code: 'P0001', message } },
        },
      })
      const error = await errorOf(await handler(post(BODY)))
      assertEquals([error.status, error.code, error.message, error.refusal], [
        400,
        'invalid_request',
        message,
        true,
      ])
      assertEquals([
        service.storageCalls,
        args(service.calls, 'queue_email'),
        http.calls,
      ], [[], undefined, []])
    }
    const denied = harness({
      userRpc: {
        get_professional_fiche_upload: {
          error: { code: '42501', message: 'Permission refusée' },
        },
      },
    })
    assertEquals((await errorOf(await denied.handler(post(BODY)))).status, 403)
  })
})

Deno.test('professionals-fiche: a 22023 from the lookup → 400 invalid_request, not a 500 (P4-477)', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      userRpc: {
        get_professional_fiche_upload: {
          error: { code: '22023', message: 'p_file_id: bad value' },
        },
      },
    })
    const logged = await reported(async () => {
      const error = await errorOf(await handler(post(BODY)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
      // The RPC's message may hold an argument: never passed on.
      assert(!String(error.message).includes('p_file_id'))
    })
    assertEquals(logged, [])
    assertEquals([service.storageCalls, http.calls], [[], []])
  })
})

Deno.test('professionals-fiche: an error the send path throws keeps its own status (an unknown template → 404, P4-477)', async () => {
  await run(async () => {
    const unknown = harness({
      serviceRpc: { get_email_context: { error: { code: '22023', message: 'unknown template' } } },
    })
    const logged = await reported(async () => {
      const error = await errorOf(await unknown.handler(post(BODY)))
      assertEquals([error.status, error.code], [404, 'not_found'])
    })
    assert(logged.some((line) => line.includes('email_template_unknown')))
    const broken = harness({
      serviceRpc: { get_email_context: { error: { code: 'XX000', message: 'boom' } } },
    })
    await reported(async () => {
      const error = await errorOf(await broken.handler(post(BODY)))
      assertEquals([error.status, error.code], [500, 'internal'])
    })
    assertEquals(unknown.http.calls, [])
  })
})

Deno.test('professionals-fiche: an object gone → 404; not a PDF or a failed lookup → 500; reported, never sent', async () => {
  await run(async () => {
    const cases: [Parameters<typeof harness>[0], number, string][] = [
      [
        {
          download: () => ({
            error: { status: 404, message: 'Object not found' },
          }),
        },
        404,
        'fiche_object_missing',
      ],
      [
        { download: () => ({ data: new Blob(['<html>%PDF-1.3 %%EOF']) }) },
        500,
        'fiche_not_pdf',
      ],
      [
        {
          userRpc: {
            get_professional_fiche_upload: {
              error: { code: 'XX000', message: 'boom' },
            },
          },
        },
        500,
        'fiche_upload_lookup_failed',
      ],
      [
        {
          userRpc: {
            get_professional_fiche_upload: {
              data: { ...UPLOAD, size_bytes: 11 * 1024 * 1024 },
            },
          },
        },
        500,
        'fiche_too_large',
      ],
    ]
    for (const [opts, status, code] of cases) {
      const { handler, service, http } = harness(opts)
      const logged = await reported(async () => {
        assertEquals((await errorOf(await handler(post(BODY)))).status, status)
      })
      assert(logged.some((line) => line.includes(code)), code)
      assert(
        logged.every((line) =>
          !line.includes('client@exemple.ca') && !line.includes(PATH)
        ),
      )
      assertEquals([args(service.calls, 'queue_email'), http.calls], [
        undefined,
        [],
      ])
    }
  })
})

Deno.test('professionals-fiche: an address the send path refuses → 400 on the field, nothing queued', async () => {
  await run(async () => {
    const { handler, service } = harness()
    for (
      const to of [
        'client@exemple',
        'a@exemple.ca, b@exemple.ca',
        'Client <client@exemple.ca>',
      ]
    ) {
      const error = await errorOf(await handler(post({ ...BODY, to })))
      assertEquals([error.status, error.code, error.field], [
        400,
        'invalid_request',
        'to',
      ])
    }
    assertEquals(args(service.calls, 'queue_email'), undefined)
  })
})

Deno.test('professionals-fiche: the free-recipient limit → 429; nothing sent, nothing stamped', async () => {
  await run(async () => {
    const { handler, user, http } = harness({
      limits: { 'emails.free_recipient': { allowed: false, hits: 21 } },
    })
    const res = await handler(post(BODY))
    assertEquals((await errorOf(res)).status, 429)
    assertEquals(http.calls, [])
    assertEquals(
      args(user.calls, 'mark_professional_fiche_generated'),
      undefined,
    )
  })
})

Deno.test('professionals-fiche: a template that no longer allows attachments → 403, reported', async () => {
  await run(async () => {
    const context = emailContextFixture({
      ...FICHE_CONTEXT,
      template: {
        ...(FICHE_CONTEXT.template as object),
        allows_attachments: false,
      },
    })
    const { handler, http } = harness({
      serviceRpc: { get_email_context: { data: context } },
    })
    const logged = await reported(async () => {
      assertEquals((await errorOf(await handler(post(BODY)))).status, 403)
    })
    assert(logged.some((line) => line.includes('fiche_attachment_not_allowed')))
    assertEquals(http.calls, [])
  })
})

Deno.test('professionals-fiche: a failed stamp is reported, the send still answers 200', async () => {
  await run(async () => {
    const { handler } = harness({
      userRpc: {
        mark_professional_fiche_generated: {
          error: { code: 'XX000', message: 'boom' },
        },
      },
    })
    const logged = await reported(async () => {
      assertEquals((await handler(post(BODY))).status, 200)
    })
    assert(logged.some((line) => line.includes('fiche_stamp_failed')))
  })
})

Deno.test('ficheFileName: « Fiche - Prénom Nom.pdf », safe for an attachment', () => {
  assertEquals(
    ficheFileName({ firstName: 'Marc-André', lastName: "O'Neil" }),
    "Fiche - Marc-André O'Neil.pdf",
  )
  assertEquals(
    ficheFileName({ firstName: 'Anne/Marie', lastName: 'Roy\u202e' }),
    'Fiche - Anne Marie Roy.pdf',
  )
  assertEquals(ficheFileName({ firstName: '', lastName: '' }), 'Fiche.pdf')
  const long = ficheFileName({ firstName: 'Anne'.repeat(30), lastName: 'Roy' })
  assertEquals(Array.from(long).length, 100)
  assert(/^[\p{L}\p{N}][\p{L}\p{N} '’()._-]{0,95}\.pdf$/iu.test(long))
})
