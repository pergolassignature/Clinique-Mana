import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  type EmailDeps,
  parseEmailContext,
  sendTemplatedEmail,
  type SendTemplatedEmailInput,
} from './send.ts'
import { FunctionError } from '../errors.ts'
import { fakeFetch, type Responder } from '../testing/fake-fetch.ts'
import {
  type FakeResult,
  fakeSupabase,
  type RpcRoute,
} from '../testing/fake-supabase.ts'
import { captureConsole, withEnv } from '../testing/env.ts'

const ORG = '0b5e6c1a-1111-4aaa-8bbb-000000000001'
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const PROFILE = '7a2d3e4f-2222-4ccc-8ddd-000000000002'
const CALLER = '8b3e4f5a-3333-4eee-8fff-000000000003'
const INVITATION = '9c4f5a6b-4444-4aaa-8bbb-000000000004'
const ADDRESS = 'ana.gagnon@example.com'
const RESEND = 'POST https://api.resend.com/emails'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV = { INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret' }

/** The assumed `get_email_context` JSON (Task 3.6), for core.staff_invite. */
function context(over: {
  template?: Record<string, unknown>
  [key: string]: unknown
} = {}) {
  const { template, ...rest } = over
  return {
    module_key: 'core',
    module_enabled: true,
    timezone: 'America/Toronto',
    template: {
      key: 'core.staff_invite',
      version: 2,
      subject: 'Votre accès à {{clinic.name}}',
      body:
        'Bonjour {{invitee.display_name}},\n\n{{inviter.display_name}} vous invite. Valide jusqu’au {{invitation.expires_at}}.',
      button_label: 'Créer mon accès',
      why_line:
        'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.',
      variables: [
        {
          path: 'invitee.display_name',
          label: 'Personne invitée',
          sample: 'Ana Gagnon',
          required: true,
          kind: 'text',
        },
        {
          path: 'inviter.display_name',
          label: 'Personne qui invite',
          sample: 'Christine Tremblay',
          required: true,
          kind: 'text',
        },
        {
          path: 'clinic.name',
          label: 'Nom de la clinique',
          sample: 'Clinique MANA',
          required: true,
          kind: 'text',
        },
        {
          path: 'invitation.expires_at',
          label: 'Expiration',
          sample: '15 octobre 2026 à 14 h 30',
          required: true,
          kind: 'datetime',
        },
      ],
      view_permission: 'users.view',
      recipient_mode: 'subject',
      allows_attachments: false,
      ...template,
    },
    sender: {
      from_name: 'Clinique MANA',
      from_address: 'no-reply@gestion.cliniquemana.com',
      reply_to: 'info@cliniquemana.com',
    },
    clinic: {
      name: 'Clinique MANA',
      address_line1: '123, rue Saint-Denis',
      address_line2: null,
      city: 'Montréal',
      province: 'QC',
      postal_code: 'H2X 1Y4',
      phone: '+15145551234',
      website: 'https://cliniquemana.com',
      privacy_officer_name: 'Christine Tremblay',
      privacy_officer_email: 'confidentialite@cliniquemana.com',
    },
    ...rest,
  }
}

const values = {
  invitee: { display_name: 'Ana Gagnon' },
  inviter: { display_name: 'Christine Tremblay' },
  clinic: { name: 'Clinique MANA' },
  invitation: { expires_at: '2026-10-15T18:30:00Z' },
}

const input = (
  over: Partial<SendTemplatedEmailInput> = {},
): SendTemplatedEmailInput => ({
  orgId: ORG,
  templateKey: 'core.staff_invite',
  to: { email: ADDRESS, profileId: PROFILE },
  subject: { type: 'staff_invitation', id: INVITATION },
  values,
  actionUrl: 'https://app.cliniquemana.com/invitation#t=abc',
  sentBy: CALLER,
  ...over,
})

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), { status })

/** A minimal complete PDF (sniffed as `pdf`). */
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')

interface Options {
  env?: Record<string, string>
  context?: unknown
  secret?: string | null
  /** Per bucket: `hits` and `allowed` of the consume_rate_limit row. */
  limits?: Record<string, { allowed?: boolean; hits?: number } | 'error'>
  resend?: Responder | Responder[]
  rpc?: Record<string, RpcRoute>
}

/**
 * Fake service client + fetch with one shared event log, so the test sees the
 * order of RPCs and HTTP calls. Each RPC logs `>name` when called and `<name`
 * when it resolves (a few ms later, longer than hashing a rate-limit key), so
 * `steps(log)` shows which calls overlapped.
 */
