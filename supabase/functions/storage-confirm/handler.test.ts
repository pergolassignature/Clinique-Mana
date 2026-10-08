import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  type FakeResult,
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
import { sha256Hex } from '../_shared/storage.ts'

const URL_ = 'http://fn.test/functions/v1/storage-confirm'
const FILE_ID = '00000000-0000-4000-8000-0000000000f1'
const PNG_PATH = `${ORG_ID}/core/${ORG_ID}/${FILE_ID}.png`
const PDF_PATH = `${ORG_ID}/core/${ORG_ID}/${FILE_ID}.pdf`
const MB = 1_048_576

// Fixtures, built as bytes (no binary file is committed).
const ascii = (s: string) => new TextEncoder().encode(s)
const be32 = (
  n: number,
) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

/** A complete PNG (signature, IHDR, an IDAT of `pad` bytes, IEND). */
const png = (width: number, height: number, pad = 64) =>
  new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height)],
    ...[8, 6, 0, 0, 0, 0, 0, 0, 0],
    ...be32(pad),
    ...ascii('IDAT'),
    ...new Uint8Array(pad + 4),
    ...[0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
  ])

/** A JPEG: SOI, APP0, a large EXIF segment, the frame header, SOS, EOI. */
const jpeg = (width: number, height: number) =>
  new Uint8Array([
    ...[
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      16,
      ...ascii('JFIF\0'),
      ...new Uint8Array(9),
    ],
    ...[0xff, 0xe1, 0xea, 0x60, ...new Uint8Array(0xea60 - 2)],
    ...[
      0xff,
      0xc0,
      0,
      11,
      8,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
    ],
    ...[1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0, 0, 0xff, 0xd9],
  ])

const pdf = () =>
  ascii(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n',
  )

/** `bytes` as a stream of chunks of `size` bytes (like a fetch body). */
const streamOf = (bytes: Uint8Array, size = 16_384) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size))
      }
      controller.close()
    },
  })

interface Pending {
  bucket: string
  object_path: string
  mime_type: string
  size_bytes: number
  max_bytes: number
  max_image_side: number | null
}

