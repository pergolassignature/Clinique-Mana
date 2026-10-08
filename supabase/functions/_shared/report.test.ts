import { assertEquals, assertMatch } from '@std/assert'
import { stub } from '@std/testing/mock'
import { reportError } from './report.ts'
import { captureConsole, withEnv } from './testing/env.ts'
import { fakeFetch } from './testing/fake-fetch.ts'

const DSN = 'https://publickey@o1.ingest.sentry.test/42'
const INGEST = 'POST https://o1.ingest.sentry.test/api/42/envelope/'
const unexpected = fakeFetch({}).fetch

Deno.test('reportError: no DSN logs one structured line and sends nothing', async () => {
  const { fetch, calls } = fakeFetch({})
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const lines = await captureConsole('error', () =>
      reportError({
        fn: 'send-email',
        code: 'provider_error',
        ids: { email_log_id: 'e1' },
      }, fetch))
    assertEquals(lines, [[
      JSON.stringify({
        fn: 'send-email',
        code: 'provider_error',
        ids: { email_log_id: 'e1' },
      }),
    ]])
  })
  assertEquals(calls.length, 0)
})

Deno.test('reportError: forbidden keys are refused by the type and dropped at runtime', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    let lines: unknown[][] = []
    const warnings = await captureConsole('warn', async () => {
      lines = await captureConsole('error', () =>
        reportError({
          fn: 'accept-invite',
          code: 'invite_email_exists',
          ids: {
            link_id: 'l1',
            // @ts-expect-error: forbidden key
            email: 'ana@example.test',
            // @ts-expect-error: forbidden key
            to: 'bob@example.test',
            // @ts-expect-error: forbidden key
            token: 'tok-value',
            // @ts-expect-error: forbidden key
            password: 'pw-value',
            recipient_email: 'cy@example.test',
            access_token: 'tok-2',
            email_log_id: 'e1',
          },
        }, unexpected))
    })
    assertEquals(lines.length, 1)
    const line = String(lines[0][0])
    assertEquals(JSON.parse(line), {
      fn: 'accept-invite',
      code: 'invite_email_exists',
      ids: { link_id: 'l1', email_log_id: 'e1' },
    })
    for (const value of ['example.test', 'tok-', 'pw-value']) {
      assertEquals(line.includes(value), false)
    }
    // The warning names the dropped keys, never their values.
    assertEquals(warnings.length, 1)
    assertEquals(String(warnings[0]).includes('example.test'), false)
  })
})

Deno.test('reportError: with a DSN posts one envelope, key in a header, ids only', async () => {
  const { fetch, calls } = fakeFetch({ [INGEST]: () => new Response('{}') })
  await withEnv(
    { SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging' },
    async () => {
      const lines = await captureConsole('error', () =>
        reportError({
          fn: 'resend-webhook',
          code: 'resend_webhook_secret_missing',
          ids: { org_id: 'o1' },
        }, fetch))
      assertEquals(lines, [])
    },
  )
  assertEquals(calls.length, 1)
  const call = calls[0]
  assertEquals(new URL(call.url).search, '')
  assertEquals(
    call.headers.get('Content-Type'),
    'application/x-sentry-envelope',
  )
  assertMatch(call.headers.get('X-Sentry-Auth') ?? '', /sentry_key=publickey/)
  const [header, item, event, end] = call.body.split('\n')
  assertEquals(end, '')
  assertEquals(JSON.parse(item), { type: 'event' })
  const parsed = JSON.parse(event)
  assertEquals(JSON.parse(header).event_id, parsed.event_id)
  assertMatch(parsed.event_id, /^[0-9a-f]{32}$/)
  assertEquals(parsed.level, 'error')
  assertEquals(parsed.environment, 'staging')
  assertEquals(parsed.message, {
    formatted: 'resend-webhook: resend_webhook_secret_missing',
  })
  assertEquals(parsed.tags, {
    function: 'resend-webhook',
    code: 'resend_webhook_secret_missing',
  })
  assertEquals(parsed.extra, { org_id: 'o1' })
})

Deno.test('reportError: a failed send falls back to the console line and never throws', async () => {
  const { fetch } = fakeFetch({
    [INGEST]: [
      () => new Response('nope', { status: 500 }),
      () => {
        throw new TypeError('network down')
      },
    ],
  })
  await withEnv({ SENTRY_DSN: DSN }, async () => {
    for (let i = 0; i < 2; i++) {
      let lines: unknown[][] = []
      const warnings = await captureConsole('warn', async () => {
        lines = await captureConsole(
          'error',
          () => reportError({ fn: 'f', code: 'internal' }, fetch),
        )
      })
      assertEquals(warnings.length, 1)
      assertEquals(lines, [[JSON.stringify({ fn: 'f', code: 'internal' })]])
    }
  })
})

Deno.test('reportError: a malformed DSN warns and logs the line', async () => {
  await withEnv({ SENTRY_DSN: 'not-a-dsn' }, async () => {
    let lines: unknown[][] = []
    const warnings = await captureConsole('warn', async () => {
      lines = await captureConsole(
        'error',
        () => reportError({ fn: 'f', code: 'internal' }, unexpected),
      )
    })
    assertEquals(warnings.length, 1)
    assertEquals(lines.length, 1)
  })
})

Deno.test('reportError: fn and code that are not identifiers are replaced', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    const lines = await captureConsole('error', async () => {
      for (
        const [fn, code] of [
          ['send email', 'provider_error'],
          ['send-email', 'Resend said no to ana@example.test'],
          ['', 'x'.repeat(65)],
        ]
      ) {
        await reportError({ fn, code }, unexpected)
      }
      // Upper case, dots and dashes pass: SQLSTATE, PGRST and job keys.
      await reportError({ fn: 'core.daily-digest', code: '42P01' }, unexpected)
      await reportError({ fn: 'f', code: 'PGRST202' }, unexpected)
    })
    assertEquals(lines.map((l) => JSON.parse(String(l[0]))), [
      { fn: 'invalid_fn', code: 'provider_error' },
      { fn: 'send-email', code: 'invalid_code' },
      { fn: 'invalid_fn', code: 'invalid_code' },
      { fn: 'core.daily-digest', code: '42P01' },
      { fn: 'f', code: 'PGRST202' },
    ])
  })
})

