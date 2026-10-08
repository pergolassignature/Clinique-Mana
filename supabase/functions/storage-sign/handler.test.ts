import { assert, assertEquals } from '@std/assert'
import { createHandler, READ_URL_SECONDS } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  type FakeResult,
  fakeSupabase,
  type RpcRoute,
  type StorageRoute,
  type TableQuery,
} from '../_shared/testing/fake-supabase.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/storage-sign'
const NOW = '2026-10-08T15:00:00.000Z'
const FILE_ID = '00000000-0000-4000-8000-0000000000f1'
const OTHER_ORG = '00000000-0000-4000-8000-000000000002'
const PATH = `${ORG_ID}/core/${ORG_ID}/${FILE_ID}.pdf`
const NAME = 'Contrat signé — Tremblay.pdf'

interface Row {
  id: string
  org_id: string
  status: 'pending' | 'ready' | 'deleted' | 'purged'
  /** Whether the caller holds the view (or owner) permission. */
  permitted: boolean
  bucket: string
  object_path: string
  original_name: string
}

const READY: Row = {
  id: FILE_ID,
  org_id: ORG_ID,
  status: 'ready',
  permitted: true,
  bucket: 'documents',
  object_path: PATH,
  original_name: NAME,
}

/**
 * The caller's view of `stored_files` under `stored_files_select`: its org,
 * `ready`, and a permitted row; then the query's own `eq` filters.
 */
function underRls(rows: Row[]) {
  return (q: TableQuery): FakeResult => {
    const visible = rows.filter((r) =>
      r.org_id === ORG_ID && r.status === 'ready' && r.permitted &&
      Object.entries(q.eq).every(([k, v]) => r[k as keyof Row] === v)
    )
    const [row] = visible.map(({ bucket, object_path, original_name }) => ({
      bucket,
      object_path,
      original_name,
    }))
    return { data: row ?? null }
  }
}

/** What storage-js answers: `${SUPABASE_URL}/storage/v1/object/sign/…`. */
const signedUrlFor = (
  bucket: string,
  path: string,
  options?: { download?: string },
) =>
  `http://kong:8000/storage/v1/object/sign/${bucket}/${path}?token=local-dev-read-token` +
  (options?.download ? `&download=${encodeURIComponent(options.download)}` : '')

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
  rows?: Row[]
  lookup?: FakeResult
  sign?: StorageRoute
  limit?: RpcRoute
  env?: Record<string, string>
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: { get_my_access: { data: accessFixture(['settings.view']) } },
    tables: {
      stored_files: opts.lookup
        ? () => opts.lookup!
        : underRls(opts.rows ?? [READY]),
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: opts.limit ??
        { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }] },
    },
    storage: {
      createSignedUrl: opts.sign ??
        ((bucket, path, _expiresIn, options) => ({
          data: {
            signedUrl: signedUrlFor(
              bucket,
              path as string,
              options as { download?: string },
            ),
          },
        })),
    },
  })
  const deps: Deps = {
    env: (key) => opts.env?.[key],
    fetch: fakeFetch({}).fetch,
    now: fixedClock(NOW).now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

async function errorOf(res: Response) {
  return { status: res.status, ...(await res.json()).error }
}

/** The JSON report lines written while fn ran. */
async function reports(fn: () => Promise<void>) {
  const logged = await captureConsole('error', fn)
  return logged.map((args) => JSON.parse(String(args[0])))
}

const NOT_FOUND = { status: 404, code: 'not_found', message: 'File not found' }

Deno.test('storage-sign: a file the caller can read → a 300-second URL, read under RLS and signed by the service client', async () => {
  await run(async () => {
    const { handler, user, service } = harness()
    const res = await handler(post({ file_id: FILE_ID }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      url: signedUrlFor('documents', PATH),
      expires_at: '2026-10-08T15:05:00.000Z',
    })
    assertEquals(READ_URL_SECONDS, 300)
    // The caller's client reads the row: RLS decides who may read it.
    assertEquals(user.tableCalls, [{
      table: 'stored_files',
      columns: 'bucket, object_path, original_name',
      eq: { id: FILE_ID, status: 'ready' },
      single: true,
    }])
    assertEquals(service.tableCalls, [])
    assertEquals(service.storageCalls, [{
      bucket: 'documents',
      method: 'createSignedUrl',
      args: [PATH, 300, { download: undefined }],
    }])
    // One hit on the caller's sign limit, before the lookup.
    assertEquals(service.calls.map((c) => [c.fn, c.args.p_bucket]), [
      ['consume_rate_limit', 'storage.sign_user'],
    ])
  })
})

Deno.test('storage-sign: download → the original name as the download name', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const res = await handler(post({ file_id: FILE_ID, download: true }))
    assertEquals(res.status, 200)
    const { url } = await res.json()
    assertEquals(new URL(url).searchParams.get('download'), NAME)
    assertEquals(service.storageCalls[0].args, [PATH, 300, { download: NAME }])

    // download: false is inline, like no flag.
    const inline = harness()
    await inline.handler(post({ file_id: FILE_ID, download: false }))
    assertEquals(inline.service.storageCalls[0].args, [PATH, 300, {
      download: undefined,
    }])
  })
})