const PNG_PENDING: Pending = {
  bucket: 'org-assets',
  object_path: PNG_PATH,
  mime_type: 'image/png',
  size_bytes: 1000,
  max_bytes: 2 * MB,
  max_image_side: 4000,
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
  /** The stored object: its bytes, and the content type storage recorded. */
  object?: { bytes: Uint8Array; contentType: string } | null
  info?: StorageRoute
  download?: StorageRoute
  remove?: FakeResult
  reject?: FakeResult
  confirm?: FakeResult
  /** The idempotency read of `stored_files` (no row by default). */
  lookup?: FakeResult
  limit?: RpcRoute
} = {}) {
  /** The service client's writes, in order. */
  const events: string[] = []
  const object = opts.object === undefined
    ? { bytes: png(640, 480), contentType: 'image/png' }
    : opts.object
  const missing = {
    error: Object.assign(new Error('Object not found'), {
      status: 400,
      statusCode: '404',
    }),
  }
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: { data: accessFixture(['settings.manage']) },
      get_pending_upload: opts.pending ?? { data: [PNG_PENDING] },
    },
  })
  const service = fakeSupabase({
    tables: { stored_files: () => opts.lookup ?? { data: null } },
    rpc: {
      consume_rate_limit: opts.limit ??
        { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }] },
      confirm_stored_file: () => {
        events.push('confirm_stored_file')
        return opts.confirm ?? { data: null }
      },
      reject_stored_file: () => {
        events.push('reject_stored_file')
        return opts.reject ?? { data: null }
      },
    },
    storage: {
      info: opts.info ??
        (() =>
          object
            ? {
              data: {
                contentType: object.contentType,
                size: object.bytes.length,
              },
            }
            : missing),
      download: opts.download ??
        (() => object ? { data: streamOf(object.bytes) } : missing),
      remove: (_bucket, paths) => {
        events.push(`remove:${JSON.stringify(paths)}`)
        return opts.remove ?? { data: [] }
      },
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
    now: fixedClock('2026-10-08T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), user, service, events }
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

const WRONG_TYPE = {
  status: 400,
  code: 'invalid_request',
  message: "Ce fichier n'est pas du type annoncé.",
  refusal: true,
}
/** Rejected first, then removed. */
const REFUSED = ['reject_stored_file', `remove:${JSON.stringify([PNG_PATH])}`]
/** The idempotency read: by id, the caller's org, uploaded by the caller, ready. */
const LOOKUP = {
  table: 'stored_files',
  columns: 'id',
  eq: { id: FILE_ID, org_id: ORG_ID, uploaded_by: ADMIN_ID, status: 'ready' },
  single: true,
}

Deno.test('storage-confirm: a PNG within its caps → confirm_stored_file with its SHA-256 and real size → 200', async () => {
  await run(async () => {
    const bytes = png(640, 480)
    const { handler, user, service, events } = harness({
      object: { bytes, contentType: 'image/png' },
    })
    const res = await handler(post({ file_id: FILE_ID }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { file_id: FILE_ID })
    assertEquals(user.calls[1], {
      fn: 'get_pending_upload',
      args: { p_file_id: FILE_ID },
    })
    assertEquals(
      service.storageCalls.map((c) => [c.bucket, c.method, c.args]),
      [['org-assets', 'info', [PNG_PATH]], [
        'org-assets',
        'download',
        [PNG_PATH],
      ]],
    )
    assertEquals(events, ['confirm_stored_file'])
    assertEquals(service.tableCalls, [])
    assertEquals(service.calls.at(-1)?.args, {
      p_file_id: FILE_ID,
      p_sha256: sha256Hex(bytes),
      p_size_bytes: bytes.length,
    })
  })
})

Deno.test('storage-confirm: a PDF (no image cap) and a JPEG whose frame header is past a 60 KB EXIF segment', async () => {
  await run(async () => {
    const doc = pdf()
    const pdfRun = harness({
      pending: {
        data: [{
          ...PNG_PENDING,
          bucket: 'documents',
          object_path: PDF_PATH,
          mime_type: 'application/pdf',
          max_bytes: 10 * MB,
          max_image_side: null,
        }],
      },
      object: { bytes: doc, contentType: 'application/pdf' },
    })
    assertEquals((await pdfRun.handler(post({ file_id: FILE_ID }))).status, 200)
    assertEquals(pdfRun.service.calls.at(-1)?.args.p_sha256, sha256Hex(doc))

    const photo = jpeg(4000, 3000)
    const jpegRun = harness({
      pending: {
        data: [{
          ...PNG_PENDING,
          object_path: PNG_PATH.replace('.png', '.jpg'),
          mime_type: 'image/jpeg',
        }],
      },
      object: { bytes: photo, contentType: 'image/jpeg' },
    })
    assertEquals(
      (await jpegRun.handler(post({ file_id: FILE_ID }))).status,
      200,
    )
    assertEquals(jpegRun.events, ['confirm_stored_file'])
  })
})

Deno.test('storage-confirm: a PNG declared as a PDF → reject_stored_file, then remove, then 400', async () => {
  await run(async () => {
    const { handler, events, service } = harness({
      pending: {
        data: [{
          ...PNG_PENDING,
          object_path: PNG_PATH,
          mime_type: 'application/pdf',
          max_image_side: null,
        }],
      },
      object: { bytes: png(10, 10), contentType: 'application/pdf' },
    })
    assertEquals(
      await errorOf(await handler(post({ file_id: FILE_ID }))),
      WRONG_TYPE,
    )
    assertEquals(events, REFUSED)
    assertEquals(service.calls.at(-1), {
      fn: 'reject_stored_file',
      args: { p_file_id: FILE_ID },
    })
    assertEquals(service.storageCalls.at(-1)?.args, [[PNG_PATH]])
  })
})

Deno.test('storage-confirm: a text file renamed .png (sniff refuses it) → refused and removed', async () => {
  await run(async () => {
    const { handler, events } = harness({
      object: {
        bytes: ascii('bonjour, ceci est du texte\n'),
        contentType: 'image/png',
      },
    })
    assertEquals(
      await errorOf(await handler(post({ file_id: FILE_ID }))),
      WRONG_TYPE,
    )
    assertEquals(events, REFUSED)
  })
})

Deno.test('storage-confirm: a stored content type other than the declared one → refused without downloading', async () => {
  await run(async () => {
    for (
      const contentType of [
        'image/jpeg',
        'text/html',
        'image/png; charset=utf-8',
        '',
      ]
    ) {
      const { handler, events, service } = harness({
        object: { bytes: png(10, 10), contentType },
      })
      assertEquals(
        await errorOf(await handler(post({ file_id: FILE_ID }))),
        WRONG_TYPE,
        contentType,
      )
      assertEquals(events, REFUSED, contentType)
      assertEquals(service.storageCalls.map((c) => c.method), [
        'info',
        'remove',
      ], contentType)
    }
  })
})

Deno.test('storage-confirm: a real size above the purpose limit → refused with the limit in Mo', async () => {
  await run(async () => {
    const bytes = png(10, 10, 3 * MB)
    const tooBig = {
      status: 400,
      code: 'invalid_request',
      message: 'Ce fichier dépasse la taille permise (2 Mo).',
      refusal: true,
    }
    // Caught from storage's size, before any download.
    const early = harness({ object: { bytes, contentType: 'image/png' } })
    assertEquals(
      await errorOf(await early.handler(post({ file_id: FILE_ID }))),
      tooBig,
    )
    assertEquals(early.events, REFUSED)
    assertEquals(early.service.storageCalls.map((c) => c.method), [
      'info',
      'remove',
    ])

    // And while streaming, when the recorded size understates it.
    const late = harness({
      object: { bytes, contentType: 'image/png' },
      info: () => ({ data: { contentType: 'image/png', size: 1000 } }),
    })
    assertEquals(
      await errorOf(await late.handler(post({ file_id: FILE_ID }))),
      tooBig,
    )
    assertEquals(late.events, REFUSED)

    const odd = harness({
      pending: { data: [{ ...PNG_PENDING, max_bytes: 1_572_864 }] },
      object: { bytes, contentType: 'image/png' },
    })
    assertEquals(
      (await errorOf(await odd.handler(post({ file_id: FILE_ID })))).message,
      'Ce fichier dépasse la taille permise (1,5 Mo).',
    )
  })
})

Deno.test('storage-confirm: the stream is cancelled once the limit is passed (never buffered whole)', async () => {
  await run(async () => {
    let pulled = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(
          pulled === 1 ? png(10, 10).subarray(0, 33) : new Uint8Array(65_536),
        )
      },
      cancel() {
        cancelled = true
      },
    })
    const { handler, events } = harness({
      info: () => ({ data: { contentType: 'image/png', size: 1000 } }),
      download: () => ({ data: endless }),
    })
    assertEquals((await handler(post({ file_id: FILE_ID }))).status, 400)
    assert(cancelled, 'the download was cancelled')
    assert(pulled <= 36, `read ${pulled} chunks for a 2 Mo cap`)
    assertEquals(events, REFUSED)
  })
})

