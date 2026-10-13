import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { copyFilename } from './copy.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
  type StorageRoute,
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
const CONSENT = '00000000-0000-4000-8000-0000000000c5'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const PDF = new TextEncoder().encode(
  '%PDF-1.3\n1 0 obj\n<<>>\nendobj\n%%EOF\n',
)
const PATH = `${ORG_ID}/core/00000000-0000-4000-8000-0000000000e1/f.pdf`

const prepared = (over: Record<string, unknown> = {}) => ({
  consent_id: CONSENT,
  language: 'fr',
  consent_name: 'Consentement général',
  client_first_name: 'Théo',
  clinic_name: 'Clinique MANA',
  signed_on: '2026-10-02',
  file: { bucket: 'signed-documents', object_path: PATH },
  recipients: [
    { role: 'client', first_name: 'Marc', email: 'marc@exemple.test' },
    { role: 'client_2', first_name: 'Nadia', email: 'nadia@exemple.test' },
  ],
  ...over,
})

const emailContext = (key: string) =>
  emailContextFixture({
    module_key: 'clients',
    template: {
      key,
      subject: 'Copie signée : {{consent.name}} — {{clinic.name}}',
      body: 'Bonjour {{recipient.first_name}}, la copie de ' +
        '{{client.first_name}}, signée le {{consent.signed_on}}.',
      button_label: null,
      view_permission: 'clients.view',
      allows_attachments: true,
      variables: [
        ['recipient.first_name', 'text'],
        ['client.first_name', 'text'],
        ['consent.name', 'text'],
        ['consent.signed_on', 'date'],
        ['clinic.name', 'text'],
      ].map(([path, kind]) => ({
        path,
        label: path,
        sample: kind === 'date' ? '2026-10-13' : 'x',
        required: true,
        kind,
      })),
    },
  })

function setup(
  options: {
    permissions?: string[]
    prepare?: RpcRoute
    download?: StorageRoute
    mailpitStatus?: (to: string) => number
  } = {},
) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [ALLOWED] },
      prepare_client_consent_copy_for_service: options.prepare ??
        { data: prepared() },
      mark_client_consent_copy_sent_for_service: {
        data: '2026-10-13T15:00:00Z',
      },
      get_email_context: (args) => ({
        data: emailContext(String(args.p_template_key)),
      }),
      queue_email: { data: '00000000-0000-4000-8000-0000000000e9' },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
    },
    storage: {
      download: options.download ?? (() => ({ data: new Blob([PDF]) })),
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

const copy = { action: 'copy', consent_id: CONSENT }

Deno.test('clients-consent-send copy: prepared as the caller, the sealed PDF attached to one email per person, then recorded', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post(copy))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      consent_id: CONSENT,
      copy_sent_at: '2026-10-13T15:00:00Z',
      recipients: [{ role: 'client', sent: true }, {
        role: 'client_2',
        sent: true,
      }],
    })
    const call = s.service.calls.find((c) =>
      c.fn === 'prepare_client_consent_copy_for_service'
    )!
    assertEquals(call.args, {
      p_org_id: ORG_ID,
      p_actor: ADMIN_ID,
      p_consent_id: CONSENT,
    })
    assertEquals(
      s.service.storageCalls.map((c) => [c.bucket, c.method, c.args[0]]),
      [['signed-documents', 'download', PATH]],
    )
    const mails = await Promise.all(s.http.calls.map((c) => JSON.parse(c.body)))
    assertEquals(mails.map((m) => m.To[0].Email), [
      'marc@exemple.test',
      'nadia@exemple.test',
    ])
    for (const m of mails) {
      assertEquals(m.Attachments.length, 1)
      assertEquals(
        m.Attachments[0].Filename,
        'Consentement général (signé).pdf',
      )
      assertEquals(m.Attachments[0].ContentType, 'application/pdf')
      assert(m.Text.includes('2 octobre 2026'), 'the signature date in words')
    }
    const queued = s.service.calls.filter((c) => c.fn === 'queue_email')
    assertEquals(
      queued.map((c) => [c.args.p_subject_type, c.args.p_attachment_count]),
      [
        ['client_consent', 1],
        ['client_consent', 1],
      ],
    )
    const marked = s.service.calls.find((c) =>
      c.fn === 'mark_client_consent_copy_sent_for_service'
    )!
    assertEquals(marked.args, {
      p_org_id: ORG_ID,
      p_consent_id: CONSENT,
      p_actor: ADMIN_ID,
    })
  })
})

