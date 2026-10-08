import { assert, assertEquals, assertFalse } from '@std/assert'
import {
  consoleTransport,
  mailpitTransport,
  type OutgoingEmail,
  resendTransport,
  transportFromEnv,
} from './transport.ts'
import { fakeFetch, type Responder } from '../testing/fake-fetch.ts'
import { captureConsole } from '../testing/env.ts'

const RESEND = 'POST https://api.resend.com/emails'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const KEY = 'local-dev-resend-api-key'
const LOG_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const ADDRESS = 'ana.gagnon@example.com'

const email = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  from: { name: 'Clinique MANA', email: 'no-reply@gestion.cliniquemana.com' },
  to: ADDRESS,
  replyTo: 'info@cliniquemana.com',
  subject: 'Votre accès à Clinique MANA',
  html: '<p>Bonjour</p>',
  text: 'Bonjour',
  idempotencyKey: LOG_ID,
  tags: [{ name: 'email_log_id', value: LOG_ID }],
  attachments: [],
  ...over,
})

const json = (status: number, body: unknown): Responder => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const accepted = json(200, { id: 're_123' })

/** A sleep double that records its delays and returns at once. */
function recordingSleep() {
  const delays: number[] = []
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------
Deno.test('resend: 429, 500, then 200 → ok after 3 attempts, sleeping 500 then 2000 ms', async () => {
  const { fetch, calls } = fakeFetch({
    [RESEND]: [
      json(429, { name: 'rate_limit_exceeded' }),
      json(500, {}),
      accepted,
    ],
  })
  const { delays, sleep } = recordingSleep()
  const result = await resendTransport(KEY, fetch, { sleep }).send(email())
  assertEquals(result, { ok: true, providerId: 're_123', attempts: 3 })
  assertEquals(delays, [500, 2_000])
  assertEquals(calls.length, 3)
})

Deno.test('resend: every attempt carries the same Idempotency-Key and the bearer key', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: [json(503, {}), accepted] })
  await resendTransport(KEY, fetch, recordingSleep()).send(email())
  assertEquals(calls.length, 2)
  for (const call of calls) {
    assertEquals(call.headers.get('idempotency-key'), LOG_ID)
    assertEquals(call.headers.get('authorization'), `Bearer ${KEY}`)
    assertEquals(call.headers.get('content-type'), 'application/json')
  }
})

Deno.test('resend: the request body (sender, recipient, reply-to, both parts, tag)', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: accepted })
  await resendTransport(KEY, fetch).send(email())
  assertEquals(JSON.parse(calls[0].body), {
    from: '"Clinique MANA" <no-reply@gestion.cliniquemana.com>',
    to: [ADDRESS],
    reply_to: 'info@cliniquemana.com',
    subject: 'Votre accès à Clinique MANA',
    html: '<p>Bonjour</p>',
    text: 'Bonjour',
    tags: [{ name: 'email_log_id', value: LOG_ID }],
  })
})

Deno.test('resend: no reply-to and no sender name are left out', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: accepted })
  await resendTransport(KEY, fetch).send(
    email({
      replyTo: null,
      from: { name: null, email: 'no-reply@gestion.cliniquemana.com' },
    }),
  )
  const body = JSON.parse(calls[0].body)
  assertEquals(body.from, 'no-reply@gestion.cliniquemana.com')
  assertFalse('reply_to' in body)
  assertFalse('attachments' in body)
})

Deno.test('resend: the sender name cannot break out of its quotes or add a header', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: accepted })
  await resendTransport(KEY, fetch).send(
    email({
      from: {
        name: 'Clinique "MANA" <x@evil.test>\r\nBcc: y@evil.test',
        email: 'no-reply@gestion.cliniquemana.com',
      },
    }),
  )
  assertEquals(
    JSON.parse(calls[0].body).from,
    '"Clinique MANA x@evil.test Bcc: y@evil.test" <no-reply@gestion.cliniquemana.com>',
  )
})

