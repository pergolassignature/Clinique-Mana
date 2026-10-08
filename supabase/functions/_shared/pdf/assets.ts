/**
 * Image assets for the renderer (P3-19): the clinic logo and the signature
 * image, read from storage by the service role. The database stays the source
 * of truth for object paths, so callers pass the bucket and path that their
 * RPC returned (e.g. `get_signing_context`), never a path built here.
 *
 * pdfmake-free: the renderer checks the image formats (`render.ts`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { type PdfAssets, PdfError } from './model.ts'

/** Per asset, the `org_logo` / `org_signature` upload cap (Task 3.24). */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024

/** An image to load, under the `assetKey` its document uses. */
export interface AssetRef {
  key: string
  bucket: string
  path: string
}

/**
 * Downloads every ref in parallel and returns the bytes by key. Throws
 * `PdfError('asset_unavailable')` when a download fails or an asset is over
 * `MAX_ASSET_BYTES`; the message names the key, never the path.
 */
export async function loadAssets(
  serviceClient: SupabaseClient,
  refs: AssetRef[],
): Promise<PdfAssets> {
  const entries = await Promise.all(refs.map(async ({ key, bucket, path }) => {
    const { data, error } = await serviceClient.storage.from(bucket).download(
      path,
    )
    if (error || !data) {
      throw new PdfError(
        'asset_unavailable',
        `asset « ${key} »: download failed`,
      )
    }
    if (data.size > MAX_ASSET_BYTES) {
      throw new PdfError('asset_unavailable', `asset « ${key} »: over 2 MB`)
    }
    return [key, new Uint8Array(await data.arrayBuffer())] as const
  }))
  return Object.fromEntries(entries)
}
