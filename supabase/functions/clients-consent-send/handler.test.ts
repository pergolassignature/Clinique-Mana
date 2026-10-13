import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
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

const URL_ = 'http://fn.test/functions/v1/clients-consent-send'
const APP = 'http://localhost:5173'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const CLIENT = '00000000-0000-4000-8000-0000000000d1'
const REQUEST = '00000000-0000-4000-8000-0000000000c1'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }

const prepared = (over: Record<string, unknown> = {}) => ({
  request_id: REQUEST,
  resent: false,
  language: 'fr',
  consent_name: 'Consentement général',
  client_first_name: 'Théo',
  clinic_name: 'Clinique MANA',
  expires_at: '2026-10-26T12:00:00Z',
  signers: [
    {
      role: 'client',
      signer_id: '00000000-0000-4000-8000-0000000000f1',
      first_name: 'Marc',
      full_name: 'Marc Gagnon',
      email: 'marc@exemple.test',
      link_id: '00000000-0000-4000-8000-0000000000a9',
    },
    {
      role: 'client_2',
      signer_id: '00000000-0000-4000-8000-0000000000f2',
      first_name: 'Nadia',
      full_name: 'Nadia Roy',
      email: 'nadia@exemple.test',
      link_id: '00000000-0000-4000-8000-0000000000aa',
    },
  ],
  ...over,
})

const emailContext = (key: string) =>
  emailContextFixture({
    module_key: 'clients',
    template: {
      key,
      subject: '{{consent.name}} — {{clinic.name}}',
      body: 'Bonjour {{signer.first_name}}, pour {{client.first_name}}. ' +
        'Valide jusqu’au {{link.expires_at}}.',
      button_label: 'Lire et signer',
      view_permission: 'clients.view',
      variables: [
        'signer.first_name',
        'client.first_name',
        'consent.name',
        'clinic.name',
      ]
        .map((path) => ({
          path,
          label: path,
          sample: 'x',
          required: true,
          kind: 'text',
        }))
        .concat([{
          path: 'link.expires_at',
          label: 'Fin',
          sample: 'x',
          required: true,
          kind: 'datetime',
        }]),
    },
  })

function setup(
  options: {
    permissions?: string[]
    prepare?: RpcRoute
    mailpitStatus?: (to: string) => number
  } = {},
) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [ALLOWED] },
      prepare_client_consent_request_for_service: options.prepare ??
        { data: prepared() },
      get_email_context: (args) => ({
        data: emailContext(String(args.p_template_key)),
      }),
      queue_email: { data: '00000000-0000-4000-8000-0000000000e9' },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
    },
  })
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? ['clients.manage']),
          modules: ['clients'],
        },
      },
    },
  })
  const http = fakeFetch({
    [MAILPIT]: async (req) => {
      const to = (await req.json()).To[0].Email
      return new Response(JSON.stringify({ ID: 'm' }), {
        status: options.mailpitStatus?.(to) ?? 200,
      })
    },
  })
  const env: Record<string, string> = {
    APP_URL: APP,
    EMAIL_TRANSPORT: 'mailpit',
    MAILPIT_URL: 'http://mailpit.test:8025',
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: http.fetch,
    now: fixedClock('2026-10-12T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), service, http }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)

const post = (b: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer jwt',
      'Content-Type': 'application/json',
      Origin: APP,
    },
    body: JSON.stringify(b),
  })

const send = { action: 'send', client_id: CLIENT, consent_key: 'general' }

Deno.test('clients-consent-send: the request prepared as the caller, two hashed tokens, one email per signer with her own link', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post(send))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      request_id: REQUEST,
      resent: false,
      signers: [{ role: 'client', sent: true }, {
        role: 'client_2',
        sent: true,
      }],
    })
    const call = s.service.calls.find((c) =>
      c.fn === 'prepare_client_consent_request_for_service'
    )!
    assertEquals(call.args.p_actor, ADMIN_ID)
    assertEquals(call.args.p_org_id, ORG_ID)
    assertEquals(call.args.p_client_id, CLIENT)
    assertEquals(call.args.p_consent_key, 'general')
    assert(/^\\x[0-9a-f]{64}$/.test(String(call.args.p_token_hash_1)))
    assert(call.args.p_token_hash_1 !== call.args.p_token_hash_2)
    const mails = await Promise.all(s.http.calls.map((c) => JSON.parse(c.body)))
    assertEquals(mails.map((m) => m.To[0].Email), [
      'marc@exemple.test',
      'nadia@exemple.test',
    ])
    const links = mails.map((m) =>
      /\/consentement#t=([A-Za-z0-9_-]{43})/.exec(m.Text)?.[1]
    )
    assert(links[0] && links[1] && links[0] !== links[1], 'each her own link')
  })
})

Deno.test('clients-consent-send: English → the English template', async () => {
  await run(async () => {
    const s = setup({ prepare: { data: prepared({ language: 'en' }) } })
    await s.handler(post(send))
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'get_email_context').map((c) =>
        c.args.p_template_key
      ),
      ['clients.consent_request_en', 'clients.consent_request_en'],
    )
  })
})

Deno.test('clients-consent-send: resend by request id; a failed email is listed, the request stands', async () => {
  await run(async () => {
    const s = setup({
      prepare: { data: prepared({ resent: true }) },
      mailpitStatus: (to) => to.startsWith('nadia') ? 500 : 200,
    })
    let answer: Record<string, unknown> = {}
    await captureConsole('error', async () => {
      const res = await s.handler(
        post({ action: 'resend', request_id: REQUEST }),
      )
      assertEquals(res.status, 200)
      answer = await res.json()
    })
    assertEquals(answer.resent, true)
    assertEquals((answer.signers as { sent: boolean }[]).map((x) => x.sent), [
      true,
      false,
    ])
    const call = s.service.calls.find((c) =>
      c.fn === 'prepare_client_consent_request_for_service'
    )!
    assertEquals(call.args.p_request_id, REQUEST)
    assertEquals(call.args.p_client_id, null)
  })
})

Deno.test('clients-consent-send: a refusal passes with its French message and field; clients.manage is required', async () => {
  await run(async () => {
    const s = setup({
      prepare: {
        error: {
          code: 'P0001',
          message:
            'Ce client a moins de 14 ans : un parent ou un tuteur doit signer.',
          hint: 'signer_required',
        },
      },
    })
    const res = await s.handler(post(send))
    assertEquals(res.status, 400)
    const answer = await res.json()
    assertEquals(answer.error.refusal, true)
    assertEquals(answer.error.field, 'signer_required')
    assertEquals(s.http.calls, [], 'nothing emailed')
    const denied = await setup({ permissions: ['clients.view'] }).handler(
      post(send),
    )
    assertEquals(denied.status, 403)
  })
})

Deno.test('clients-consent-send: the body is strict; a context needs its id', async () => {
  await run(async () => {
    const s = setup()
    assertEquals((await s.handler(post({ ...send, extra: 1 }))).status, 400)
    assertEquals(
      (await s.handler(post({ ...send, context_type: 'appointment' }))).status,
      400,
    )
    assertEquals(s.service.calls, [])
  })
})
