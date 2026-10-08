import { assertEquals } from '@std/assert'
import { createHandler, purgeOrg } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  type FakeResult,
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'

const SECRET = 'local-dev-internal-function-secret'
const JOB = 'core.storage_cleanup'
const ORG_A = '11111111-1111-1111-1111-111111111111'
const ORG_B = '22222222-2222-2222-2222-222222222222'
const NOW = '2026-10-08T10:00:00Z'
const NOW_S = 1_791_453_600

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

/** A request signed as `private.invoke_job_function` signs it. */
async function jobRequest(
  body: { job_key: string; org_id: string | null; trigger: string },
): Promise<Request> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = `${NOW_S}.${body.job_key}.${
    body.org_id ?? ''
  }.${body.trigger}`
  const mac = hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(message)),
  )
  return new Request('http://fn.test/functions/v1/storage-cleanup', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify(body),
  })
}

const MANUAL = { job_key: JOB, org_id: ORG_A, trigger: 'manual' }

/** `n` purge rows in `bucket`, with ids and paths numbered from `from`. */
const rows = (bucket: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => {
    const id = `00000000-0000-4000-8000-${String(from + i).padStart(12, '0')}`
    return { id, bucket, object_path: `${ORG_A}/core/${ORG_A}/${id}.png` }
  })

function harness(opts: {
  /** One page per call; past the last, an empty page. */
  pages?: ReturnType<typeof rows>[]
  list?: RpcRoute
  mark?: RpcRoute
  /** The remove result for a call, by its order (0-based). */
  remove?: (call: number) => FakeResult
  orgs?: string[]
} = {}) {
  let page = 0
  let removes = 0
  const fake = fakeSupabase({
    rpc: {
      list_job_orgs: { data: opts.orgs ?? [ORG_A] },
      start_job_run: (args) => ({ data: `run-${args.p_org_id}` }),
      finish_job_run: { data: null },
      list_files_to_purge: opts.list ??
        (() => ({ data: opts.pages?.[page++] ?? [] })),
      mark_files_purged: opts.mark ??
        ((args) => ({ data: (args.p_ids as string[]).length })),
    },
    storage: {
      remove: () => opts.remove?.(removes++) ?? { data: [] },
    },
  })
  const deps: Deps = {
    env: (key) => key === 'INTERNAL_FUNCTION_SECRET' ? SECRET : undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock(NOW).now,
    serviceClient: () => fake.client,
    userClient: () => new Response(null, { status: 500 }),
  }
  return { handler: createHandler(deps), ...fake }
}

const run = (fn: () => Promise<void>) =>
  withEnv({ SENTRY_DSN: undefined }, async () => {
    await captureConsole('error', fn)
  })

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

Deno.test('storage-cleanup: 250 rows over two buckets → 3 removes of ≤ 100 grouped by bucket, then one mark', async () => {
  await run(async () => {
    const docs = rows('documents', 150)
    const assets = rows('org-assets', 100, 150)
    // Interleaved, as created_at order would mix them.
    const page = docs.flatMap((d, i) => assets[i] ? [d, assets[i]] : [d])
    const { handler, calls, storageCalls } = harness({ pages: [page] })
    const res = await handler(await jobRequest(MANUAL))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { runs: 1 })

    assertEquals(
      storageCalls.map((
        c,
      ) => [c.bucket, c.method, (c.args[0] as string[]).length]),
      [['documents', 'remove', 100], ['documents', 'remove', 50], [
        'org-assets',
        'remove',
        100,
      ]],
    )
    assertEquals(
      storageCalls.flatMap((c) => c.args[0] as string[]).sort(),
      page.map((r) => r.object_path).sort(),
    )
    // A page under 500 rows is the last: one list, one mark.
    assertEquals(callsTo(calls, 'list_files_to_purge'), [{
      p_org_id: ORG_A,
      p_limit: 500,
    }])
    const marks = callsTo(calls, 'mark_files_purged')
    assertEquals(marks.length, 1)
    assertEquals(marks[0].p_org_id, ORG_A)
    assertEquals(
      (marks[0].p_ids as string[]).sort(),
      page.map((r) => r.id).sort(),
    )
    assertEquals(callsTo(calls, 'finish_job_run'), [{
      p_id: `run-${ORG_A}`,
      p_status: 'ok',
      p_detail: '250 fichiers supprimés',
    }])
  })
})

Deno.test('storage-cleanup: objects are removed before their rows are marked purged', async () => {
  await run(async () => {
    const order: string[] = []
    const { handler } = harness({
      pages: [rows('documents', 3)],
      remove: () => {
        order.push('remove')
        return { data: [] }
      },
      mark: (args) => {
        order.push('mark')
        return { data: (args.p_ids as string[]).length }
      },
    })
    await handler(await jobRequest(MANUAL))
    assertEquals(order, ['remove', 'mark'])
  })
})

