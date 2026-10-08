import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { timingSafeEqual } from '../_shared/timing-safe-equal.ts'
import {
  fakeDocumenso,
  fakeEnvelopeId,
} from '../_shared/testing/fake-documenso.ts'
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

Deno.test('signing-webhook: one hit per IP before the secret is read; over the limit → 429 with Retry-After, the limiter down → 503, the secret never read', async () => {
  await run(async () => {
    const s = setup()
    const req = post('{}', 'wrong-secret')
    req.headers.set('x-forwarded-for', '198.51.100.7, 203.0.113.9')
    assertEquals((await s.handler(req)).status, 401)
    assertEquals(s.supabase.calls.map((c) => c.fn), [
      'consume_rate_limit',
      'get_org_secret',
    ])
    const limit = s.supabase.calls[0].args
    assertEquals([limit.p_bucket, limit.p_max, limit.p_window_seconds], [
      'webhooks.documenso_ip',
      600,
      60,
    ])
    assertFalse(JSON.stringify(limit).includes('203.0.113.9'), 'only a hash')

    for (
      const [route, status, retryAfter] of [
        [
          { data: [{ allowed: false, hits: 601, retry_after_seconds: 42 }] },
          429,
          '42',
        ],
        [{ error: { code: '57014' } }, 503, null],
      ] as const
    ) {
      const t = setup({ rpc: { consume_rate_limit: route } })
      let res: Response | undefined
      await captureConsole('error', async () => {
        res = await t.handler(post('{}'))
      })
      assertEquals(res!.status, status)
      assertEquals(res!.headers.get('Retry-After'), retryAfter)
      assertEquals(t.supabase.calls.map((c) => c.fn), ['consume_rate_limit'])
      assertEquals(t.compared, [])
    }
  })
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
Deno.test('signing-webhook: no externalId that is a request id (an envelope made outside the app) → 200 ignored before the claim, no lookup by envelope id', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    const doc = row.envelope_id!
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

Deno.test("signing-webhook: an externalId naming another request than the envelope's → not_found, nothing applied", async () => {
  await run(async () => {
    const s = setup()
    const a = await sentRequest(s.fake, s.db)
    const b = await sentRequest(s.fake, s.db)
    // Envelope a, under b's id (another instance giving an envelope that id).
    s.fake.documents.get(a.envelope_id!)!.externalId = b.id
    s.fake.complete(a.envelope_id!)
    await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_COMPLETED',
          a.envelope_id!,
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
    const doc = row.envelope_id!
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
      envelope_id: doc,
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
    const doc = row.envelope_id!
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
    const doc = row.envelope_id!
    s.fake.open(doc)
    let res = await s.handler(
      s.fake.webhookRequest(URL_, 'document.opened', doc),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'applied' })
    const claim = s.supabase.calls.find((c) => c.fn === 'claim_webhook_event')!
    assertEquals(
      claim.args.p_event_id,
      `${SIGNING_ORG}:DOCUMENT_OPENED:${doc}:2026-01-01T12:00:03.000Z`,
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
    s.fake.reject(a.envelope_id!, undefined, 'Pas d’accord')
    let res = await s.handler(
      s.fake.webhookRequest(
        URL_,
        'DOCUMENT_REJECTED',
        a.envelope_id!,
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
        b.envelope_id!,
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
    s.fake.complete(row.envelope_id!)
    const res = await s.handler(
      s.fake.webhookRequest(
        URL_,
        'DOCUMENT_COMPLETED',
        row.envelope_id!,
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
      envelope_id: null,
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
      s.fake.webhookRequest(URL_, 'DOCUMENT_SENT', row.envelope_id!),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
    assertFalse(rpcNames(s.supabase).includes('apply_signing_event'))
  })
})

Deno.test('signing-webhook: an unknown envelope → 200 not_found, reported with ids only', async () => {
  await run(async () => {
    const s = setup()
    await sentRequest(s.fake, s.db)
    s.db.requests.clear()
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(URL_, 'DOCUMENT_OPENED', fakeEnvelopeId(1)),
      )
      assertEquals(await outcome(res), { status: 200, outcome: 'not_found' })
    })
    const report = JSON.stringify(lines)
    assert(report.includes('signing_event_not_found'))
    assertFalse(report.includes('@'))
  })
})

Deno.test('signing-webhook: a late event of an envelope a re-send superseded → 200 ignored, not reported', async () => {
  await run(async () => {
    const s = setup()
    const old = await sentRequest(s.fake, s.db)
    // A re-send replaced the first envelope (cancelled first) with a second.
    const row = await sentRequest(s.fake, s.db, { id: old.id })
    row.superseded_envelope_ids = [old.envelope_id!]
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_CANCELLED',
          old.envelope_id!,
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
      s.fake.complete(row.envelope_id!)
      const lines = await captureConsole('error', async () => {
        const res = await s.handler(
          s.fake.webhookRequest(
            URL_,
            'DOCUMENT_COMPLETED',
            row.envelope_id!,
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
    s.fake.complete(row.envelope_id!)
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_COMPLETED',
          row.envelope_id!,
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
    s.fake.complete(row.envelope_id!)
    s.fake.failures.download = 502
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        s.fake.webhookRequest(
          URL_,
          'DOCUMENT_COMPLETED',
          row.envelope_id!,
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
        row.envelope_id!,
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
            row.envelope_id!,
          ),
        )
        assertEquals(res.status, status)
      })
      assertFalse(rpcNames(s.supabase).includes('apply_signing_event'))
    }
  })
})

// ---------------------------------------------------------------------------
// Envelope API (plan E-4)
// ---------------------------------------------------------------------------
/** The fake's webhook for `event`, its JSON body changed by `edit`, re-posted. */
async function edited(
  s: ReturnType<typeof setup>,
  event: string,
  envelopeId: string,
  edit: (body: Record<string, Record<string, unknown>>) => void,
): Promise<Request> {
  const body = await s.fake.webhookRequest(URL_, event, envelopeId).json()
  edit(body)
  return post(JSON.stringify(body))
}

Deno.test('signing-webhook: a missing or malformed envelopeId → 400 after the externalId check, nothing claimed', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    for (
      const envelopeId of [
        undefined,
        null,
        12,
        '12',
        'envelope_',
        'envelope_a/b',
      ]
    ) {
      const req = await edited(s, 'DOCUMENT_OPENED', row.envelope_id!, (b) => {
        if (envelopeId === undefined) delete b.payload.envelopeId
        else b.payload.envelopeId = envelopeId
      })
      assertEquals((await s.handler(req)).status, 400, String(envelopeId))
    }
    // An envelope made outside the app: ignored before its envelope id is read.
    const outside = await edited(
      s,
      'DOCUMENT_OPENED',
      row.envelope_id!,
      (b) => {
        b.payload.externalId = null
        b.payload.envelopeId = 'not an envelope'
      },
    )
    assertEquals(await outcome(await s.handler(outside)), {
      status: 200,
      outcome: 'ignored',
    })
    assertFalse(rpcNames(s.supabase).includes('claim_webhook_event'))
  })
})

Deno.test('signing-webhook: the legacy numeric id and the Recipient copy are ignored', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {}, SIGNERS)
    s.fake.open(row.envelope_id!)
    for (const id of [undefined, 999, 'x', -1]) {
      s.db.events.clear()
      const req = await edited(s, 'DOCUMENT_OPENED', row.envelope_id!, (b) => {
        if (id === undefined) delete b.payload.id
        else b.payload.id = id
        b.payload.Recipient = [{ id: 'garbage' }]
      })
      const res = await outcome(await s.handler(req))
      assertEquals(res.status, 200, String(id))
      assert(['applied', 'ignored'].includes(res.outcome), String(id))
    }
    assertEquals(s.db.requests.get(row.id)!.status, 'viewed')
  })
})