Deno.test('resend: an attachment is sent as base64 content with its file name', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: accepted })
  const content = new TextEncoder().encode('%PDF-1.7\n%%EOF')
  await resendTransport(KEY, fetch).send(
    email({
      attachments: [{
        filename: 'fiche.pdf',
        content,
        contentType: 'application/pdf',
      }],
    }),
  )
  assertEquals(JSON.parse(calls[0].body).attachments, [
    { filename: 'fiche.pdf', content: btoa('%PDF-1.7\n%%EOF') },
  ])
})

Deno.test('resend: base64 of a large attachment matches btoa', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: accepted })
  const content = new Uint8Array(100_003).map((_, i) => (i * 31) & 255)
  await resendTransport(KEY, fetch).send(
    email({
      attachments: [{
        filename: 'x.pdf',
        content,
        contentType: 'application/pdf',
      }],
    }),
  )
  let binary = ''
  for (const b of content) binary += String.fromCharCode(b)
  assertEquals(JSON.parse(calls[0].body).attachments[0].content, btoa(binary))
})

Deno.test('resend: a 400 is not retried → provider_rejected', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: json(400, { name: 'x' }) })
  const { delays, sleep } = recordingSleep()
  const result = await resendTransport(KEY, fetch, { sleep }).send(email())
  assertEquals(result, { ok: false, code: 'provider_rejected', attempts: 1 })
  assertEquals(calls.length, 1)
  assertEquals(delays, [])
})

Deno.test('resend: a 422 validation_error on `to` → invalid_recipient, not retried', async () => {
  const { fetch, calls } = fakeFetch({
    [RESEND]: json(422, {
      statusCode: 422,
      name: 'validation_error',
      message:
        'Invalid `to` field. The email address needs to follow the `email@example.com` format.',
    }),
  })
  const result = await resendTransport(KEY, fetch, recordingSleep()).send(
    email(),
  )
  assertEquals(result, { ok: false, code: 'invalid_recipient', attempts: 1 })
  assertEquals(calls.length, 1)
})

Deno.test('resend: a 422 on another field → provider_rejected', async () => {
  const { fetch } = fakeFetch({
    [RESEND]: json(422, {
      name: 'validation_error',
      message: 'Invalid `from` field.',
    }),
  })
  const result = await resendTransport(KEY, fetch).send(email())
  assertEquals(result, { ok: false, code: 'provider_rejected', attempts: 1 })
})

Deno.test('resend: a network error, then 200 → ok after 2 attempts', async () => {
  const { fetch } = fakeFetch({
    [RESEND]: [() => {
      throw new TypeError('connection reset')
    }, accepted],
  })
  const { delays, sleep } = recordingSleep()
  const result = await resendTransport(KEY, fetch, { sleep }).send(email())
  assertEquals(result, { ok: true, providerId: 're_123', attempts: 2 })
  assertEquals(delays, [500])
})

Deno.test('resend: three 5xx → provider_unavailable; three 429 → provider_rate_limited', async () => {
  const unavailable = fakeFetch({
    [RESEND]: [json(500, {}), json(502, {}), json(503, {})],
  })
  assertEquals(
    await resendTransport(KEY, unavailable.fetch, recordingSleep()).send(
      email(),
    ),
    { ok: false, code: 'provider_unavailable', attempts: 3 },
  )
  const limited = fakeFetch({
    [RESEND]: [json(429, {}), json(429, {}), json(429, {})],
  })
  assertEquals(
    await resendTransport(KEY, limited.fetch, recordingSleep()).send(email()),
    { ok: false, code: 'provider_rate_limited', attempts: 3 },
  )
})