function harness(opts: Options = {}) {
  const log: string[] = []
  const timed = (
    name: string,
    result: (args: Record<string, unknown>) => FakeResult,
  ): RpcRoute =>
  async (args) => {
    const label = name === 'consume_rate_limit'
      ? `${name}:${args.p_bucket}`
      : name
    log.push(`>${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
    log.push(`<${label}`)
    return result(args)
  }
  const limits = opts.limits ?? {}
  const supabase = fakeSupabase({
    rpc: {
      get_email_context: timed(
        'get_email_context',
        () => ({ data: opts.context ?? context() }),
      ),
      get_org_secret: timed('get_org_secret', () => ({
        data: opts.secret === undefined
          ? 'local-dev-resend-api-key'
          : opts.secret,
      })),
      consume_rate_limit: timed('consume_rate_limit', (args) => {
        const limit = limits[String(args.p_bucket)]
        if (limit === 'error') return { error: { code: 'XX000' } }
        return {
          data: [{
            allowed: limit?.allowed ?? true,
            hits: limit?.hits ?? 1,
            retry_after_seconds: limit?.allowed === false ? 42 : 0,
          }],
        }
      }),
      queue_email: timed('queue_email', () => ({ data: LOG_ID })),
      mark_email_sent: timed('mark_email_sent', () => ({ data: null })),
      mark_email_failed: timed('mark_email_failed', () => ({ data: null })),
      ...opts.rpc,
    },
  })
  const resend = opts.resend ?? json(200, { id: 're_123' })
  const respond = (r: Responder): Responder => (req) => {
    log.push('fetch')
    return r(req)
  }
  const http = fakeFetch({
    [RESEND]: Array.isArray(resend) ? resend.map(respond) : respond(resend),
    [MAILPIT]: respond(json(200, { ID: 'mp-1' })),
  })
  const vars: Record<string, string> = {
    EMAIL_TRANSPORT: 'resend',
    APP_URL: 'https://app.cliniquemana.com',
    ...opts.env,
  }
  const deps: EmailDeps = {
    fn: 'test-fn',
    client: supabase.client,
    env: (key) => vars[key],
    fetch: http.fetch,
    sleep: () => Promise.resolve(),
  }
  const rpcNames = () => supabase.calls.map((c) => c.fn)
  const argsOf = (fn: string) => supabase.calls.find((c) => c.fn === fn)?.args
  /** The buckets consumed, sorted: the limits run in parallel, in no set order. */
  const buckets = () =>
    supabase.calls.filter((c) => c.fn === 'consume_rate_limit').map((c) =>
      String(c.args.p_bucket)
    ).sort()
  return { deps, log, supabase, http, rpcNames, argsOf, buckets }
}

/**
 * The log as steps: calls that overlapped (ran in parallel) form one step,
 * sorted by name; a sequential call is a step of its own.
 */
function steps(log: string[]): string[][] {
  const out: string[][] = []
  const open = new Set<string>()
  let step: string[] = []
  for (const event of log) {
    if (event.startsWith('>')) {
      open.add(event.slice(1))
      step.push(event.slice(1))
    } else if (event.startsWith('<')) open.delete(event.slice(1))
    else step.push(event)
    if (open.size === 0) {
      out.push(step.sort())
      step = []
    }
  }
  return out
}

/** Runs fn with the rate-limit secret set and the console captured. */
async function run<T>(fn: () => Promise<T>) {
  let result!: T
  const errors = await captureConsole('error', async () => {
    const warns = await captureConsole('warn', async () => {
      await withEnv(ENV, async () => {
        result = await fn()
      })
    })
    if (warns.length) throw new Error(`unexpected warnings: ${warns}`)
  })
  return { result, errors: errors.map((e) => String(e[0])) }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
Deno.test('send: context ∥ secret → 2 limits ∥ → queue → Resend → mark sent', async () => {
  const h = harness()
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(errors, [])
  assertEquals(steps(h.log), [
    ['get_email_context', 'get_org_secret'],
    [
      'consume_rate_limit:emails.org_day',
      'consume_rate_limit:emails.same_address',
    ],
    ['queue_email'],
    ['fetch'],
    ['mark_email_sent'],
  ])
  assertEquals(h.argsOf('get_email_context'), {
    p_org_id: ORG,
    p_template_key: 'core.staff_invite',
  })
  assertEquals(h.argsOf('get_org_secret'), {
    p_org_id: ORG,
    p_key: 'resend_api_key',
  })
  assertEquals(h.argsOf('queue_email'), {
    p_org_id: ORG,
    p_template_key: 'core.staff_invite',
    p_template_version: 2,
    p_to_email: ADDRESS,
    p_to_profile_id: PROFILE,
    p_subject_type: 'staff_invitation',
    p_subject_id: INVITATION,
    p_view_permission: 'users.view',
    p_sent_by: CALLER,
    p_attachment_count: 0,
  })
  assertEquals(h.argsOf('mark_email_sent'), {
    p_id: LOG_ID,
    p_resend_id: 're_123',
    p_attempts: 1,
  })
})

Deno.test('send: the Resend request (key, idempotency key = log id, tag, rendered parts)', async () => {
  const h = harness()
  await run(() => sendTemplatedEmail(h.deps, input()))
  const [call] = h.http.calls
  assertEquals(
    call.headers.get('authorization'),
    'Bearer local-dev-resend-api-key',
  )
  assertEquals(call.headers.get('idempotency-key'), LOG_ID)
  const body = JSON.parse(call.body)
  assertEquals(body.to, [ADDRESS])
  assertEquals(body.from, '"Clinique MANA" <no-reply@gestion.cliniquemana.com>')
  assertEquals(body.reply_to, 'info@cliniquemana.com')
  assertEquals(body.subject, 'Votre accès à Clinique MANA')
  assertEquals(body.tags, [{ name: 'email_log_id', value: LOG_ID }])
  assertStringIncludes(
    body.html,
    'href="https://app.cliniquemana.com/invitation#t=abc"',
  )
  assertStringIncludes(body.text, '15 octobre 2026 à 14 h 30')
})

Deno.test('send: Mailpit needs no API key (no get_org_secret call)', async () => {
  const h = harness({
    env: {
      EMAIL_TRANSPORT: 'mailpit',
      MAILPIT_URL: 'http://mailpit.test:8025',
    },
  })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertFalse(h.rpcNames().includes('get_org_secret'))
  assertEquals(h.argsOf('mark_email_sent')?.p_resend_id, 'mp-1')
})

// ---------------------------------------------------------------------------
// Configuration and gates (nothing queued)
// ---------------------------------------------------------------------------
Deno.test('send: no resend_api_key with EMAIL_TRANSPORT=resend → not_configured, nothing queued', async () => {
  const h = harness({ secret: null })
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, { ok: false, emailLogId: null, code: 'not_configured' })
  assertEquals(h.rpcNames(), ['get_email_context', 'get_org_secret'])
  assertEquals(h.http.calls.length, 0)
  assertEquals(errors.length, 1)
  assertStringIncludes(errors[0], 'resend_api_key_missing')
})

Deno.test('send: an unknown EMAIL_TRANSPORT or a missing APP_URL → not_configured before any RPC', async () => {
  for (
    const env of [
      { EMAIL_TRANSPORT: 'smtp' },
      { APP_URL: '' },
      { APP_URL: 'ftp://x' },
    ] as Record<string, string>[]
  ) {
    const h = harness({ env })
    const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
    assertEquals(result, {
      ok: false,
      emailLogId: null,
      code: 'not_configured',
    })
    assertEquals(h.rpcNames(), [])
  }
})

Deno.test('send: the module is disabled → module_disabled, no limit, no queue', async () => {
  const h = harness({ context: context({ module_enabled: false }) })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result, { ok: false, emailLogId: null, code: 'module_disabled' })
  assertEquals(h.rpcNames(), ['get_email_context', 'get_org_secret'])
  assertEquals(h.http.calls.length, 0)
})

Deno.test('send: a free recipient on a `subject` template → recipient_not_allowed', async () => {
  const h = harness()
  const { result } = await run(() =>
    sendTemplatedEmail(h.deps, input({ freeRecipient: true }))
  )
  assertEquals(result, {
    ok: false,
    emailLogId: null,
    code: 'recipient_not_allowed',
  })
  assertFalse(h.rpcNames().includes('queue_email'))
})

Deno.test('send: a free recipient needs a sender; on a `free` template it uses its own limit', async () => {
  const free = context({ template: { recipient_mode: 'free' } })
  const anonymous = harness({ context: free })
  assertEquals(
    (await run(() =>
      sendTemplatedEmail(
        anonymous.deps,
        input({ freeRecipient: true, sentBy: null }),
      )
    )).result,
    { ok: false, emailLogId: null, code: 'recipient_not_allowed' },
  )
  const h = harness({ context: free })
  const { result } = await run(() =>
    sendTemplatedEmail(h.deps, input({ freeRecipient: true }))
  )
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(h.buckets(), [
    'emails.free_recipient',
    'emails.org_day',
    'emails.same_address',
  ])
})

Deno.test('send: a `free` template called without the flag still needs a sender and uses the free bucket', async () => {
  const free = context({ template: { recipient_mode: 'free' } })
  const anonymous = harness({ context: free })
  assertEquals(
    (await run(() =>
      sendTemplatedEmail(anonymous.deps, input({ sentBy: null }))
    )).result,
    { ok: false, emailLogId: null, code: 'recipient_not_allowed' },
  )
  assertFalse(anonymous.rpcNames().includes('consume_rate_limit'))

  const h = harness({ context: free })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(h.buckets(), [
    'emails.free_recipient',
    'emails.org_day',
    'emails.same_address',
  ])

  const limited = harness({
    context: free,
    limits: { 'emails.free_recipient': { allowed: false, hits: 21 } },
  })
  const refused = await run(() =>
    sendTemplatedEmail(limited.deps, input({ freeRecipient: false }))
  )
  assertEquals(!refused.result.ok && refused.result.code, 'rate_limited')
  assertFalse(limited.rpcNames().includes('queue_email'))
})

Deno.test('send: an address that is not exactly one mailbox → invalid_recipient, nothing queued', async () => {
  for (
    const email of [
      'ana@example.com, eve@evil.test',
      'Ana <ana@example.com>',
      'ana@example',
      'ana@exa mple.com',
      'ana@example.com\r\nBcc: eve@evil.test',
      `${'a'.repeat(250)}@example.com`,
      '',
      // A zero-width space, a right-to-left override, a Cyrillic homograph
      // (`а` U+0430 in the domain), and a non-ASCII domain.
      'ana\u200b@example.com',
      'ana@example.com\u200b',
      '\u202eana@example.com',
      'ana@ex\u0430mple.com',
      'ana@exemple.québec',
      'ana@-example.com',
      'ana@example..com',
    ]
  ) {
    const h = harness()
    const { result } = await run(() =>
      sendTemplatedEmail(h.deps, input({ to: { email, profileId: null } }))
    )
    assertEquals(result, {
      ok: false,
      emailLogId: null,
      code: 'invalid_recipient',
    })
    assertFalse(h.rpcNames().includes('consume_rate_limit'))
  }
})

Deno.test('send: an ASCII or punycode domain is accepted', async () => {
  for (
    const email of [
      'ana@xn--exemple-qva.ca',
      'ana@exemple.xn--qubec-csa',
      'ana+test@sous-domaine.example.ca',
    ]
  ) {
    const h = harness()
    const { result } = await run(() =>
      sendTemplatedEmail(h.deps, input({ to: { email, profileId: null } }))
    )
    assertEquals(result, { ok: true, emailLogId: LOG_ID }, email)
  }
})

Deno.test('send: an invalid sender from_address or reply_to → not_configured, reported sender_invalid with ids only', async () => {
  const sender = (over: Record<string, unknown>) =>
    context({
      sender: {
        from_name: 'Clinique MANA',
        from_address: 'no-reply@gestion.cliniquemana.com',
        reply_to: 'info@cliniquemana.com',
        ...over,
      },
    })
  for (
    const over of [
      { from_address: 'no-reply@x.ca, eve@evil.test' },
      { from_address: 'Clinique <no-reply@x.ca>' },
      { from_address: 'no-reply@x.ca\r\nBcc: eve@evil.test' },
      { reply_to: 'info@x.ca, eve@evil.test' },
      { reply_to: '' },
      { reply_to: 'info\u200b@x.ca' },
    ]
  ) {
    const h = harness({ context: sender(over) })
    const { result, errors } = await run(() =>
      sendTemplatedEmail(h.deps, input())
    )
    assertEquals(result, {
      ok: false,
      emailLogId: null,
      code: 'not_configured',
    })
    assertEquals(errors.map((e) => JSON.parse(e)), [{
      fn: 'test-fn',
      code: 'sender_invalid',
      ids: { org_id: ORG },
    }])
    assertFalse(h.rpcNames().includes('consume_rate_limit'))
    assertEquals(h.http.calls.length, 0)
  }
  const none = harness({ context: sender({ reply_to: null }) })
  assertEquals(
    (await run(() => sendTemplatedEmail(none.deps, input()))).result,
    { ok: true, emailLogId: LOG_ID },
  )
})

Deno.test('send: EMAIL_TRANSPORT=console needs a local APP_URL (else server_misconfigured, before any RPC)', async () => {
  const h = harness({ env: { EMAIL_TRANSPORT: 'console' } })
  const errors = await captureConsole('error', async () => {
    await withEnv(ENV, async () => {
      const error = await assertRejects(
        () => sendTemplatedEmail(h.deps, input()),
        FunctionError,
      )
      assertEquals(error.code, 'server_misconfigured')
    })
  })
  assertStringIncludes(String(errors[0][0]), 'email_console_not_local')
  assertEquals(h.rpcNames(), [])

  const local = harness({
    env: { EMAIL_TRANSPORT: 'console', APP_URL: 'http://localhost:5173' },
  })
  let result: unknown
  await captureConsole('info', async () => {
    result = (await run(() => sendTemplatedEmail(local.deps, input()))).result
  })
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(
    local.argsOf('mark_email_sent')?.p_resend_id,
    `console:${LOG_ID}`,
  )
})

// ---------------------------------------------------------------------------
// Attachments (P3-18)
// ---------------------------------------------------------------------------
const pdf = (
  over: Partial<{ filename: string; content: Uint8Array }> = {},
) => ({
  filename: 'fiche.pdf',
  content: PDF,
  contentType: 'application/pdf' as const,
  ...over,
})
const withAttachments = context({ template: { allows_attachments: true } })

Deno.test('send: attachments on a template that does not allow them → attachment_not_allowed', async () => {
  const h = harness()
  const { result } = await run(() =>
    sendTemplatedEmail(h.deps, input({ attachments: [pdf()] }))
  )
  assertEquals(result, {
    ok: false,
    emailLogId: null,
    code: 'attachment_not_allowed',
  })
  assertFalse(h.rpcNames().includes('queue_email'))
})

Deno.test('send: a non-PDF, a 4th file, over 10 MB, or an unsafe file name → attachment_not_allowed', async () => {
  const big = new Uint8Array(10 * 1024 * 1024 + 1)
  big.set(PDF.subarray(0, 9))
  big.set(new TextEncoder().encode('%%EOF'), big.length - 5)
  const cases = [
    [pdf({ content: new TextEncoder().encode('<html>%PDF-1.7 %%EOF') })],
    [pdf({ content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })],
    [pdf(), pdf(), pdf(), pdf()],
    [pdf({ content: big })],
    [pdf({ filename: '../etc/passwd.pdf' })],
    [pdf({ filename: 'fiche.exe' })],
    [pdf({ filename: 'fiche\r\n.pdf' })],
  ]
  for (const attachments of cases) {
    const h = harness({ context: withAttachments })
    const { result } = await run(() =>
      sendTemplatedEmail(h.deps, input({ attachments }))
    )
    assertEquals(result, {
      ok: false,
      emailLogId: null,
      code: 'attachment_not_allowed',
    })
    assertFalse(h.rpcNames().includes('consume_rate_limit'))
  }
})

Deno.test('send: up to 3 PDFs are sent and counted on the log row', async () => {
  const h = harness({ context: withAttachments })
  const { result } = await run(() =>
    sendTemplatedEmail(
      h.deps,
      input({
        attachments: [pdf(), pdf({ filename: 'Fiche d’Ana (2).pdf' }), pdf()],
      }),
    )
  )
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(h.argsOf('queue_email')?.p_attachment_count, 3)
  assertEquals(JSON.parse(h.http.calls[0].body).attachments.length, 3)
})

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------
Deno.test('send: the same address within 60 s → rate_limited, unless explicitResend', async () => {
  const limited = { 'emails.same_address': { allowed: false, hits: 2 } }
  const h = harness({ limits: limited })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result, {
    ok: false,
    emailLogId: null,
    code: 'rate_limited',
    retryAfter: 42,
  })
  assertFalse(h.rpcNames().includes('queue_email'))
  assertEquals(h.http.calls.length, 0)

  const resend = harness({ limits: limited })
  const again = await run(() =>
    sendTemplatedEmail(resend.deps, input({ explicitResend: true }))
  )
  assertEquals(again.result, { ok: true, emailLogId: LOG_ID })
  assertEquals(resend.buckets(), ['emails.org_day', 'emails.repeat_guard'])
})

Deno.test('send: a double click on « Renvoyer » or a test send → rate_limited by the 5 s repeat guard', async () => {
  const guarded = { 'emails.repeat_guard': { allowed: false, hits: 2 } }
  for (
    const over of [
      { explicitResend: true },
      { values: {}, test: { callerId: CALLER } },
    ] as Partial<SendTemplatedEmailInput>[]
  ) {
    const h = harness({ limits: guarded })
    const { result } = await run(() => sendTemplatedEmail(h.deps, input(over)))
    assertEquals(result, {
      ok: false,
      emailLogId: null,
      code: 'rate_limited',
      retryAfter: 42,
    })
    assertFalse(h.rpcNames().includes('queue_email'))
    assertEquals(h.http.calls.length, 0)
  }
})

Deno.test('send: the repeat-guard key is per template, lower-cased address and sender', async () => {
  const keyOf = async (over: Partial<SendTemplatedEmailInput>) => {
    const h = harness()
    await run(() =>
      sendTemplatedEmail(h.deps, input({ explicitResend: true, ...over }))
    )
    return h.supabase.calls.find((c) =>
      c.fn === 'consume_rate_limit' && c.args.p_bucket === 'emails.repeat_guard'
    )?.args.p_key_hash
  }
  const base = await keyOf({})
  assert(base)
  assertEquals(
    await keyOf({ to: { email: 'ANA.Gagnon@example.com', profileId: null } }),
    base,
  )
  assertFalse((await keyOf({ sentBy: PROFILE })) === base)
  assertFalse(
    (await keyOf({ to: { email: 'eve@example.com', profileId: null } })) ===
      base,
  )
})

Deno.test('send: the same-address key is per org, template and lower-cased address', async () => {
  const a = harness()
  const b = harness()
  await run(() => sendTemplatedEmail(a.deps, input()))
  await run(() =>
    sendTemplatedEmail(
      b.deps,
      input({ to: { email: 'Ana.Gagnon@Example.com', profileId: null } }),
    )
  )
  const key = (h: ReturnType<typeof harness>) =>
    h.supabase.calls.find((c) =>
      c.fn === 'consume_rate_limit' && c.args.p_bucket === 'emails.same_address'
    )?.args.p_key_hash
  assert(key(a))
  assertEquals(key(a), key(b))
})

Deno.test('send: the org day limit refuses the 501st send', async () => {
  const h = harness({
    limits: { 'emails.org_day': { allowed: false, hits: 501 } },
  })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result.ok, false)
  assertEquals(!result.ok && result.code, 'rate_limited')
})

Deno.test('send: the 401st send of the day reports the 80 % warning once', async () => {
  const at401 = harness({ limits: { 'emails.org_day': { hits: 401 } } })
  const first = await run(() => sendTemplatedEmail(at401.deps, input()))
  assertEquals(first.result, { ok: true, emailLogId: LOG_ID })
  assertEquals(first.errors.length, 1)
  assertEquals(JSON.parse(first.errors[0]), {
    fn: 'test-fn',
    code: 'email_daily_80_percent',
    ids: { org_id: ORG },
  })
  for (const hits of [400, 402]) {
    const h = harness({ limits: { 'emails.org_day': { hits } } })
    assertEquals(
      (await run(() => sendTemplatedEmail(h.deps, input()))).errors,
      [],
    )
  }
})

Deno.test('send: a limiter failure fails closed → not_configured', async () => {
  const h = harness({ limits: { 'emails.same_address': 'error' } })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result, { ok: false, emailLogId: null, code: 'not_configured' })
  assertFalse(h.rpcNames().includes('queue_email'))
})

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------
Deno.test('send: a missing required variable → missing_variable, no queue, no fetch', async () => {
  const h = harness()
  const { result } = await run(() =>
    sendTemplatedEmail(h.deps, input({ values: { ...values, invitee: {} } }))
  )
  assertEquals(result, {
    ok: false,
    emailLogId: null,
    code: 'missing_variable',
    path: 'invitee.display_name',
  })
  assertFalse(h.rpcNames().includes('queue_email'))
  assertEquals(h.http.calls.length, 0)
})

Deno.test('send: compose runs before the limits (a template error uses up no slot)', async () => {
  for (
    const opts of [
      {
        context: context({
          template: { body: 'Bonjour {{invitee.nickname}}' },
        }),
      },
      {},
    ] as Options[]
  ) {
    const h = harness(opts)
    const { result } = await run(() =>
      sendTemplatedEmail(
        h.deps,
        input({ values: { ...values, invitee: {} }, explicitResend: true }),
      )
    )
    assertEquals(!result.ok && result.code, 'missing_variable')
    assertEquals(h.buckets(), [])
  }
})

Deno.test('send: an unknown placeholder is reported as missing_variable', async () => {
  const h = harness({
    context: context({ template: { body: 'Bonjour {{invitee.nickname}}' } }),
  })
  const { result } = await run(() => sendTemplatedEmail(h.deps, input()))
  assertEquals(result, {
    ok: false,
    emailLogId: null,
    code: 'missing_variable',
    path: 'invitee.nickname',
  })
})

Deno.test('send: an invalid clinic timezone throws server_misconfigured, nothing queued', async () => {
  const h = harness({ context: context({ timezone: 'Mars/Olympus' }) })
  const errors = await captureConsole('error', async () => {
    await withEnv(ENV, async () => {
      const error = await assertRejects(
        () => sendTemplatedEmail(h.deps, input()),
        FunctionError,
      )
      assertEquals(error.code, 'server_misconfigured')
    })
  })
  assertStringIncludes(String(errors[0][0]), 'email_timezone_invalid')
  assertFalse(h.rpcNames().includes('queue_email'))
})

Deno.test('send: an RPC error or a malformed context throws internal (reported, nothing sent)', async () => {
  for (
    const route of [
      { error: { code: '22023', message: 'unknown template' } },
      { data: { module_enabled: true } },
    ] as FakeResult[]
  ) {
    const h = harness({ rpc: { get_email_context: route } })
    const errors = await captureConsole('error', async () => {
      await withEnv(ENV, async () => {
        const error = await assertRejects(
          () => sendTemplatedEmail(h.deps, input()),
          FunctionError,
        )
        assertEquals(error.code, 'internal')
      })
    })
    assertEquals(errors.length, 1)
    assertEquals(h.http.calls.length, 0)
  }
})

// ---------------------------------------------------------------------------
// Test mode
// ---------------------------------------------------------------------------
Deno.test('send: test mode → « [Test] » subject, sample values, the test limit instead of same-address', async () => {
  const h = harness()
  const { result } = await run(() =>
    sendTemplatedEmail(
      h.deps,
      input({
        to: { email: 'christine@cliniquemana.com', profileId: CALLER },
        subject: { type: 'email_test', id: CALLER },
        values: {},
        actionUrl: null,
        test: { callerId: CALLER },
      }),
    )
  )
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  const body = JSON.parse(h.http.calls[0].body)
  assertEquals(body.subject, '[Test] Votre accès à Clinique MANA')
  assertStringIncludes(body.text, 'Bonjour Ana Gagnon,')
  assertStringIncludes(body.text, '15 octobre 2026 à 14 h 30')
  assertEquals(body.to, ['christine@cliniquemana.com'])
  assertEquals(h.buckets(), [
    'emails.org_day',
    'emails.repeat_guard',
    'emails.test',
  ])
})

Deno.test('send: test mode renders the draft text when given', async () => {
  const h = harness()
  await run(() =>
    sendTemplatedEmail(
      h.deps,
      input({
        values: {},
        actionUrl: null,
        test: {
          callerId: CALLER,
          draft: {
            subject: 'Brouillon {{clinic.name}}',
            body: 'Nouveau texte',
            buttonLabel: null,
          },
        },
      }),
    )
  )
  const body = JSON.parse(h.http.calls[0].body)
  assertEquals(body.subject, '[Test] Brouillon Clinique MANA')
  assertStringIncludes(body.text, 'Nouveau texte')
})

Deno.test('send: the 11th test send in an hour → rate_limited', async () => {
  const h = harness({ limits: { 'emails.test': { allowed: false, hits: 11 } } })
  const { result } = await run(() =>
    sendTemplatedEmail(
      h.deps,
      input({ values: {}, test: { callerId: CALLER } }),
    )
  )
  assertEquals(!result.ok && result.code, 'rate_limited')
})

// ---------------------------------------------------------------------------
// Provider outcomes
// ---------------------------------------------------------------------------
Deno.test('send: Resend 500 three times → mark_email_failed(provider_unavailable), provider_error', async () => {
  const h = harness({ resend: [json(500, {}), json(500, {}), json(500, {})] })
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, {
    ok: false,
    emailLogId: LOG_ID,
    code: 'provider_error',
  })
  assertEquals(h.http.calls.length, 3)
  assertEquals(h.argsOf('mark_email_failed'), {
    p_id: LOG_ID,
    p_error_code: 'provider_unavailable',
    p_attempts: 3,
  })
  assertFalse(h.rpcNames().includes('mark_email_sent'))
  assertEquals(errors.map((e) => JSON.parse(e)), [{
    fn: 'test-fn',
    code: 'resend_500',
    ids: { org_id: ORG, email_log_id: LOG_ID },
  }])
})

Deno.test('send: network errors on every attempt → marked failed(provider_unavailable = outcome unknown), reported resend_network_error', async () => {
  const reset: Responder = () => {
    throw new TypeError('connection reset')
  }
  const h = harness({ resend: [reset, reset, reset] })
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, {
    ok: false,
    emailLogId: LOG_ID,
    code: 'provider_error',
  })
  assertEquals(h.argsOf('mark_email_failed'), {
    p_id: LOG_ID,
    p_error_code: 'provider_unavailable',
    p_attempts: 3,
  })
  assertEquals(JSON.parse(errors[0]).code, 'resend_network_error')
})

Deno.test('send: a Resend daily quota 429 → one attempt, failed(provider_rate_limited), reported by name', async () => {
  const h = harness({ resend: json(429, { name: 'daily_quota_exceeded' }) })
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, {
    ok: false,
    emailLogId: LOG_ID,
    code: 'provider_error',
  })
  assertEquals(h.http.calls.length, 1)
  assertEquals(h.argsOf('mark_email_failed'), {
    p_id: LOG_ID,
    p_error_code: 'provider_rate_limited',
    p_attempts: 1,
  })
  assertEquals(JSON.parse(errors[0]).code, 'resend_daily_quota_exceeded')
})

Deno.test('send: the caller aborting mid-flight lets the attempt finish → marked sent, ok', async () => {
  const controller = new AbortController()
  const h = harness({
    resend: async (req) => {
      controller.abort()
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (req.signal.aborted) throw req.signal.reason
      return new Response(JSON.stringify({ id: 're_123' }), { status: 200 })
    },
  })
  const { result } = await run(() =>
    sendTemplatedEmail({ ...h.deps, signal: controller.signal }, input())
  )
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(h.argsOf('mark_email_sent')?.p_resend_id, 're_123')
  assertFalse(h.rpcNames().includes('mark_email_failed'))
})

Deno.test('send: a signal already aborted before queueing → no row, nothing sent', async () => {
  const h = harness()
  const { result } = await run(() =>
    sendTemplatedEmail({ ...h.deps, signal: AbortSignal.abort() }, input())
  )
  assertEquals(result, { ok: false, emailLogId: null, code: 'provider_error' })
  assertFalse(h.rpcNames().includes('queue_email'))
  assertEquals(h.http.calls.length, 0)
})

Deno.test('send: Resend refusing the address → invalid_recipient, marked failed', async () => {
  const h = harness({
    resend: json(422, {
      name: 'validation_error',
      message: `Invalid \`to\` field: ${ADDRESS}`,
    }),
  })
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, {
    ok: false,
    emailLogId: LOG_ID,
    code: 'invalid_recipient',
  })
  assertEquals(h.argsOf('mark_email_failed')?.p_error_code, 'invalid_recipient')
  assertFalse(errors.join('').includes(ADDRESS))
})