Deno.test('clients-consent-send copy: English → the English template and name', async () => {
  await run(async () => {
    const s = setup({
      prepare: {
        data: prepared({ language: 'en', consent_name: 'General consent' }),
      },
    })
    await s.handler(post(copy))
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'get_email_context').map((c) =>
        c.args.p_template_key
      ),
      ['clients.consent_signed_copy_en', 'clients.consent_signed_copy_en'],
    )
    const mail = JSON.parse(s.http.calls[0].body)
    assertEquals(mail.Attachments[0].Filename, 'General consent (signed).pdf')
  })
})

Deno.test('clients-consent-send copy: a refusal (P3-40) passes as written; nothing read, sent or recorded', async () => {
  await run(async () => {
    const s = setup({
      prepare: {
        error: {
          code: 'P0001',
          message:
            'Le module Clients est réservé aux testeurs : aucune copie ne part aux clients avant son ouverture à tous.',
          hint: 'module_reserved',
        },
      },
    })
    const res = await s.handler(post(copy))
    assertEquals(res.status, 400)
    const answer = await res.json()
    assertEquals([answer.error.refusal, answer.error.field], [
      true,
      'module_reserved',
    ])
    assertEquals(s.service.storageCalls, [])
    assertEquals(s.http.calls, [])
    assert(
      !s.service.calls.some((c) =>
        c.fn === 'mark_client_consent_copy_sent_for_service'
      ),
    )
    const denied = await setup({ permissions: ['clients.view'] }).handler(
      post(copy),
    )
    assertEquals(denied.status, 403)
  })
})

Deno.test('clients-consent-send copy: the PDF unreadable (or not a PDF) → 500, reported with ids only, nothing sent', async () => {
  await run(async () => {
    for (
      const download of [
        () => ({ data: null, error: { message: 'Object not found' } }),
        () => ({ data: new Blob([new TextEncoder().encode('<html>')]) }),
      ] as StorageRoute[]
    ) {
      const s = setup({ download })
      let res: Response | null = null
      const logged = await captureConsole('error', async () => {
        res = await s.handler(post(copy))
      })
      assertEquals(res!.status, 500)
      assertEquals(s.http.calls, [])
      const text = logged.join('\n')
      assert(text.includes('copy_file_unavailable'))
      assert(!text.includes(PATH) && !text.includes('exemple.test'))
    }
  })
})

Deno.test('clients-consent-send copy: every email failed → not recorded; one sent → recorded', async () => {
  await run(async () => {
    const none = setup({ mailpitStatus: () => 500 })
    let answer: Record<string, unknown> = {}
    await captureConsole('error', async () => {
      answer = await (await none.handler(post(copy))).json()
    })
    assertEquals(answer.copy_sent_at, null)
    assert(
      !none.service.calls.some((c) =>
        c.fn === 'mark_client_consent_copy_sent_for_service'
      ),
    )
    const one = setup({
      mailpitStatus: (to) => to.startsWith('nadia') ? 500 : 200,
    })
    await captureConsole('error', async () => {
      answer = await (await one.handler(post(copy))).json()
    })
    assertEquals(answer.copy_sent_at, '2026-10-13T15:00:00Z')
    assertEquals(
      (answer.recipients as { sent: boolean }[]).map((r) => r.sent),
      [true, false],
    )
  })
})

Deno.test('clients-consent-send copy: the body is strict', async () => {
  await run(async () => {
    const s = setup()
    assertEquals((await s.handler(post({ ...copy, extra: 1 }))).status, 400)
    assertEquals(
      (await s.handler(post({ action: 'copy', consent_id: 'nope' }))).status,
      400,
    )
    assertEquals(s.service.calls, [])
  })
})

Deno.test("copyFilename: the consent's name in safe characters, « (signé) » / « (signed) »", () => {
  assertEquals(
    copyFilename('Consentement – liste d’attente', 'fr'),
    'Consentement liste d’attente (signé).pdf',
  )
  assertEquals(
    copyFilename('« PAE » externe', 'en'),
    'PAE externe (signed).pdf',
  )
  assertEquals(copyFilename('***', 'fr'), 'Consentement (signé).pdf')
  assert(copyFilename('x'.repeat(200), 'fr').length <= 100)
})
