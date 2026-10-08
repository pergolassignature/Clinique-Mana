import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { timingSafeEqual } from '../_shared/timing-safe-equal.ts'
import { fakeDocumenso } from '../_shared/testing/fake-documenso.ts'
import { fakeSigningDb } from '../_shared/testing/fake-signing-db.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  LOCAL_APP_URL,
  OTHER_ORG,
  sentRequest,
  SIGNERS,
  SIGNING_ORG,
  WEBHOOK_SECRET,
} from '../_shared/testing/signing-fixtures.ts'
import { sha256Hex } from '../_shared/storage.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const URL_ = `http://fn.test/functions/v1/signing-webhook?org=${SIGNING_ORG}`

function setup(
  options: {
    webhookSecret?: string | null
    modules?: string[]
    rpc?: Record<string, RpcRoute>
  } = {},
) {
  const clock = fixedClock(NOW)
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    webhookSecret: options.webhookSecret,
    modules: options.modules,
  })
  const supabase = fakeSupabase({
    rpc: { ...db.rpc, ...options.rpc },
    storage: db.storage,
  })
  const compared: [string, string][] = []
  const deps: Deps = {
    env: (key) => key === 'APP_URL' ? LOCAL_APP_URL : undefined,
    fetch: fake.fetch,
    now: clock.now,
    serviceClient: () => supabase.client,
    userClient: () => {
      throw new Error('no user client in a webhook')
    },
  }
  const inner = createHandler(deps, {
    timingSafeEqual: (a, b) => {
      compared.push([a, b])
      return timingSafeEqual(a, b)
    },
  })
  // `consume` (the per-IP limit) reads its HMAC key from the env.
  const handler = async (req: Request): Promise<Response> => {
    let res: Response | undefined
    await withEnv(
      { INTERNAL_FUNCTION_SECRET: 'local-dev-test-secret' },
      async () => {
        res = await inner(req)
      },
    )
    return res!
  }
  return { clock, fake, db, supabase, handler, compared }
}

const run = (fn: () => Promise<void>) => withEnv({ SENTRY_DSN: undefined }, fn)
/** The calls after the per-IP limit (its own tests check it). */
const rpcNames = (s: { calls: { fn: string }[] }) =>
  s.calls.map((c) => c.fn).filter((fn) => fn !== 'consume_rate_limit')

/** A raw webhook body with the given secret header. */
const post = (
  body: string,
  secret: string | null = WEBHOOK_SECRET,
  url = URL_,
) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === null ? {} : { 'X-Documenso-Secret': secret }),
    },
    body,
  })

async function outcome(res: Response) {
  return { status: res.status, ...(await res.json().catch(() => ({}))) }
}

// ---------------------------------------------------------------------------
// Authentication and request shape
// ---------------------------------------------------------------------------
Deno.test('signing-webhook: a wrong secret → 401, compared with timingSafeEqual; nothing claimed', async () => {
  const s = setup()
  const res = await s.handler(post('{}', 'wrong-secret'))
  assertEquals(res.status, 401)
  assertEquals(s.compared, [['wrong-secret', WEBHOOK_SECRET]])
  assertEquals(rpcNames(s.supabase), ['get_org_secret'])
})

Deno.test('signing-webhook: no secret configured for the org → 401 (fail closed)', async () => {
  await run(async () => {
    const s = setup({ webhookSecret: null })
    await captureConsole('warn', async () => {
      assertEquals((await s.handler(post('{}'))).status, 401)
    })
    assertEquals(s.compared, [])
    assertEquals(rpcNames(s.supabase), ['get_org_secret'])
  })
})

Deno.test("signing-webhook: no secret header → 401 before any read; another org's hint finds no secret → 401", async () => {
  await run(async () => {
    const s = setup()
    assertEquals((await s.handler(post('{}', null))).status, 401)
    assertEquals(s.supabase.calls.length, 0, 'not even the rate limit')
    await captureConsole('warn', async () => {
      const other =
        `http://fn.test/functions/v1/signing-webhook?org=${OTHER_ORG}`
      assertEquals(
        (await s.handler(post('{}', WEBHOOK_SECRET, other))).status,
        401,
      )
    })
  })
})

