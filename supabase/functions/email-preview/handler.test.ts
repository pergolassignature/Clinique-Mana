import { assert, assertEquals, assertFalse } from '@std/assert'
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

const URL_ = 'http://fn.test/functions/v1/email-preview'
const ENV: Record<string, string> = { APP_URL: 'http://localhost:5173' }

const draft = (over: Record<string, unknown> = {}) => ({
  template_key: 'core.staff_invite',
  subject: 'Brouillon pour {{clinic.name}}',
  body: 'Bonjour {{invitee.display_name}},\n\nÀ bientôt.',
  button_label: 'Créer mon accès',
  ...over,
})

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

function harness(opts: {
  access?: Record<string, unknown>
  context?: RpcRoute
  env?: Record<string, string>
  limit?: RpcRoute
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: { get_my_access: { data: opts.access ?? accessFixture() } },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: opts.limit ??
        { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }] },
      get_email_context: opts.context ?? { data: emailContextFixture() },
    },
  })
  const env = { ...ENV, ...opts.env }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service }
}

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

/** Runs `fn` with no Sentry, so reports are console lines (and the limiter's key). */
const quiet = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-test-secret',
  }, fn)

Deno.test('email-preview: answers the CORS preflight', async () => {
  await quiet(async () => {
    const { handler, user } = harness()
    const res = await handler(new Request(URL_, { method: 'OPTIONS' }))
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
    assertEquals(user.authCalls, [])
  })
})

Deno.test('email-preview: only POST', async () => {
  await quiet(async () => {
    const { handler } = harness()
    const res = await handler(new Request(URL_, { method: 'GET' }))
    assertEquals((await errorOf(res)).status, 405)
  })
})

Deno.test('email-preview: no token → 401, nothing read', async () => {
  await quiet(async () => {
    const { handler, service } = harness()
    const res = await handler(post(draft(), null))
    assertEquals(await errorOf(res), {
      status: 401,
      code: 'unauthenticated',
      message: 'Missing Authorization header',
    })
    assertEquals(service.calls, [])
  })
})

Deno.test('email-preview: no settings.view → 403', async () => {
  await quiet(async () => {
    const { handler, service } = harness({
      access: accessFixture(['clients.view']),
    })
    const res = await handler(post(draft()))
    const error = await errorOf(res)
    assertEquals([error.status, error.code], [403, 'forbidden'])
    assertEquals(service.calls, [])
  })
})

Deno.test('email-preview: settings.view without settings.email_manage may preview (nothing is stored or sent)', async () => {
  await quiet(async () => {
    const { handler } = harness({ access: accessFixture(['settings.view']) })
    const res = await handler(post(draft()))
    assertEquals(res.status, 200)
    assertEquals((await res.json()).subject, 'Brouillon pour Clinique MANA')
  })
})

Deno.test('email-preview: unclosed braces → 400 invalid_request « Accolades non fermées », nothing read', async () => {
  await quiet(async () => {
    const { handler, service } = harness()
    for (
      const over of [
        { subject: 'Objet {{clinic.name' },
        { body: 'Texte }} fin' },
        { body: 'Texte {{ {{clinic.name}}' },
        { button_label: 'Ouvrir {{' },
      ]
    ) {
      const error = await errorOf(await handler(post(draft(over))))
      assertEquals(error, {
        status: 400,
        code: 'invalid_request',
        message: 'Accolades non fermées dans le texte.',
      }, JSON.stringify(over))
    }
    assertEquals(service.calls, [])
  })
})

Deno.test('email-preview: single braces around a placeholder are not unclosed (as SQL)', async () => {
  await quiet(async () => {
    const { handler } = harness()
    const res = await handler(post(draft({ body: '{{{clinic.name}}}' })))
    assertEquals(res.status, 200)
    assert((await res.json()).text.includes('{Clinique MANA}'))
  })
})

Deno.test('email-preview: trims only space, tab, CR and LF (as SQL btrim)', async () => {
  await quiet(async () => {
    const { handler } = harness()
    const ok = await handler(post(draft({ subject: ' \t\r\nObjet\t ' })))
    assertEquals((await ok.json()).subject, 'Objet')
    // A no-break space is not trimmed, as in SQL: the subject is not empty.
    const nbsp = await handler(post(draft({ subject: '\u00a0' })))
    assertEquals(nbsp.status, 200)
    await nbsp.body?.cancel()
    // A body of only an ideographic space is not empty for SQL either.
    const ideo = await handler(post(draft({ body: '\u3000' })))
    assertEquals(ideo.status, 200)
    await ideo.body?.cancel()
  })
})

Deno.test('email-preview: renders the draft with samples, for the caller org', async () => {
  await quiet(async () => {
    const { handler, service } = harness()
    const res = await handler(post(draft({ org_id: 'someone-else' })))
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
    const body = await res.json()
    assertEquals(Object.keys(body).sort(), ['html', 'subject', 'text'])
    assertEquals(body.subject, 'Brouillon pour Clinique MANA')
    assert(body.html.includes('Bonjour Ana Gagnon,'))
    assert(body.html.includes('Créer mon accès'))
    assert(body.text.includes('À bientôt.'))
    assertEquals(service.calls.map((c) => c.fn), [
      'consume_rate_limit',
      'get_email_context',
    ])
    assertEquals(service.calls[1].args, {
      p_org_id: ORG_ID,
      p_template_key: 'core.staff_invite',
    })
  })
})

