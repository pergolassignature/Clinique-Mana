import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  fakeSupabase,
  type RpcRoute,
  type StorageRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/storage-upload'
const FILE_ID = '00000000-0000-4000-8000-0000000000f1'
const OTHER_ORG = '00000000-0000-4000-8000-000000000002'
const PATH = `${ORG_ID}/core/${ORG_ID}/${FILE_ID}.png`
const SIGNED_URL =
  `http://127.0.0.1:55321/storage/v1/object/upload/sign/org-assets/${PATH}?token=local-dev-upload-token`

const BODY = {
  purpose: 'org_logo',
  subject_type: 'organization',
  subject_id: ORG_ID,
  original_name: 'Logo Clinique Tremblay.png',
  mime_type: 'image/png',
  size_bytes: 52_000,
}

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
  pending?: RpcRoute
  sign?: StorageRoute
  limit?: RpcRoute
} = {}) {
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: { data: accessFixture(['settings.manage']) },
      create_pending_upload: opts.pending ?? {
        data: [{ file_id: FILE_ID, bucket: 'org-assets', object_path: PATH }],
      },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: opts.limit ??
        { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }] },
    },
    storage: {
      createSignedUploadUrl: opts.sign ??
        ((_bucket, path) => ({
          data: {
            signedUrl: SIGNED_URL,
            path,
            token: 'local-dev-upload-token',
          },
        })),
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
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

Deno.test('storage-upload: create_pending_upload as the caller, then a signed upload URL for the RPC path → 200', async () => {
  await run(async () => {
    const { handler, user, service } = harness()
    const res = await handler(post(BODY))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      file_id: FILE_ID,
      bucket: 'org-assets',
      path: PATH,
      token: 'local-dev-upload-token',
      signed_url: SIGNED_URL,
    })
    assertEquals(user.calls[1], {
      fn: 'create_pending_upload',
      args: {
        p_purpose: 'org_logo',
        p_subject_type: 'organization',
        p_subject_id: ORG_ID,
        p_original_name: 'Logo Clinique Tremblay.png',
        p_mime_type: 'image/png',
        p_size_bytes: 52_000,
      },
    })
    // The service client signs the RPC's path in the RPC's bucket, no upsert.
    assertEquals(service.storageCalls, [{
      bucket: 'org-assets',
      method: 'createSignedUploadUrl',
      args: [PATH],
    }])
    // One hit on the caller's upload limit, before the RPC.
    assertEquals(service.calls.map((c) => [c.fn, c.args.p_bucket]), [
      ['consume_rate_limit', 'storage.upload_user'],
    ])
  })
})

Deno.test("storage-upload: over the caller's limit → 429 with Retry-After; the limiter down → 503; no row created", async () => {
  await run(async () => {
    const refused = harness({
      limit: { data: [{ allowed: false, hits: 61, retry_after_seconds: 120 }] },
    })
    const res = await refused.handler(post(BODY))
    assertEquals(await errorOf(res), {
      status: 429,
      code: 'rate_limited',
      message: 'Too many attempts',
    })
    assertEquals(res.headers.get('Retry-After'), '120')
    assertEquals(refused.user.calls.map((c) => c.fn), ['get_my_access'])

    const down = harness({ limit: { error: { code: 'XX000' } } })
    await reports(async () => {
      assertEquals((await down.handler(post(BODY))).status, 503)
    })
    assertEquals(down.user.calls.map((c) => c.fn), ['get_my_access'])
    assertEquals(down.service.storageCalls, [])
  })
})

Deno.test('storage-upload: a P0001 is passed through with its French message; nothing is signed', async () => {
  await run(async () => {
    const message = 'Ce fichier dépasse la taille permise (2 Mo).'
    const { handler, service } = harness({
      pending: { error: { code: 'P0001', message } },
    })
    assertEquals(await errorOf(await handler(post(BODY))), {
      status: 400,
      code: 'invalid_request',
      message,
    })
    assertEquals(service.storageCalls, [])
  })
})

Deno.test('storage-upload: 42501 (no upload permission) → 403; 22023 → 400; nothing is signed', async () => {
  await run(async () => {
    for (
      const [code, status] of [['42501', 403], ['22023', 400]] as const
    ) {
      const { handler, service } = harness({
        pending: { error: { code, message: 'Permission refusée : x' } },
      })
      const res = await handler(post(BODY))
      assertEquals(res.status, status, code)
      assertEquals(service.storageCalls, [], code)
    }
  })
})

Deno.test('storage-upload: another RPC error → 500, reported with ids only', async () => {
  await run(async () => {
    const { handler, service } = harness({
      pending: { error: { code: '23514', message: 'check violated' } },
    })
    const logged = await reports(async () => {
      assertEquals((await handler(post(BODY))).status, 500)
    })
    assertEquals(logged, [{
      fn: 'storage-upload',
      code: 'create_pending_failed',
      ids: { org_id: ORG_ID },
    }])
    assertEquals(service.storageCalls, [])
  })
})