Deno.test('signing-webhook: method, org hint, size and payload checks', async () => {
  const s = setup()
  assertEquals((await s.handler(new Request(URL_))).status, 405)
  assertEquals(
    (await s.handler(
      post('{}', WEBHOOK_SECRET, URL_.replace(SIGNING_ORG, 'nope')),
    ))
      .status,
    400,
  )
  assertEquals(
    (await s.handler(post('x'.repeat(256 * 1024 + 1)))).status,
    413,
  )
  assertEquals((await s.handler(post('{not json'))).status, 400)
  assertEquals(
    (await s.handler(post(JSON.stringify({ event: 'DOCUMENT_COMPLETED' }))))
      .status,
    400,
  )
  assertEquals(
    (await s.handler(post(JSON.stringify({
      event: 'DOCUMENT COMPLETED',
      payload: { id: 1 },
    })))).status,
    400,
  )
  assertFalse(rpcNames(s.supabase).includes('claim_webhook_event'))
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
Deno.test('signing-webhook: no externalId that is a request id (a document made outside the app) → 200 ignored before the claim, no lookup by document id', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    const doc = row.documenso_document_id!
    s.fake.complete(doc)
    for (const externalId of [undefined, null, 'not-a-uuid']) {
      s.supabase.calls.length = 0
      s.fake.documents.get(doc)!.externalId = externalId
      const lines = await captureConsole('error', async () => {
        const res = await s.handler(
          s.fake.webhookRequest(URL_, 'DOCUMENT_COMPLETED', doc),
        )
        assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
      })
      assertEquals(lines, [], 'not reported')
      assertEquals(rpcNames(s.supabase), ['get_org_secret'])
    }
    assertEquals(s.db.requests.get(row.id)!.status, 'sent')
    assertEquals(s.db.events.size, 0)
  })
})

Deno.test("signing-webhook: an externalId naming another request than the document's → not_found, nothing applied", async () => {
  await run(async () => {
    const s = setup()
    const a = await sentRequest(s.fake, s.db)
    const b = await sentRequest(s.fake, s.db)
    // Document a, under b's id (another instance numbering a document alike).
    s.fake.documents.get(a.documenso_document_id!)!.externalId = b.id
    s.fake.complete(a.documenso_document_id!)
    await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_COMPLETED',
          a.documenso_document_id!,
        ),
      )
      assertEquals(await outcome(res), { status: 200, outcome: 'not_found' })
    })
    assertEquals(s.db.requests.get(a.id)!.status, 'sent')
    assertEquals(s.db.requests.get(b.id)!.status, 'sent')
    assertEquals(s.db.files.size, 0, 'nothing downloaded')
  })
})

Deno.test('signing-webhook: completed → claimed (ids only), signed PDF downloaded, registered, completed with its SHA-256', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {}, SIGNERS)
    const doc = row.documenso_document_id!
    s.fake.complete(doc)
    const res = await s.handler(
      s.fake.webhookRequest(URL_, 'DOCUMENT_COMPLETED', doc),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'signed' })
    const claim = s.supabase.calls.find((c) => c.fn === 'claim_webhook_event')!
    assertEquals(claim.args.p_provider, 'documenso')
    assertEquals(
      claim.args.p_event_id,
      `${SIGNING_ORG}:DOCUMENT_COMPLETED:${doc}`,
    )
    assertEquals(claim.args.p_org_id, SIGNING_ORG)
    assertEquals(claim.args.p_payload, {
      event: 'DOCUMENT_COMPLETED',
      document_id: doc,
      external_id: row.id,
    })
    assertFalse(JSON.stringify(claim.args).includes('@'), 'no address claimed')
    const request = s.db.requests.get(row.id)!
    assertEquals(request.status, 'signed')
    const signed = [...s.db.objects.entries()].find(([k]) =>
      k.startsWith('signed-documents/')
    )!
    assertEquals(request.signed_sha256, sha256Hex(signed[1]))
    assertEquals(
      s.db.files.get(request.signed_file_id!)!.view_permission,
      request.view_permission,
    )
    assertEquals([...s.db.events.values()][0].status, 'completed')
  })
})

