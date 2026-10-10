import { useCallback, useState } from 'react'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/auth-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { SIGN_BATCH_MAX, signedFileUrl, signedFileUrls, type ImageVariant } from './api'

/** Read URLs live 300 s (P3-33): one is stale after 240 s, before it expires. */
const SIGNED_URL_REFRESH_MS = 240_000

/** The variant's place in a key: nothing for the original, so the original's keys are unchanged. */
const variantPart = (variant: ImageVariant | undefined) => (variant ? ([variant] as const) : ([] as const))

export const storageKeys = {
  all: ['storage'] as const,
  /** Per user as well as per file (and size): a URL signed for one user is never served to the next (#10). */
  signedUrl: (userId: string, fileId: string, variant?: ImageVariant) => [...storageKeys.all, 'signedUrl', userId, fileId, ...variantPart(variant)] as const,
  /** One batch of `useSignedFileUrls` (sorted ids), per user too. */
  signedUrls: (userId: string, fileIds: readonly string[], variant?: ImageVariant) =>
    [...storageKeys.all, 'signedUrls', userId, fileIds.join(','), ...variantPart(variant)] as const,
}

/** A 4xx (not readable: 404; 120 an hour: 429) is shown, not retried; anything else once. */
const retrySigning = (failures: number, error: unknown) => failures < 1 && !(error instanceof FunctionCallError && error.status >= 400 && error.status < 500)

type SignedBatch = Awaited<ReturnType<typeof signedFileUrls>>

/**
 * A still-fresh URL for `fileId` that a list already signed (a `useSignedFileUrls` batch of the
 * same user and size, under 240 s old), with when it was signed: the record header then shows
 * the photo the list row just loaded, from the browser's memory, without a `storage-sign` call.
 */
function urlFromBatches(queryClient: QueryClient, userId: string, fileId: string, variant: ImageVariant | undefined) {
  const prefix = [...storageKeys.all, 'signedUrls', userId] as const
  const length = prefix.length + 1 + (variant ? 1 : 0)
  let found: { data: { url: string; expiresAt: string }; updatedAt: number } | undefined
  for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
    if (query.queryKey.length !== length || (variant && query.queryKey[length - 1] !== variant)) continue
    const batch = query.state.data as SignedBatch | undefined
    const url = batch?.urls.get(fileId)
    const updatedAt = query.state.dataUpdatedAt
    if (!batch || !url || Date.now() - updatedAt >= SIGNED_URL_REFRESH_MS) continue
    if (!found || updatedAt > found.updatedAt) found = { data: { url, expiresAt: batch.expiresAt }, updatedAt }
  }
  return found
}

interface SignedFileUrlOptions {
  /**
   * Replace the URL every 240 s while it is shown: for a download link, which must still work
   * when it is clicked. Off for an `<img>`: it has loaded by then, and a new URL would reload it.
   */
  refresh?: boolean
  /** A smaller copy of an image (`avatar`, `card`, `print`; PERF-1); the original without. */
  variant?: ImageVariant
}

/**
 * A stored file's read URL (`storage-sign`), for an `<img>` or a link; nothing without a file.
 *
 * - Fresh for 240 s; with `refresh` (a download link) also refetched every 240 s while shown, so
 *   the 5-minute URL in use is replaced before it expires. An image whose URL has expired asks
 *   for a new one itself (`refetch`, from its `onError`). Once unused the URL is dropped after
 *   30 s, so it never outlives its expiry in the cache (240 + 30 < 300): a later mount signs a
 *   new one.
 * - Keyed by the signed-in user (and the variant). The cache is also cleared when the user changes
 *   (AccessProvider).
 * - Starts from a fresh URL a list batch of the same size already holds (`urlFromBatches`), with
 *   its signing time, so it goes stale when that one does: the same URL, so the browser reuses
 *   the image it has (memory or HTTP cache, never a service worker).
 * - A 4xx (not readable: 404; 120 an hour: 429) is shown, not retried.
 */