Deno.test('storage-upload: the body takes no path, bucket or org; a bad field → 400 before any RPC', async () => {
  await run(async () => {
    const bad = [
      { ...BODY, path: `${ORG_ID}/core/${ORG_ID}/mine.png` },
      { ...BODY, bucket: 'documents' },
      { ...BODY, org_id: OTHER_ORG },
      { ...BODY, original_name: '../etc/passwd' },
      { ...BODY, original_name: 'a\\b.png' },
      { ...BODY, original_name: 'tab\there.png' },
      { ...BODY, original_name: 'del\u007f.png' },
      { ...BODY, original_name: 'nel\u0085.png' },
      { ...BODY, original_name: '   ' },
      { ...BODY, original_name: 'x'.repeat(201) },
      { ...BODY, subject_id: 'not-a-uuid' },
      { ...BODY, subject_type: 'Organization' },
      { ...BODY, purpose: 'org-logo' },
      { ...BODY, size_bytes: 0 },
      { ...BODY, size_bytes: 1.5 },
      { ...BODY, size_bytes: 2 ** 31 },
      { ...BODY, mime_type: undefined },
    ]
    for (const body of bad) {
      const { handler, user } = harness()
      const res = await handler(post(body))
      assertEquals(res.status, 400, JSON.stringify(body))
      assertEquals(
        user.calls.map((c) => c.fn),
        ['get_my_access'],
        JSON.stringify(body),
      )
    }
  })
})

Deno.test('storage-upload: a 200-character name with accents and emoji is accepted', async () => {
  await run(async () => {
    const name = `${'é'.repeat(190)}🙂🙂.png`.padEnd(200, 'x')
    const { handler, user } = harness()
    assertEquals(
      (await handler(post({ ...BODY, original_name: name }))).status,
      200,
    )
    assertEquals(user.calls[1].args.p_original_name, name)
  })
})

Deno.test('storage-upload: an RPC path that is not {org}/{module}/{subject}/{file_id}.{ext} is never signed → 500, reported', async () => {
  await run(async () => {
    const wrong = [
      `${OTHER_ORG}/core/${ORG_ID}/${FILE_ID}.png`, // another org
      `${ORG_ID}/core/${OTHER_ORG}/${FILE_ID}.png`, // another subject
      `${ORG_ID}/core/${ORG_ID}/${OTHER_ORG}.png`, // another file id
      `${ORG_ID}/core/${ORG_ID}/${FILE_ID}.pdf`, // another extension
      `${ORG_ID}/core/${ORG_ID}/Logo Clinique Tremblay.png`, // a file name
      `${ORG_ID}/core/../${ORG_ID}/${FILE_ID}.png`,
      `${ORG_ID}/Core/${ORG_ID}/${FILE_ID}.png`,
    ]
    for (const object_path of wrong) {
      const { handler, service } = harness({
        pending: {
          data: [{ file_id: FILE_ID, bucket: 'org-assets', object_path }],
        },
      })
      const logged = await reports(async () => {
        assertEquals((await handler(post(BODY))).status, 500, object_path)
      })
      assertEquals(logged, [{
        fn: 'storage-upload',
        code: 'unexpected_pending_upload',
        ids: { org_id: ORG_ID, file_id: FILE_ID },
      }], object_path)
      assertEquals(service.storageCalls, [], object_path)
    }
  })
})

Deno.test('storage-upload: an unknown bucket or a malformed RPC result → 500, nothing signed', async () => {
  await run(async () => {
    for (
      const data of [
        [{ file_id: FILE_ID, bucket: 'avatars', object_path: PATH }],
        [],
        null,
        [{ file_id: FILE_ID, bucket: 'org-assets' }],
      ]
    ) {
      const { handler, service } = harness({ pending: { data } })
      await reports(async () => {
        assertEquals((await handler(post(BODY))).status, 500)
      })
      assertEquals(service.storageCalls, [])
    }
  })
})

Deno.test('storage-upload: signing fails → 500, reported (the pending row is purged after 24 h)', async () => {
  await run(async () => {
    const { handler } = harness({
      sign: () => ({ error: { message: 'storage down' } }),
    })
    const logged = await reports(async () => {
      const res = await handler(post(BODY))
      assertEquals(await errorOf(res), {
        status: 500,
        code: 'internal',
        message: 'Upload could not be prepared',
      })
    })
    assertEquals(logged, [{
      fn: 'storage-upload',
      code: 'signed_upload_failed',
      ids: { org_id: ORG_ID, file_id: FILE_ID },
    }])
  })
})

Deno.test('storage-upload: no bearer → 401; GET → 405; OPTIONS → CORS preflight', async () => {
  await run(async () => {
    const { handler, user } = harness()
    assertEquals((await handler(post(BODY, null))).status, 401)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    const preflight = await handler(new Request(URL_, { method: 'OPTIONS' }))
    assertEquals(preflight.status, 200)
    assertEquals(preflight.headers.get('Access-Control-Allow-Origin'), '*')
    assertEquals(user.calls, [])
  })
})