Deno.test('signing-webhook: the same completed event again, even with a new timestamp → duplicate, nothing applied', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    const doc = row.documenso_document_id!
    s.fake.complete(doc)
    await s.handler(s.fake.webhookRequest(URL_, 'DOCUMENT_COMPLETED', doc))
    s.supabase.calls.length = 0
    // webhookRequest stamps a new createdAt on every call.
    const res = await s.handler(
      s.fake.webhookRequest(URL_, 'DOCUMENT_COMPLETED', doc),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'duplicate' })
    assertEquals(rpcNames(s.supabase), [
      'get_org_secret',
      'claim_webhook_event',
    ])
  })
})

Deno.test('signing-webhook: opened → viewed (version from the webhook time); signed → that recipient', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {}, SIGNERS)
    const doc = row.documenso_document_id!
    s.fake.open(doc)
    let res = await s.handler(
      s.fake.webhookRequest(URL_, 'document.opened', doc),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'applied' })
    const claim = s.supabase.calls.find((c) => c.fn === 'claim_webhook_event')!
    assertEquals(
      claim.args.p_event_id,
      `${SIGNING_ORG}:DOCUMENT_OPENED:${doc}:2026-01-01T12:00:04.000Z`,
    )
    assertEquals(s.db.requests.get(row.id)!.status, 'viewed')
    assertEquals(s.db.requests.get(row.id)!.signers[0].status, 'viewed')

    s.fake.sign(doc)
    res = await s.handler(s.fake.webhookRequest(URL_, 'DOCUMENT_SIGNED', doc))
    assertEquals(await outcome(res), { status: 200, outcome: 'applied' })
    assertEquals(
      s.db.requests.get(row.id)!.signers.map((x) => x.status),
      ['signed', 'pending'],
    )
  })
})

Deno.test('signing-webhook: rejected → the reason is stored; cancelled → cancelled', async () => {
  await run(async () => {
    const s = setup()
    const a = await sentRequest(s.fake, s.db)
    s.fake.reject(a.documenso_document_id!, undefined, 'Pas d’accord')
    let res = await s.handler(
      s.fake.webhookRequest(
        URL_,
        'DOCUMENT_REJECTED',
        a.documenso_document_id!,
      ),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'applied' })
    assertEquals(s.db.requests.get(a.id)!.status, 'rejected')
    assertEquals(s.db.requests.get(a.id)!.rejection_reason, 'Pas d’accord')

    const b = await sentRequest(s.fake, s.db)
    res = await s.handler(
      s.fake.webhookRequest(
        URL_,
        'DOCUMENT_CANCELLED',
        b.documenso_document_id!,
      ),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'applied' })
    assertEquals(s.db.requests.get(b.id)!.status, 'cancelled')
  })
})

Deno.test('signing-webhook: a disabled module → 200 ignored, nothing applied or downloaded', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {
      module_key: 'professionals',
      purpose: 'professionals.service_contract',
    })
    s.fake.complete(row.documenso_document_id!)
    const res = await s.handler(
      s.fake.webhookRequest(
        URL_,
        'DOCUMENT_COMPLETED',
        row.documenso_document_id!,
      ),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
    assertEquals(s.db.requests.get(row.id)!.status, 'sent')
    assertEquals(s.db.files.size, 0)
  })
})

Deno.test('signing-webhook: an event for a draft whose send is under way → 409, the claim failed so Documenso retries', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {
      status: 'draft',
      documenso_document_id: null,
      sent_at: null,
    })
    const doc = [...s.fake.documents.keys()].at(-1)!
    s.fake.complete(doc)
    const res = await s.handler(
      s.fake.webhookRequest(URL_, 'DOCUMENT_COMPLETED', doc),
    )
    assertEquals(res.status, 409)
    const event = [...s.db.events.values()][0]
    assertEquals(event.status, 'failed')
    assertEquals(event.error, 'signing_retry')
    assertEquals(s.db.requests.get(row.id)!.status, 'draft')
  })
})

Deno.test('signing-webhook: an event Documenso sends but the database does not track → acked, no apply', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    const res = await s.handler(
      s.fake.webhookRequest(URL_, 'DOCUMENT_SENT', row.documenso_document_id!),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
    assertFalse(rpcNames(s.supabase).includes('apply_signing_event'))
  })
})