Deno.test('email-preview: one hit per caller (emails.preview_user); over the limit → 429 with Retry-After; the limiter down → 503; nothing rendered', async () => {
  await quiet(async () => {
    const { handler, service } = harness()
    assertEquals((await handler(post(draft()))).status, 200)
    const limit = service.calls[0].args
    assertEquals([limit.p_bucket, limit.p_max, limit.p_window_seconds], [
      'emails.preview_user',
      300,
      3_600,
    ])
    for (
      const [route, status, code] of [
        [
          { data: [{ allowed: false, hits: 301, retry_after_seconds: 90 }] },
          429,
          'rate_limited',
        ],
        [{ error: { code: '57014' } }, 503, 'not_configured'],
      ] as const
    ) {
      const h = harness({ limit: route })
      let res: Response | undefined
      await captureConsole('error', async () => {
        res = await h.handler(post(draft()))
      })
      assertEquals(res!.status, status)
      assertEquals((await res!.json()).error.code, code)
      if (status === 429) assertEquals(res!.headers.get('Retry-After'), '90')
      assertEquals(h.service.calls.map((c) => c.fn), ['consume_rate_limit'])
    }
  })
})

Deno.test('email-preview: an empty button label renders no button', async () => {
  await quiet(async () => {
    const { handler } = harness()
    const res = await handler(post(draft({ button_label: '  ' })))
    assertEquals(res.status, 200)
    assertFalse((await res.json()).html.includes('Créer mon accès'))
  })
})

Deno.test('email-preview: an unknown placeholder → 400 invalid_request naming it', async () => {
  await quiet(async () => {
    const { handler } = harness()
    const res = await handler(
      post(draft({ body: 'Bonjour {{ patient.name }}' })),
    )
    assertEquals(await errorOf(res), {
      status: 400,
      code: 'invalid_request',
      message: 'Unknown variable',
      variable: 'patient.name',
    })
  })
})

Deno.test('email-preview: no <script> from the input reaches the HTML', async () => {
  await quiet(async () => {
    const { handler } = harness()
    const res = await handler(post(draft({
      subject: '<script>alert(1)</script> {{clinic.name}}',
      body: '<script>alert(2)</script>\n\n<img src=x onerror=alert(3)>',
      button_label: '<script>alert(4)</script>',
    })))
    assertEquals(res.status, 200)
    const { html } = await res.json()
    assertFalse(/<script/i.test(html))
    assertFalse(/<img[^>]*onerror/i.test(html))
    assert(html.includes('&lt;img src=x onerror=alert(3)&gt;'))
    assert(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'))
  })
})

Deno.test('email-preview: a disabled module → 403 module_disabled', async () => {
  await quiet(async () => {
    const { handler } = harness({
      context: { data: emailContextFixture({ module_enabled: false }) },
    })
    const error = await errorOf(await handler(post(draft())))
    assertEquals([error.status, error.code], [403, 'module_disabled'])
  })
})

Deno.test('email-preview: HTML over 200 KB → 413', async () => {
  await quiet(async () => {
    const { handler } = harness({
      context: {
        data: emailContextFixture({
          template: {
            variables: [{
              path: 'long',
              label: 'Long',
              sample: 'x'.repeat(1_000),
              required: true,
              kind: 'text',
            }],
          },
        }),
      },
    })
    const res = await handler(post(draft({
      subject: 'Objet',
      body: '{{long}}'.repeat(250),
      button_label: null,
    })))
    const error = await errorOf(res)
    assertEquals([error.status, error.code], [413, 'invalid_request'])
  })
})

Deno.test('email-preview: invalid drafts → 400 (lengths as in SQL)', async () => {
  await quiet(async () => {
    const { handler, service } = harness()
    for (
      const body of [
        draft({ template_key: undefined }),
        draft({ template_key: 'Core.Invite' }),
        draft({ subject: '   ' }),
        draft({ subject: 'x'.repeat(201) }),
        draft({ subject: 'une\nautre ligne' }),
        draft({ body: '' }),
        draft({ body: 'x'.repeat(10_001) }),
        draft({ button_label: 'x'.repeat(61) }),
      ]
    ) {
      const error = await errorOf(await handler(post(body)))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
    }
    assertEquals(service.calls, [])
  })
})

Deno.test('email-preview: an unknown template key (22023) → 404 not_found', async () => {
  await quiet(async () => {
    const { handler } = harness({ context: { error: { code: '22023' } } })
    const error = await errorOf(await handler(post(draft())))
    assertEquals([error.status, error.code], [404, 'not_found'])
  })
})

Deno.test('email-preview: a context RPC failure → 500 internal, reported', async () => {
  await quiet(async () => {
    const { handler } = harness({ context: { error: { code: 'XX000' } } })
    const logged = await captureConsole('error', async () => {
      const error = await errorOf(await handler(post(draft())))
      assertEquals([error.status, error.code], [500, 'internal'])
    })
    assertEquals(JSON.parse(String(logged[0][0])), {
      fn: 'email-preview',
      code: 'email_context_failed',
      ids: { org_id: ORG_ID },
    })
  })
})

Deno.test('email-preview: no APP_URL → 503 not_configured', async () => {
  await quiet(async () => {
    const { handler } = harness({ env: { APP_URL: '' } })
    await captureConsole('error', async () => {
      const error = await errorOf(await handler(post(draft())))
      assertEquals([error.status, error.code], [503, 'not_configured'])
    })
  })
})

Deno.test('email-preview: an invalid clinic timezone → 500 server_misconfigured', async () => {
  await quiet(async () => {
    const { handler } = harness({
      context: { data: emailContextFixture({ timezone: 'Mars/Olympus' }) },
    })
    await captureConsole('error', async () => {
      const error = await errorOf(await handler(post(draft())))
      assertEquals([error.status, error.code], [500, 'server_misconfigured'])
    })
  })
})
