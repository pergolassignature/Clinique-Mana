import { assertEquals, assertRejects } from '@std/assert'
import { fakeSupabase } from '../testing/fake-supabase.ts'
import { loadAssets, MAX_ASSET_BYTES } from './assets.ts'
import { PdfError } from './model.ts'

const ORG = '00000000-0000-4000-8000-000000000001'
const refs = [
  { key: 'logo', bucket: 'org-assets', path: `${ORG}/core/${ORG}/a.png` },
  { key: 'signature', bucket: 'org-assets', path: `${ORG}/core/${ORG}/b.png` },
]

Deno.test('loadAssets: downloads every asset in parallel, by key', async () => {
  let inFlight = 0
  let peak = 0
  const fake = fakeSupabase({
    storage: {
      download: async (_bucket, path) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return { data: new Blob([String(path).slice(-5)]) }
      },
    },
  })
  const assets = await loadAssets(fake.client, refs)
  assertEquals(peak, 2)
  assertEquals(Object.keys(assets), ['logo', 'signature'])
  assertEquals(new TextDecoder().decode(assets.logo), 'a.png')
  assertEquals(new TextDecoder().decode(assets.signature), 'b.png')
  assertEquals(
    fake.storageCalls.map((c) => [c.bucket, c.method, c.args]),
    refs.map((r) => [r.bucket, 'download', [r.path]]),
  )
})

Deno.test('loadAssets: no refs, no storage call', async () => {
  const fake = fakeSupabase({})
  assertEquals(await loadAssets(fake.client, []), {})
  assertEquals(fake.storageCalls, [])
})

Deno.test('loadAssets: a failed download is asset_unavailable, naming only the key', async () => {
  const fake = fakeSupabase({
    storage: {
      download: (_bucket, path) =>
        String(path).endsWith('b.png')
          ? { error: { message: 'Object not found' } }
          : { data: new Blob(['x']) },
    },
  })
  const error = await assertRejects(
    () => loadAssets(fake.client, refs),
    PdfError,
  )
  assertEquals(error.code, 'asset_unavailable')
  assertEquals(error.message, 'asset « signature »: download failed')
})

Deno.test('loadAssets: an asset over the cap is refused', async () => {
  const fake = fakeSupabase({
    storage: {
      download: () => ({
        data: new Blob([new Uint8Array(MAX_ASSET_BYTES + 1)]),
      }),
    },
  })
  const error = await assertRejects(
    () => loadAssets(fake.client, refs.slice(0, 1)),
    PdfError,
  )
  assertEquals(error.code, 'asset_unavailable')
  assertEquals(error.message, 'asset « logo »: over 2 MB')
})
