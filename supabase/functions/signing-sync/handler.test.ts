import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeDocumenso } from '../_shared/testing/fake-documenso.ts'
import { fakeSigningDb } from '../_shared/testing/fake-signing-db.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { accessFixture } from '../_shared/testing/email-fixtures.ts'
import {
  LOCAL_APP_URL,
  sentRequest,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const NOW_S = Date.parse(NOW) / 1000
const SECRET = 'local-dev-internal-function-secret'
const JOB = 'core.signing_reconcile'
const URL_ = 'http://fn.test/functions/v1/signing-sync'

function setup(
  options: {
    user?: RpcRoute
    apiKey?: string | null
    modules?: string[]
    access?: Record<string, unknown>
  } = {},
) {
  const clock = fixedClock(NOW)
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    apiKey: options.apiKey,
    modules: options.modules,
  })
  const service = fakeSupabase({
    rpc: {
      ...db.rpc,
      list_job_orgs: { data: [SIGNING_ORG] },
      start_job_run: { data: 'run-1' },
      finish_job_run: (args) => {
        runs.push(args)
        return { data: null }
      },
    },
    storage: db.storage,
  })
  const runs: Record<string, unknown>[] = []
  const user = fakeSupabase({
    user: { id: 'u1' },
    rpc: {
      get_my_access: {
        data: options.access ?? {
          ...accessFixture(['settings.view']),
          org_id: SIGNING_ORG,
          modules: ['core'],
        },
      },
      // The caller's RLS read: the fake's rows, unless a test hides them.
      get_signature_request: options.user ?? db.rpc.get_signature_request,
    },
  })
  const deps: Deps = {
    env: (key) =>
      key === 'INTERNAL_FUNCTION_SECRET'
        ? SECRET
        : key === 'APP_URL'
        ? LOCAL_APP_URL
        : undefined,
    fetch: fake.fetch,
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { fake, db, service, user, runs, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: SECRET,
  }, fn)

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

async function json(res: Response) {
  return { status: res.status, ...(await res.json()) }
}