Deno.test('storage-sign: not permitted, another org, unknown → 404 (never 403), nothing signed, not reported', async () => {
  await run(async () => {
    const cases: [string, Row[]][] = [
      ['not permitted', [{ ...READY, permitted: false }]],
      ['another org', [{ ...READY, org_id: OTHER_ORG }]],
      ['unknown id', []],
    ]
    for (const [name, rows] of cases) {
      const { handler, service } = harness({ rows })
      const logged = await reports(async () => {
        assertEquals(
          await errorOf(await handler(post({ file_id: FILE_ID }))),
          NOT_FOUND,
          name,
        )
      })
      assertEquals(logged, [], name)
      assertEquals(service.storageCalls, [], name)
    }
  })
})

Deno.test('storage-sign: deleted, purged or pending → 404, nothing signed', async () => {
  await run(async () => {
    for (const status of ['deleted', 'purged', 'pending'] as const) {
      const { handler, service } = harness({ rows: [{ ...READY, status }] })
      assertEquals(
        await errorOf(await handler(post({ file_id: FILE_ID }))),
        NOT_FOUND,
        status,
      )
      assertEquals(service.storageCalls, [], status)
    }
  })
})

Deno.test("storage-sign: over the caller's limit → 429 with Retry-After, before any lookup; the limiter down → 503", async () => {
  await run(async () => {
    const refused = harness({
      limit: {
        data: [{ allowed: false, hits: 121, retry_after_seconds: 600 }],
      },
    })
    const res = await refused.handler(post({ file_id: FILE_ID }))
    assertEquals(await errorOf(res), {
      status: 429,
      code: 'rate_limited',
      message: 'Too many attempts',
    })
    assertEquals(res.headers.get('Retry-After'), '600')
    assertEquals(refused.user.tableCalls, [])
    assertEquals(refused.service.storageCalls, [])

    const down = harness({ limit: { error: { code: 'XX000' } } })
    await reports(async () => {
      assertEquals((await down.handler(post({ file_id: FILE_ID }))).status, 503)
    })
    assertEquals(down.user.tableCalls, [])
  })
})

Deno.test('storage-sign: PUBLIC_API_URL replaces the internal origin; a malformed one → 500 server_misconfigured, reported', async () => {
  await run(async () => {
    const local = harness({ env: { PUBLIC_API_URL: 'http://127.0.0.1:55321' } })
    const res = await local.handler(post({ file_id: FILE_ID, download: true }))
    const { url } = await res.json()
    assertEquals(
      url,
      signedUrlFor('documents', PATH, { download: NAME }).replace(
        'http://kong:8000',
        'http://127.0.0.1:55321',
      ),
    )

    const bad = harness({ env: { PUBLIC_API_URL: 'javascript:alert(1)' } })
    const logged = await reports(async () => {
      assertEquals(
        await errorOf(await bad.handler(post({ file_id: FILE_ID }))),
        {
          status: 500,
          code: 'server_misconfigured',
          message: 'Server misconfigured',
        },
      )
    })
    assertEquals(logged.map((l) => l.code), ['public_api_url_invalid'])
    assertEquals(bad.service.calls, [])
  })
})

Deno.test('storage-sign: a ready row whose object is missing → 404, reported; lookup or signing failures → 500, reported with ids only', async () => {
  await run(async () => {
    const cases: [string, number, Parameters<typeof harness>[0]][] = [
      ['object_missing', 404, {
        sign: () => ({
          error: Object.assign(new Error('Object not found'), {
            status: 400,
            statusCode: '404',
          }),
        }),
      }],
      ['sign_failed', 500, {
        sign: () => ({
          error: Object.assign(new Error('down'), { status: 500 }),
        }),
      }],
      ['sign_failed', 500, { sign: () => ({ data: {} }) }],
      ['file_lookup_failed', 500, {
        lookup: { error: { code: 'XX000', message: 'boom' } },
      }],
      ['unexpected_file_row', 500, { lookup: { data: { bucket: 'x' } } }],
    ]
    for (const [code, status, opts] of cases) {
      const { handler } = harness(opts)
      const logged = await reports(async () => {
        assertEquals(
          (await handler(post({ file_id: FILE_ID }))).status,
          status,
          code,
        )
      })
      assertEquals(logged, [{
        fn: 'storage-sign',
        code,
        ids: { org_id: ORG_ID, file_id: FILE_ID },
      }], code)
      // Never the file's name or path.
      assert(!JSON.stringify(logged).includes('Contrat'), code)
      assert(!JSON.stringify(logged).includes('.pdf'), code)
    }
  })
})

Deno.test('storage-sign: the body is { file_id, download? } only; no bearer → 401; GET → 405; OPTIONS → preflight', async () => {
  await run(async () => {
    for (
      const body of [
        {},
        { file_id: 'x' },
        { file_id: FILE_ID, download: 'yes' },
        { file_id: FILE_ID, expires_in: 86_400 },
        { file_id: FILE_ID, path: PATH },
      ]
    ) {
      const { handler, user, service } = harness()
      assertEquals(
        (await handler(post(body))).status,
        400,
        JSON.stringify(body),
      )
      assertEquals(user.tableCalls, [], JSON.stringify(body))
      assertEquals(service.calls, [], JSON.stringify(body))
    }
    const { handler, user } = harness()
    assertEquals((await handler(post({ file_id: FILE_ID }, null))).status, 401)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    const preflight = await handler(new Request(URL_, { method: 'OPTIONS' }))
    assertEquals(preflight.status, 200)
    assertEquals(user.calls, [])
  })
})