Deno.test('send: a failed mark_email_sent still answers ok (the email left; reported)', async () => {
  const h = harness({ rpc: { mark_email_sent: { error: { code: '40001' } } } })
  const { result, errors } = await run(() =>
    sendTemplatedEmail(h.deps, input())
  )
  assertEquals(result, { ok: true, emailLogId: LOG_ID })
  assertEquals(JSON.parse(errors[0]).code, 'email_mark_failed')
})

Deno.test('send: a queue_email error or a non-uuid id throws internal before anything is sent', async () => {
  for (
    const route of [
      { error: { code: '23514' } },
      { data: 'not-a-uuid' },
    ] as FakeResult[]
  ) {
    const h = harness({ rpc: { queue_email: route } })
    await captureConsole('error', async () => {
      await withEnv(ENV, async () => {
        const error = await assertRejects(
          () => sendTemplatedEmail(h.deps, input()),
          FunctionError,
        )
        assertEquals(error.code, 'internal')
      })
    })
    assertEquals(h.http.calls.length, 0)
  }
})

Deno.test('send: no report or log line ever holds the address, the subject or the body', async () => {
  const outcomes: Options[] = [
    { resend: [json(500, {}), json(500, {}), json(500, {})] },
    { limits: { 'emails.org_day': { hits: 401 } } },
    { secret: null },
    { rpc: { mark_email_sent: { error: { code: '40001' } } } },
  ]
  for (const opts of outcomes) {
    const h = harness(opts)
    const { errors } = await run(() => sendTemplatedEmail(h.deps, input()))
    const text = errors.join('\n')
    for (const secret of [ADDRESS, 'Votre accès', 'Bonjour', 'Ana Gagnon']) {
      assertFalse(text.includes(secret), `${secret} leaked: ${text}`)
    }
  }
})

Deno.test('parseEmailContext: the compose input and the module gate, or null', () => {
  const parsed = parseEmailContext(context({ module_enabled: false }))
  assert(parsed)
  assertFalse(parsed.moduleEnabled)
  assertEquals(parsed.context.template.buttonLabel, 'Créer mon accès')
  assertEquals(parsed.context.clinic.postalCode, 'H2X 1Y4')
  assertEquals(parsed.context.timezone, 'America/Toronto')
  assertEquals(parseEmailContext({ module_enabled: true }), null)
})