Deno.test('storage-confirm: an image over max_image_side (either side) → refused', async () => {
  await run(async () => {
    for (const [width, height] of [[4001, 10], [10, 4001], [70_000, 70_000]]) {
      const { handler, events } = harness({
        object: { bytes: png(width, height), contentType: 'image/png' },
      })
      assertEquals(await errorOf(await handler(post({ file_id: FILE_ID }))), {
        status: 400,
        code: 'invalid_request',
        message:
          'Cette image dépasse la taille permise (4 000 pixels de côté).',
        refusal: true,
      }, `${width} × ${height}`)
      assertEquals(events, REFUSED)
    }
    // Exactly at the cap is accepted.
    const atCap = harness({
      object: { bytes: png(4000, 4000), contentType: 'image/png' },
    })
    assertEquals((await atCap.handler(post({ file_id: FILE_ID }))).status, 200)
  })
})

Deno.test('storage-confirm: an image whose size cannot be read, or is zero, → refused', async () => {
  await run(async () => {
    const noFrame = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      2,
      0xff,
      0xda,
      0,
      2,
      0xff,
      0xd9,
    ])
    for (
      const [name, bytes, mime] of [
        ['JPEG without a frame header', noFrame, 'image/jpeg'],
        ['PNG 0 × 10', png(0, 10), 'image/png'],
      ] as const
    ) {
      const { handler, events } = harness({
        pending: { data: [{ ...PNG_PENDING, mime_type: mime }] },
        object: { bytes, contentType: mime },
      })
      assertEquals(await errorOf(await handler(post({ file_id: FILE_ID }))), {
        status: 400,
        code: 'invalid_request',
        message: 'Cette image ne peut pas être lue.',
        refusal: true,
      }, name)
      assertEquals(events, REFUSED, name)
    }
  })
})