Deno.test('reportError: id values with @, whitespace or over 100 characters are dropped, key named only', async () => {
  await withEnv({ SENTRY_DSN: undefined }, async () => {
    let lines: unknown[][] = []
    const warnings = await captureConsole('warn', async () => {
      lines = await captureConsole('error', () =>
        reportError({
          fn: 'send-email',
          code: 'provider_error',
          ids: {
            org_id: '11111111-1111-1111-1111-111111111111',
            recipient: 'ana@example.test',
            note: 'free text here',
            tabbed: 'a\tb',
            long_id: 'x'.repeat(101),
            max_id: 'y'.repeat(100),
          },
        }, unexpected))
    })
    assertEquals(JSON.parse(String(lines[0][0])).ids, {
      org_id: '11111111-1111-1111-1111-111111111111',
      max_id: 'y'.repeat(100),
    })
    assertEquals(warnings.length, 1)
    const warning = warnings[0].map(String).join(' ')
    for (const key of ['recipient', 'note', 'tabbed', 'long_id']) {
      assertEquals(warning.includes(key), true)
    }
    for (const value of ['example.test', 'free text', 'xxxx']) {
      assertEquals(warning.includes(value), false)
    }
  })
})

Deno.test('reportError: a Sentry send that hangs is aborted after 3 s and falls back to the line', async () => {
  let signal: AbortSignal | null | undefined
  const hanging = ((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
  }) as typeof fetch
  await withEnv({ SENTRY_DSN: DSN }, async () => {
    // No real wait: the send's one timer is captured, checked, then fired.
    const timers: { fire: () => void; ms: number }[] = []
    using _set = stub(
      globalThis,
      'setTimeout',
      ((fire: () => void, ms?: number) => {
        timers.push({ fire, ms: ms ?? 0 })
        return timers.length
      }) as typeof setTimeout,
    )
    using _clear = stub(globalThis, 'clearTimeout', () => {})
    let lines: unknown[][] = []
    const warnings = await captureConsole('warn', async () => {
      lines = await captureConsole('error', async () => {
        const sent = reportError({ fn: 'f', code: 'internal' }, hanging)
        while (signal === undefined) await Promise.resolve()
        assertEquals(timers.map((t) => t.ms), [3_000])
        assertEquals(signal?.aborted, false, 'nothing aborts before the timer')
        timers[0].fire()
        await sent
      })
    })
    assertEquals(signal?.aborted, true)
    assertEquals((signal?.reason as Error).name, 'TimeoutError')
    assertEquals(warnings.length, 1)
    assertEquals(String(warnings[0][1]), 'TimeoutError')
    assertEquals(lines, [[JSON.stringify({ fn: 'f', code: 'internal' })]])
  })
})
