import { assert, assertEquals } from '@std/assert'
import { createHandler, slotLines } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  emailContextFixture,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/demandes-propose'
const APP = 'http://localhost:5173'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const DEMANDE = '00000000-0000-4000-8000-0000000000d1'
const PRO = '00000000-0000-4000-8000-0000000000c1'
const SERVICE = '00000000-0000-4000-8000-0000000000e1'
const PROP = '00000000-0000-4000-8000-0000000000f1'

const created = (over: Record<string, unknown> = {}) => ({
  proposition_id: PROP,
  demande_id: DEMANDE,
  email: 'alice@exemple.test',
  first_name: 'Alice',
  language: 'fr',
  clinic_name: 'Clinique MANA',
  timezone: 'America/Toronto',
  professional_name: 'Pro Un',
  service_name: 'Consultation individuelle 50 min',
  slots: [{ appointment_id: 'a', starts_at: '2027-03-15T13:00:00Z' }],
  expires_at: '2026-10-15T15:00:00Z',
  ...over,
})

function setup(
  options: { permissions?: string[]; create?: RpcRoute } = {},
) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [ALLOWED] },
      create_proposition_for_service: options.create ?? { data: created() },
      get_email_context: (args) => ({
        data: emailContextFixture({
          module_key: 'demandes',
          template: {
            key: String(args.p_template_key),
            subject: 'Avec {{professional.name}}',
            body: 'Bonjour {{person.first_name}}\n{{proposal.slots}}',
            button_label: 'Choisir ma plage',
            view_permission: 'demandes.view',
            variables: [
              'person.first_name',
              'clinic.name',
              'professional.name',
              'proposal.service',
              'proposal.slots',
            ].map((path) => ({
              path,
              label: path,
              sample: 'x',
              required: true,
              kind: 'text',
            })).concat([{
              path: 'proposal.expires_at',
              label: 'Fin',
              sample: 'x',
              required: true,
              kind: 'datetime',
            }]),
          },
        }),
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
          ...accessFixture(options.permissions ?? ['demandes.manage']),
          modules: ['demandes'],
        },
      },
    },
  })
  const http = fakeFetch({
    [MAILPIT]: () => new Response(JSON.stringify({ ID: 'm' }), { status: 200 }),
  })
  const env: Record<string, string> = {
    APP_URL: APP,
    EMAIL_TRANSPORT: 'mailpit',
    MAILPIT_URL: 'http://mailpit.test:8025',
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: http.fetch,
    now: fixedClock('2026-10-13T15:00:00Z').now,
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

const body = {
  demande_id: DEMANDE,
  professional_id: PRO,
  service_id: SERVICE,
  starts_at: ['2027-03-15T13:00:00Z'],
  mode: 'video',
}

Deno.test('demandes-propose: as the verified caller with a hashed token; the email carries the slots and the link', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post(body))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      proposition_id: PROP,
      emailed: true,
      expires_at: '2026-10-15T15:00:00Z',
    })
    const call = s.service.calls.find((c) =>
      c.fn === 'create_proposition_for_service'
    )!
    assertEquals(call.args.p_actor, ADMIN_ID)
    assertEquals(call.args.p_demande_id, DEMANDE)
    assertEquals(call.args.p_starts_at, ['2027-03-15T13:00:00Z'])
    assert(/^\\x[0-9a-f]{64}$/.test(String(call.args.p_token_hash)))
    const mail = JSON.parse(s.http.calls[0].body)
    assertEquals(mail.To[0].Email, 'alice@exemple.test')
    assert(/\/proposition#t=[A-Za-z0-9_-]{43}/.test(mail.Text))
    assert(mail.Text.includes('lundi 15 mars 2027 à 9 h'))
  })
})

Deno.test('demandes-propose: without demandes.manage → 403 before anything', async () => {
  await run(async () => {
    const s = setup({ permissions: ['demandes.view'] })
    const res = await s.handler(post(body))
    assertEquals(res.status, 403)
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'create_proposition_for_service')
        .length,
      0,
    )
  })
})

Deno.test('demandes-propose: a refusal (P3-40, a slot taken…) is the database’s French sentence, no email', async () => {
  await run(async () => {
    const s = setup({
      create: {
        error: {
          code: 'P0001',
          message:
            'Demandes est réservé aux testeurs : aucune proposition ne part vers un client pour le moment.',
          hint: 'module_reserved',
        },
      },
    })
    const res = await s.handler(post(body))
    assertEquals(res.status, 400)
    const json = await res.json()
    assertEquals(json.error.refusal, true)
    assertEquals(s.http.calls.length, 0)
  })
})

Deno.test('demandes-propose: the body is checked (1 to 3 slots, the mode)', async () => {
  await run(async () => {
    const s = setup()
    for (
      const bad of [{ ...body, starts_at: [] }, { ...body, mode: 'office' }, {
        ...body,
        starts_at: ['a', 'b', 'c', 'd'],
      }]
    ) {
      assertEquals((await s.handler(post(bad))).status, 400)
    }
  })
})

Deno.test('slotLines: the clinic time, in French or in English', () => {
  assertEquals(
    slotLines(
      ['2027-03-16T13:30:00Z', '2027-03-15T13:00:00Z'],
      'America/Toronto',
      'fr',
    ),
    '• lundi 15 mars 2027 à 9 h\n• mardi 16 mars 2027 à 9 h 30',
  )
  assert(
    slotLines(['2027-03-15T13:00:00Z'], 'America/Toronto', 'en').includes(
      'March 15',
    ),
  )
})