Deno.test('resend: a 409 concurrent_idempotent_requests is retried (an earlier attempt is still in flight)', async () => {
  const { fetch } = fakeFetch({
    [RESEND]: [json(409, { name: 'concurrent_idempotent_requests' }), accepted],
  })
  const result = await resendTransport(KEY, fetch, recordingSleep()).send(
    email(),
  )
  assertEquals(result, { ok: true, providerId: 're_123', attempts: 2 })
})

Deno.test('resend: a 409 invalid_idempotent_request is not retried', async () => {
  const { fetch, calls } = fakeFetch({
    [RESEND]: json(409, { name: 'invalid_idempotent_request' }),
  })
  const result = await resendTransport(KEY, fetch, recordingSleep()).send(
    email(),
  )
  assertEquals(result, { ok: false, code: 'provider_rejected', attempts: 1 })
  assertEquals(calls.length, 1)
})

Deno.test('resend: a 200 without an id is retried like a lost answer', async () => {
  const { fetch } = fakeFetch({ [RESEND]: [json(200, {}), accepted] })
  const result = await resendTransport(KEY, fetch, recordingSleep()).send(
    email(),
  )
  assertEquals(result, { ok: true, providerId: 're_123', attempts: 2 })
})

Deno.test('resend: an attempt that hangs is cut by the timeout and retried', async () => {
  const hang: Responder = (req) =>
    new Promise((_, reject) =>
      req.signal.addEventListener('abort', () => reject(req.signal.reason))
    )
  const { fetch, calls } = fakeFetch({ [RESEND]: [hang, accepted] })
  const result = await resendTransport(KEY, fetch, {
    ...recordingSleep(),
    timeoutMs: 20,
  }).send(email())
  assertEquals(result, { ok: true, providerId: 're_123', attempts: 2 })
  assertEquals(calls.length, 2)
})

Deno.test('resend: an aborted caller signal stops the retries', async () => {
  const controller = new AbortController()
  const { fetch, calls } = fakeFetch({
    [RESEND]: () => {
      controller.abort()
      return new Response('{}', { status: 503 })
    },
  })
  const result = await resendTransport(KEY, fetch, recordingSleep()).send(
    email(),
    { signal: controller.signal },
  )
  assertEquals(result, { ok: false, code: 'provider_unavailable', attempts: 1 })
  assertEquals(calls.length, 1)
})

Deno.test('resend: an already aborted signal sends nothing', async () => {
  const { fetch, calls } = fakeFetch({ [RESEND]: accepted })
  const result = await resendTransport(KEY, fetch).send(email(), {
    signal: AbortSignal.abort(),
  })
  assertEquals(result, { ok: false, code: 'provider_unavailable', attempts: 0 })
  assertEquals(calls.length, 0)
})

Deno.test('resend: the provider answer is never returned or logged (it can quote the address)', async () => {
  const { fetch } = fakeFetch({
    [RESEND]: json(422, {
      name: 'validation_error',
      message: `Invalid \`to\` field: ${ADDRESS}`,
    }),
  })
  const logged: unknown[][] = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    logged.push(
      ...await captureConsole(level, async () => {
        const result = await resendTransport(KEY, fetch).send(email())
        assertFalse(JSON.stringify(result).includes(ADDRESS))
      }),
    )
  }
  assertFalse(JSON.stringify(logged).includes(ADDRESS))
})

// ---------------------------------------------------------------------------
// Mailpit
// ---------------------------------------------------------------------------
Deno.test('mailpit: the send API payload shape, and its ID as the provider id', async () => {
  const { fetch, calls } = fakeFetch({ [MAILPIT]: json(200, { ID: 'mp-1' }) })
  const content = new TextEncoder().encode('%PDF-1.7\n%%EOF')
  const result = await mailpitTransport('http://mailpit.test:8025/', fetch)
    .send(email({
      attachments: [{
        filename: 'fiche.pdf',
        content,
        contentType: 'application/pdf',
      }],
    }))
  assertEquals(result, { ok: true, providerId: 'mp-1', attempts: 1 })
  assertEquals(JSON.parse(calls[0].body), {
    From: {
      Email: 'no-reply@gestion.cliniquemana.com',
      Name: 'Clinique MANA',
    },
    To: [{ Email: ADDRESS }],
    ReplyTo: [{ Email: 'info@cliniquemana.com' }],
    Subject: 'Votre accès à Clinique MANA',
    HTML: '<p>Bonjour</p>',
    Text: 'Bonjour',
    Tags: [`email_log_id:${LOG_ID}`],
    Attachments: [{
      Filename: 'fiche.pdf',
      Content: btoa('%PDF-1.7\n%%EOF'),
      ContentType: 'application/pdf',
    }],
  })
})