/** A request signed as `private.invoke_job_function` signs it. */
async function jobRequest(trigger = 'cron', orgId: string | null = null) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${NOW_S}.${JOB}.${orgId ?? ''}.${trigger}`),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  return new Request(URL_, {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: JOB, org_id: orgId, trigger }),
  })
}

// ---------------------------------------------------------------------------
// User mode (« Synchroniser »)
// ---------------------------------------------------------------------------
Deno.test('signing-sync: a lost completion → 200 signed, the PDF stored', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    s.fake.complete(row.documenso_document_id!)
    const res = await s.handler(post({ request_id: row.id }))
    assertEquals(await json(res), {
      status: 200,
      request_id: row.id,
      outcome: 'signed',
    })
    assertEquals(s.db.requests.get(row.id)!.status, 'signed')
    assertEquals(s.user.calls.map((c) => c.fn), [
      'get_my_access',
      'get_signature_request',
    ])
  })
})

Deno.test('signing-sync: a request the caller cannot see (no view permission) → 404, Documenso never called', async () => {
  await run(async () => {
    const s = setup({ user: { data: [] } })
    const row = await sentRequest(s.fake, s.db)
    const res = await s.handler(post({ request_id: row.id }))
    assertEquals(res.status, 404)
    assertEquals((await res.json()).error.code, 'not_found')
    assertEquals(s.fake.calls.length, 0)
  })
})

Deno.test("signing-sync: the request's module disabled for the caller → 403 module_disabled", async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {
      module_key: 'professionals',
      purpose: 'professionals.service_contract',
    })
    const res = await s.handler(post({ request_id: row.id }))
    assertEquals(res.status, 403)
    assertEquals((await res.json()).error.code, 'module_disabled')
  })
})

Deno.test('signing-sync: a draft under way is left alone (never cancelled from a click)', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {
      status: 'draft',
      sent_at: null,
      created_at: NOW,
    })
    const res = await s.handler(post({ request_id: row.id }))
    assertEquals(await json(res), {
      status: 200,
      request_id: row.id,
      outcome: 'unchanged',
    })
    assertEquals(
      s.fake.documents.get(row.documenso_document_id!)!.status,
      'PENDING',
    )
  })
})

Deno.test('signing-sync: not configured → 503; Documenso down → 502; Documenso refusing the key → 503', async () => {
  await run(async () => {
    let s = setup({ apiKey: null })
    let row = await sentRequest(s.fake, s.db)
    let res = await s.handler(post({ request_id: row.id }))
    assertEquals([res.status, (await res.json()).error.code], [
      503,
      'not_configured',
    ])

    for (
      const [failure, status, code] of [[500, 502, 'provider_error'], [
        401,
        503,
        'not_configured',
      ]] as const
    ) {
      s = setup()
      row = await sentRequest(s.fake, s.db)
      s.fake.failures.read = failure
      res = await s.handler(post({ request_id: row.id }))
      assertEquals([res.status, (await res.json()).error.code], [status, code])
    }
  })
})

Deno.test('signing-sync: a successful « Synchroniser » records the read (record_signature_sync): the « non vérifiée » state clears', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    s.db.syncs.set(row.id, {
      attempted_at: '2026-10-08T03:00:00.000Z',
      synced_at: '2026-10-08T01:00:00.000Z',
      error_code: 'provider_unreachable',
      failing_since: '2026-10-08T02:00:00.000Z',
      reported: {},
    })
    const res = await s.handler(post({ request_id: row.id }))
    assertEquals(res.status, 200)
    const sync = s.db.syncs.get(row.id)!
    assertEquals(
      [sync.synced_at, sync.error_code, sync.failing_since],
      [NOW, null, null],
    )
    assertEquals(
      s.service.calls.find((c) => c.fn === 'record_signature_sync')?.args
        .p_report_codes,
      [],
      'nothing reported through the reconcile throttle',
    )
  })
})

Deno.test('signing-sync: a failed « Synchroniser » records its code (a 404 is provider_not_found), still 502', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    s.fake.documents.delete(row.documenso_document_id!)
    const res = await s.handler(post({ request_id: row.id }))
    assertEquals([res.status, (await res.json()).error.code], [
      502,
      'provider_error',
    ])
    const sync = s.db.syncs.get(row.id)!
    assertEquals(
      [sync.synced_at, sync.error_code, sync.failing_since],
      [null, 'provider_not_found', NOW],
    )
  })
})

Deno.test("signing-sync: a draft is never recorded from a click (its state is its settle's)", async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {
      status: 'draft',
      sent_at: null,
      created_at: NOW,
    })
    assertEquals((await s.handler(post({ request_id: row.id }))).status, 200)
    assertFalse(s.db.syncs.has(row.id))
  })
})

Deno.test('signing-sync: no token → 401; a bad body → 400; CORS preflight', async () => {
  await run(async () => {
    const s = setup()
    assertEquals((await s.handler(post({ request_id: 'x' }, null))).status, 401)
    assertEquals((await s.handler(post({ request_id: 'x' }))).status, 400)
    assertEquals((await s.handler(post({}))).status, 400)
    const preflight = await s.handler(new Request(URL_, { method: 'OPTIONS' }))
    assertEquals(preflight.status, 200)
  })
})

Deno.test('signing-sync: an internal failure → 500 internal, reported with ids only', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    s.fake.complete(row.documenso_document_id!)
    s.db.storage.upload = () => ({ error: { message: 'boom' } })
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(post({ request_id: row.id }))
      assertEquals([res.status, (await res.json()).error.code], [
        500,
        'internal',
      ])
    })
    const report = JSON.stringify(lines)
    assert(report.includes('signed_upload_failed'))
    assert(report.includes(row.id))
    assert(!report.includes('@'))
  })
})

// ---------------------------------------------------------------------------
// Cron mode (core.signing_reconcile)
// ---------------------------------------------------------------------------
Deno.test('signing-sync: the job, signed → each org reconciled, the run detail counts only', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    s.fake.complete(row.documenso_document_id!)
    const res = await s.handler(await jobRequest())
    assertEquals(await json(res), { status: 200, runs: 1 })
    assertEquals(s.runs, [{
      p_id: 'run-1',
      p_status: 'ok',
      p_detail: '1 demande suivie (1 signée)',
    }])
    assertEquals(s.db.requests.get(row.id)!.status, 'signed')
  })
})

Deno.test('signing-sync: a job request with a bad signature → 401, nothing read', async () => {
  await run(async () => {
    const s = setup()
    const req = await jobRequest()
    const forged = new Request(req, {
      headers: { 'X-Job-Signature': `t=${NOW_S},v1=${'0'.repeat(64)}` },
    })
    assertEquals((await s.handler(forged)).status, 401)
    assertEquals(s.service.calls.length, 0)
  })
})