Deno.test('signing-webhook: the claim holds the envelope id and no recipient token, address or legacy id', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db, {}, SIGNERS)
    s.fake.open(row.envelope_id!)
    const req = s.fake.webhookRequest(URL_, 'DOCUMENT_OPENED', row.envelope_id!)
    const sent = await req.clone().json()
    assertEquals(sent.payload.id, 1, 'Documenso sends the legacy id')
    assert(sent.payload.recipients[0].token, "and the recipients' tokens")
    assertEquals((await s.handler(req)).status, 200)
    const claim = s.supabase.calls.find((c) => c.fn === 'claim_webhook_event')!
    assertEquals(claim.args.p_payload, {
      event: 'DOCUMENT_OPENED',
      envelope_id: row.envelope_id,
      external_id: row.id,
    })
    const text = JSON.stringify([claim.args, [...s.db.events.values()]])
    for (const secret of ['token-', '@']) {
      assertFalse(text.includes(secret), secret)
    }
  })
})

Deno.test('signing-webhook: createdAt is ISO-normalised in the claim id; an unreadable one falls back to updatedAt, then unversioned', async () => {
  await run(async () => {
    const s = setup()
    const row = await sentRequest(s.fake, s.db)
    const envelopeId = row.envelope_id!
    const cases: [unknown, unknown, string][] = [
      ['2026-10-08T14:00:00Z', null, '2026-10-08T14:00:00.000Z'],
      ['2026-10-08T10:00:00-04:00', null, '2026-10-08T14:00:00.000Z'],
      ['not a time', '2026-10-08T15:00:00Z', '2026-10-08T15:00:00.000Z'],
      ['+275760-09-13T00:00:00.000Z', 'nope', 'unversioned'],
      [null, null, 'unversioned'],
    ]
    for (const [createdAt, updatedAt, version] of cases) {
      s.supabase.calls.length = 0
      const req = await edited(s, 'DOCUMENT_SENT', envelopeId, (b) => {
        ;(b as Record<string, unknown>).createdAt = createdAt
        b.payload.updatedAt = updatedAt
      })
      assertEquals((await s.handler(req)).status, 200, String(createdAt))
      const claim = s.supabase.calls.find((c) =>
        c.fn === 'claim_webhook_event'
      )!
      assertEquals(
        claim.args.p_event_id,
        `${SIGNING_ORG}:DOCUMENT_SENT:${envelopeId}:${version}`,
      )
      assert(String(claim.args.p_event_id).length <= 200)
    }
  })
})