Deno.test('mailpit: one attempt; 5xx → provider_unavailable, 4xx → provider_rejected', async () => {
  const down = fakeFetch({ [MAILPIT]: json(500, {}) })
  assertEquals(
    await mailpitTransport('http://mailpit.test:8025', down.fetch).send(
      email(),
    ),
    { ok: false, code: 'provider_unavailable', attempts: 1 },
  )
  assertEquals(down.calls.length, 1)
  const bad = fakeFetch({ [MAILPIT]: json(400, {}) })
  assertEquals(
    await mailpitTransport('http://mailpit.test:8025', bad.fetch).send(
      email(),
    ),
    { ok: false, code: 'provider_rejected', attempts: 1 },
  )
})

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------
Deno.test('console: logs the email_log id and the subject length only', async () => {
  let result: unknown
  const lines = await captureConsole('info', async () => {
    result = await consoleTransport().send(email())
  })
  assertEquals(result, {
    ok: true,
    providerId: `console:${LOG_ID}`,
    attempts: 1,
  })
  assertEquals(lines.length, 1)
  assertEquals(JSON.parse(String(lines[0][0])), {
    transport: 'console',
    email_log_id: LOG_ID,
    subject_length: 'Votre accès à Clinique MANA'.length,
    attachment_count: 0,
  })
  assertFalse(JSON.stringify(lines).includes(ADDRESS))
})

// ---------------------------------------------------------------------------
// transportFromEnv
// ---------------------------------------------------------------------------
const envOf = (vars: Record<string, string>) => (key: string) => vars[key]
const { fetch: noFetch } = fakeFetch({})

Deno.test('transportFromEnv: Resend by default, and only with an API key', () => {
  assert('send' in transportFromEnv(envOf({}), noFetch, KEY))
  assertEquals(transportFromEnv(envOf({}), noFetch, null), {
    error: 'not_configured',
  })
  assertEquals(
    transportFromEnv(envOf({ EMAIL_TRANSPORT: 'resend' }), noFetch, ''),
    { error: 'not_configured' },
  )
})

Deno.test('transportFromEnv: Mailpit needs an http(s) MAILPIT_URL', () => {
  assert(
    'send' in transportFromEnv(
      envOf({
        EMAIL_TRANSPORT: 'mailpit',
        MAILPIT_URL: 'http://supabase_inbucket_clinique-mana:8025',
      }),
      noFetch,
      null,
    ),
  )
  for (const url of [undefined, '', 'ftp://mailpit', 'not a url']) {
    const vars: Record<string, string> = { EMAIL_TRANSPORT: 'mailpit' }
    if (url !== undefined) vars.MAILPIT_URL = url
    assertEquals(transportFromEnv(envOf(vars), noFetch, null), {
      error: 'not_configured',
    })
  }
})

Deno.test('transportFromEnv: console, and an unknown value fails closed', () => {
  assert(
    'send' in
      transportFromEnv(envOf({ EMAIL_TRANSPORT: 'console' }), noFetch, null),
  )
  assertEquals(
    transportFromEnv(envOf({ EMAIL_TRANSPORT: 'smtp' }), noFetch, KEY),
    { error: 'not_configured' },
  )
})