Deno.test('signing-webhook: an unknown document → 200 not_found, reported with ids only', async () => {
  await run(async () => {
    const s = setup()
    await sentRequest(s.fake, s.db)
    s.db.requests.clear()
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(URL_, 'DOCUMENT_OPENED', '1'),
      )
      assertEquals(await outcome(res), { status: 200, outcome: 'not_found' })
    })
    const report = JSON.stringify(lines)
    assert(report.includes('signing_event_not_found'))
    assertFalse(report.includes('@'))
  })
})

Deno.test('signing-webhook: a late event of a document a re-send superseded → 200 ignored, not reported', async () => {
  await run(async () => {
    const s = setup()
    const old = await sentRequest(s.fake, s.db)
    // A re-send replaced document 1 (cancelled first) with document 2.
    const row = await sentRequest(s.fake, s.db, { id: old.id })
    row.superseded_document_ids = [old.documenso_document_id!]
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_CANCELLED',
          old.documenso_document_id!,
        ),
      )
      assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
    })
    assertEquals(lines, [], 'no signing_event_not_found report')
    assertEquals(s.db.requests.get(row.id)!.status, 'sent')
  })
})

Deno.test('signing-webhook: completed for a request closed here (expired, cancelled, abandoned) → 200, reported signing_completed_after_close (ids only)', async () => {
  await run(async () => {
    for (
      const over of [
        { status: 'expired' },
        { status: 'cancelled' },
        { status: 'draft', sent_at: null, last_error: 'abandoned' },
      ]
    ) {
      const s = setup()
      const row = await sentRequest(s.fake, s.db, over)
      s.fake.complete(row.documenso_document_id!)
      const lines = await captureConsole('error', async () => {
        const res = await s.handler(
          s.fake.webhookRequest(
            URL_,
            'DOCUMENT_COMPLETED',
            row.documenso_document_id!,
          ),
        )
        assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
      })
      const report = JSON.stringify(lines)
      assert(report.includes('signing_completed_after_close'), over.status)
      assert(report.includes(row.id))
      assertFalse(report.includes('@'))
      assertEquals(s.db.requests.get(row.id)!.status, over.status)
      assertEquals(s.db.files.size, 0, 'nothing downloaded')
    }
  })
})

Deno.test('signing-webhook: completed again for a request already signed → 200 ignored, no report', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, { status: 'signed' })
    s.fake.complete(row.documenso_document_id!)
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_COMPLETED',
          row.documenso_document_id!,
        ),
      )
      assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
    })
    assertEquals(lines, [])
  })
})

Deno.test('signing-webhook: a failure after the claim (download) → 500, the claim failed with a code, reported', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    s.fake.complete(row.documenso_document_id!)
    s.fake.failures.download = 502
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_COMPLETED',
          row.documenso_document_id!,
        ),
      )
      assertEquals(res.status, 500)
    })
    const event = [...s.db.events.values()][0]
    assertEquals(event.status, 'failed')
    assertEquals(event.error, 'provider_error')
    assert(JSON.stringify(lines).includes(row.id))
    // The next delivery retries and succeeds.
    delete s.fake.failures.download
    const res = await s.handler(
      s.fake.webhookRequest(
        URL_,
        'DOCUMENT_COMPLETED',
        row.documenso_document_id!,
      ),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'signed' })
  })
})

Deno.test('signing-webhook: a claim already held → 409; a claim RPC error → 500', async () => {
  await run(async () => {
    for (
      const [route, status] of [
        [
          { data: [{ status: 'in_progress', id: null, claim_token: null }] },
          409,
        ],
        [{ error: { code: '57014' } }, 500],
      ] as const
    ) {
      const s = setup({ rpc: { claim_webhook_event: route } })
      const row = await sentRequest(s.fake, s.db)
      await captureConsole('error', async () => {
        const res = await s.handler(
          s.fake.webhookRequest(
            URL_,
            'DOCUMENT_OPENED',
            row.documenso_document_id!,
          ),
        )
        assertEquals(res.status, status)
      })
      assertFalse(rpcNames(s.supabase).includes('apply_signing_event'))
    }
  })
})