Deno.test("storage-confirm: another user's (or an unknown, expired, rejected) file → 404, nothing downloaded", async () => {
  await run(async () => {
    const { handler, service } = harness({ pending: { data: [] } })
    assertEquals(await errorOf(await handler(post({ file_id: FILE_ID }))), {
      status: 404,
      code: 'not_found',
      message: 'Upload not found',
    })
    assertEquals(service.storageCalls, [])
    assertEquals(service.calls.map((c) => c.fn), ['consume_rate_limit'])
    // Ready and uploaded by the caller, in the caller's org, or nothing.
    assertEquals(service.tableCalls, [LOOKUP])
  })
})

Deno.test('storage-confirm: a retry after a lost answer (already ready, uploaded by the caller) → 200, nothing downloaded or written', async () => {
  await run(async () => {
    const { handler, service, events } = harness({
      pending: { data: [] },
      lookup: { data: { id: FILE_ID } },
    })
    const res = await handler(post({ file_id: FILE_ID }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { file_id: FILE_ID })
    assertEquals(service.tableCalls, [LOOKUP])
    assertEquals(service.storageCalls, [])
    assertEquals(events, [])
  })
})

Deno.test('storage-confirm: a concurrent confirm got there first (confirm_stored_file 22023) → 200 when ready by the caller, else 409; not reported', async () => {
  await run(async () => {
    const won = harness({
      confirm: { error: { code: '22023' } },
      lookup: { data: { id: FILE_ID } },
    })
    const lost = harness({ confirm: { error: { code: '22023' } } })
    const logged = await reports(async () => {
      const res = await won.handler(post({ file_id: FILE_ID }))
      assertEquals(res.status, 200)
      assertEquals(await res.json(), { file_id: FILE_ID })
      assertEquals(
        await errorOf(await lost.handler(post({ file_id: FILE_ID }))),
        {
          status: 409,
          code: 'conflict',
          message: 'Upload already settled',
        },
      )
    })
    assertEquals(logged, [])
    assertEquals(won.service.tableCalls, [LOOKUP])
    assertEquals(lost.service.tableCalls, [LOOKUP])
    assertEquals(lost.events, ['confirm_stored_file'])
  })
})

Deno.test('storage-confirm: a refusal whose reject finds the row no longer pending (22023) → 409, the object is kept; not reported', async () => {
  await run(async () => {
    const { handler, events } = harness({
      object: { bytes: png(10, 10), contentType: 'image/jpeg' },
      reject: { error: { code: '22023' } },
    })
    const logged = await reports(async () => {
      assertEquals(
        (await errorOf(await handler(post({ file_id: FILE_ID })))).code,
        'conflict',
      )
    })
    assertEquals(logged, [])
    assertEquals(events, ['reject_stored_file'])
  })
})

Deno.test('storage-confirm: a reject failure is reported and removes nothing → 400 (the pending row is purged with its object)', async () => {
  await run(async () => {
    const { handler, events } = harness({
      object: { bytes: png(10, 10), contentType: 'image/jpeg' },
      reject: { error: { code: 'XX000' } },
    })
    const logged = await reports(async () => {
      assertEquals(
        await errorOf(await handler(post({ file_id: FILE_ID }))),
        WRONG_TYPE,
      )
    })
    assertEquals(events, ['reject_stored_file'])
    assertEquals(logged, [{
      fn: 'storage-confirm',
      code: 'reject_failed',
      ids: { org_id: ORG_ID, file_id: FILE_ID },
    }])
  })
})

Deno.test("storage-confirm: over the caller's limit → 429 with Retry-After; the limiter down → 503; nothing read", async () => {
  await run(async () => {
    const refused = harness({
      limit: { data: [{ allowed: false, hits: 121, retry_after_seconds: 90 }] },
    })
    const res = await refused.handler(post({ file_id: FILE_ID }))
    assertEquals(await errorOf(res), {
      status: 429,
      code: 'rate_limited',
      message: 'Too many attempts',
    })
    assertEquals(res.headers.get('Retry-After'), '90')
    assertEquals(refused.user.calls.map((c) => c.fn), ['get_my_access'])
    assertEquals(refused.service.calls.map((c) => c.args.p_bucket), [
      'storage.confirm_user',
    ])

    const down = harness({ limit: { error: { code: 'XX000' } } })
    await reports(async () => {
      assertEquals((await down.handler(post({ file_id: FILE_ID }))).status, 503)
    })
    assertEquals(down.user.calls.map((c) => c.fn), ['get_my_access'])
    assertEquals(down.service.storageCalls, [])
  })
})

Deno.test('storage-confirm: the object is not there yet → 400 « pas reçu », and the row stays pending', async () => {
  await run(async () => {
    const { handler, events } = harness({ object: null })
    assertEquals(await errorOf(await handler(post({ file_id: FILE_ID }))), {
      status: 400,
      code: 'invalid_request',
      message: "Le fichier n'a pas été reçu.",
      refusal: true,
    })
    assertEquals(events, [])
  })
})

Deno.test('storage-confirm: a remove failure is reported, and the file is still rejected → 400', async () => {
  await run(async () => {
    const { handler, events } = harness({
      object: { bytes: png(10, 10), contentType: 'image/jpeg' },
      remove: { error: { message: 'storage down' } },
    })
    const logged = await reports(async () => {
      assertEquals(
        await errorOf(await handler(post({ file_id: FILE_ID }))),
        WRONG_TYPE,
      )
    })
    assertEquals(events, REFUSED)
    assertEquals(logged, [{
      fn: 'storage-confirm',
      code: 'object_remove_failed',
      ids: { org_id: ORG_ID, file_id: FILE_ID },
    }])
  })
})

Deno.test('storage-confirm: storage or RPC failures → 500, reported with ids only; nothing rejected', async () => {
  await run(async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    const cases: [string, Parameters<typeof harness>[0]][] = [
      ['get_pending_failed', { pending: { error: { code: 'XX000' } } }],
      ['unexpected_pending_upload', {
        pending: { data: [{ bucket: 'org-assets' }] },
      }],
      ['object_info_failed', {
        info: () => ({
          error: Object.assign(new Error('down'), { status: 500 }),
        }),
      }],
      ['object_download_failed', {
        download: () => ({
          error: Object.assign(new Error('down'), { status: 500 }),
        }),
      }],
      ['object_read_failed', { download: () => ({ data: failing }) }],
      ['confirm_failed', { confirm: { error: { code: 'XX000' } } }],
      ['file_lookup_failed', {
        pending: { data: [] },
        lookup: { error: { code: 'XX000' } },
      }],
      ['file_lookup_failed', {
        confirm: { error: { code: '22023' } },
        lookup: { error: { code: 'XX000' } },
      }],
    ]
    for (const [code, opts] of cases) {
      const { handler, events } = harness(opts)
      const logged = await reports(async () => {
        assertEquals(
          (await handler(post({ file_id: FILE_ID }))).status,
          500,
          code,
        )
      })
      assertEquals(logged.map((l) => l.code), [code], code)
      assertEquals(logged[0].ids.org_id, ORG_ID, code)
      assert(!events.includes('reject_stored_file'), code)
    }
  })
})

Deno.test('storage-confirm: the body is { file_id } only; no bearer → 401; GET → 405', async () => {
  await run(async () => {
    for (
      const body of [{}, { file_id: 'x' }, { file_id: FILE_ID, path: PNG_PATH }]
    ) {
      const { handler, user } = harness()
      assertEquals(
        (await handler(post(body))).status,
        400,
        JSON.stringify(body),
      )
      assertEquals(user.calls.map((c) => c.fn), ['get_my_access'])
    }
    const { handler, user } = harness()
    assertEquals((await handler(post({ file_id: FILE_ID }, null))).status, 401)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    assertEquals(user.calls, [])
  })
})