export function useSignedFileUrl(fileId: string | null, { refresh = false, variant }: SignedFileUrlOptions = {}) {
  const userId = useAuth().session?.user.id ?? 'anonymous'
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: storageKeys.signedUrl(userId, fileId ?? '', variant),
    queryFn: ({ signal }) => signedFileUrl(fileId as string, { signal, ...(variant && { variant }) }),
    initialData: () => (fileId ? urlFromBatches(queryClient, userId, fileId, variant)?.data : undefined),
    initialDataUpdatedAt: () => (fileId ? urlFromBatches(queryClient, userId, fileId, variant)?.updatedAt : undefined),
    enabled: fileId !== null,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: refresh ? SIGNED_URL_REFRESH_MS : false,
    gcTime: 30_000,
    retry: retrySigning,
  })
}

const EMPTY_URLS: ReadonlyMap<string, string> = new Map()

/**
 * The batches `ids` are signed in: the batches already asked for are kept while one of their ids
 * is still wanted, and only the new ids form new batches (sorted, ≤ SIGN_BATCH_MAX). Rows coming
 * into view add a batch of their own instead of signing every visible row again.
 */
function useStableBatches(ids: readonly string[]): readonly (readonly string[])[] {
  const wanted = [...new Set(ids)].sort()
  const key = wanted.join(',')
  const [state, setState] = useState<{ key: string; batches: readonly (readonly string[])[] }>({ key: '', batches: [] })
  if (state.key === key) return state.batches
  const keep = new Set(wanted)
  const kept = state.batches.filter((batch) => batch.some((id) => keep.has(id)))
  const covered = new Set(kept.flat())
  const fresh = wanted.filter((id) => !covered.has(id))
  const batches = [...kept]
  for (let i = 0; i < fresh.length; i += SIGN_BATCH_MAX) batches.push(fresh.slice(i, i + SIGN_BATCH_MAX))
  // Adjusting state while rendering (React's documented pattern): the next render reads it back.
  setState({ key, batches })
  return batches
}

/**
 * Read URLs for many stored files (a list's photos), signed in batches of ≤ 50 by one
 * `storage-sign` call each (its batch mode): the per-user limit (120 an hour) counts a call, not a
 * file. `urls` maps each readable file to its URL; an unreadable one is absent (the caller shows
 * its fallback). Same lifetimes as `useSignedFileUrl`: fresh 240 s, dropped 30 s after its last
 * use, keyed by the signed-in user. Pass only the ids actually shown (e.g. the rows in view): a
 * new id adds one batch, the ones already signed are not asked for again. With `variant`, smaller
 * copies (a list's avatars: `avatar`).
 *
 * `refetchFor(fileId)` asks for a new URL for that file's batch (an image whose URL expired); a
 * batch already being fetched is joined, not restarted, so several images failing at once make
 * one call.
 */
export function useSignedFileUrls(
  fileIds: readonly string[],
  { variant }: { variant?: ImageVariant } = {},
): {
  urls: ReadonlyMap<string, string>
  refetchFor: (fileId: string) => Promise<{ isError: boolean }>
} {
  const userId = useAuth().session?.user.id ?? 'anonymous'
  const queryClient = useQueryClient()
  const batches = useStableBatches(fileIds)
  const results = useQueries({
    queries: batches.map((batch) => ({
      queryKey: storageKeys.signedUrls(userId, batch, variant),
      queryFn: ({ signal }: { signal: AbortSignal }) => signedFileUrls(batch, { signal, ...(variant && { variant }) }),
      staleTime: SIGNED_URL_REFRESH_MS,
      gcTime: 30_000,
      retry: retrySigning,
    })),
  })
  const urls = new Map<string, string>()
  for (const result of results) for (const [id, url] of result.data?.urls ?? EMPTY_URLS) urls.set(id, url)
  const refetchFor = useCallback(
    async (fileId: string) => {
      const batch = batches.find((ids) => ids.includes(fileId))
      if (!batch) return { isError: true }
      const queryKey = storageKeys.signedUrls(userId, batch, variant)
      await queryClient.refetchQueries({ queryKey, exact: true }, { cancelRefetch: false })
      return { isError: queryClient.getQueryState(queryKey)?.status === 'error' }
    },
    [batches, queryClient, userId, variant],
  )
  return { urls, refetchFor }
}