Deno.test('storage-cleanup: a failed chunk is not marked; the others are; the run ends as an error', async () => {
  await run(async () => {
    const page = [...rows('documents', 150), ...rows('org-assets', 100, 150)]
    const { handler, calls } = harness({
      pages: [page, rows('documents', 10, 500)],
      // The second documents chunk (rows 100–149) fails.
      remove: (call) =>
        call === 1 ? { error: { message: 'storage down' } } : { data: [] },
    })
    assertEquals((await handler(await jobRequest(MANUAL))).status, 200)
    const marked = callsTo(calls, 'mark_files_purged')[0].p_ids as string[]
    assertEquals(
      marked.sort(),
      [...page.slice(0, 100), ...page.slice(150)].map((r) => r.id).sort(),
    )
    // No further page: the failed rows would be listed again.
    assertEquals(callsTo(calls, 'list_files_to_purge').length, 1)
    assertEquals(callsTo(calls, 'finish_job_run'), [{
      p_id: `run-${ORG_A}`,
      p_status: 'error',
      p_detail: 'storage_remove_failed',
    }])
  })
})

Deno.test('storage-cleanup: bounded at 5 pages of 500 per org and run', async () => {
  await run(async () => {
    const { handler, calls, storageCalls } = harness({
      list: () => ({ data: rows('documents', 500) }),
    })
    await handler(await jobRequest(MANUAL))
    assertEquals(callsTo(calls, 'list_files_to_purge').length, 5)
    assertEquals(callsTo(calls, 'mark_files_purged').length, 5)
    assertEquals(storageCalls.length, 25)
    assertEquals(
      callsTo(calls, 'finish_job_run')[0].p_detail,
      '2500 fichiers supprimés',
    )
  })
})

Deno.test('storage-cleanup: the detail counts the rows marked (mark_files_purged re-checks the rules)', async () => {
  await run(async () => {
    for (
      const [listed, marked, detail] of [
        [0, 0, 'Aucun fichier à supprimer'],
        [1, 1, '1 fichier supprimé'],
        [5, 3, '3 fichiers supprimés'],
      ] as const
    ) {
      const { handler, calls } = harness({
        pages: [rows('documents', listed)],
        mark: { data: marked },
      })
      await handler(await jobRequest(MANUAL))
      assertEquals(callsTo(calls, 'finish_job_run')[0].p_detail, detail)
      // Nothing listed: nothing removed, nothing marked.
      if (listed === 0) assertEquals(callsTo(calls, 'mark_files_purged'), [])
    }
  })
})

Deno.test('storage-cleanup: a list or mark failure ends the run as an error with its code', async () => {
  await run(async () => {
    for (
      const [code, opts] of [
        ['list_files_failed', { list: { error: { code: 'XX000' } } }],
        ['list_files_failed', { list: { data: [{ id: 'x' }] } }],
        ['mark_purged_failed', {
          pages: [rows('documents', 2)],
          mark: { error: { code: '22023' } },
        }],
      ] as [string, Parameters<typeof harness>[0]][]
    ) {
      const { handler, calls } = harness(opts)
      await handler(await jobRequest(MANUAL))
      assertEquals(callsTo(calls, 'finish_job_run')[0], {
        p_id: `run-${ORG_A}`,
        p_status: 'error',
        p_detail: code,
      }, code)
    }
  })
})

Deno.test('storage-cleanup: a cron run purges each org in turn, with that org only', async () => {
  await run(async () => {
    const { handler, calls } = harness({ orgs: [ORG_A, ORG_B] })
    const res = await handler(
      await jobRequest({ job_key: JOB, org_id: null, trigger: 'cron' }),
    )
    assertEquals(await res.json(), { runs: 2 })
    assertEquals(callsTo(calls, 'list_files_to_purge').map((a) => a.p_org_id), [
      ORG_A,
      ORG_B,
    ])
  })
})

Deno.test('storage-cleanup: an unsigned request or another job key is refused before any RPC', async () => {
  await run(async () => {
    const { handler, calls } = harness()
    const unsigned = new Request(
      'http://fn.test/functions/v1/storage-cleanup',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-dev-service-key' },
        body: JSON.stringify(MANUAL),
      },
    )
    assertEquals((await handler(unsigned)).status, 401)
    const other = await jobRequest({
      ...MANUAL,
      job_key: 'core.email_retention',
    })
    assertEquals((await handler(other)).status, 400)
    assertEquals(calls, [])
  })
})

Deno.test('purgeOrg: stops before the next page once its signal aborts', async () => {
  const controller = new AbortController()
  let lists = 0
  const fake = fakeSupabase({
    rpc: {
      list_files_to_purge: () => {
        lists++
        controller.abort()
        return { data: rows('documents', 500) }
      },
      mark_files_purged: (args) => ({ data: (args.p_ids as string[]).length }),
    },
    storage: { remove: () => ({ data: [] }) },
  })
  assertEquals(
    await purgeOrg(ORG_A, fake.client, controller.signal),
    '500 fichiers supprimés',
  )
  assertEquals(lists, 1)
})
