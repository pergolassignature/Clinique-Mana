import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/auth-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { signedFileUrl } from './api'

/** Read URLs live 300 s (P3-33): one is stale after 240 s, before it expires. */
const SIGNED_URL_REFRESH_MS = 240_000

export const storageKeys = {
  all: ['storage'] as const,
  /** Per user as well as per file: a URL signed for one user is never served to the next (#10). */
  signedUrl: (userId: string, fileId: string) => [...storageKeys.all, 'signedUrl', userId, fileId] as const,
}

export interface SignedFileUrlOptions {
  /**
   * Replace the URL every 240 s while it is shown: for a download link, which must still work
   * when it is clicked. Off for an `<img>`: it has loaded by then, and a new URL would reload it.
   */
  refresh?: boolean
}

/**
 * A stored file's read URL (`storage-sign`), for an `<img>` or a link; nothing without a file.
 *
 * - Fresh for 240 s; with `refresh` (a download link) also refetched every 240 s while shown, so
 *   the 5-minute URL in use is replaced before it expires. An image whose URL has expired asks
 *   for a new one itself (`refetch`, from its `onError`). Once unused the URL is dropped after
 *   30 s, so it never outlives its expiry in the cache (240 + 30 < 300): a later mount signs a
 *   new one.
 * - Keyed by the signed-in user. The cache is also cleared when the user changes (AccessProvider).
 * - A 4xx (not readable: 404; 120 an hour: 429) is shown, not retried.
 */
export function useSignedFileUrl(fileId: string | null, { refresh = false }: SignedFileUrlOptions = {}) {
  const userId = useAuth().session?.user.id ?? 'anonymous'
  return useQuery({
    queryKey: storageKeys.signedUrl(userId, fileId ?? ''),
    queryFn: ({ signal }) => signedFileUrl(fileId as string, { signal }),
    enabled: fileId !== null,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: refresh ? SIGNED_URL_REFRESH_MS : false,
    gcTime: 30_000,
    retry: (failures, error) => failures < 1 && !(error instanceof FunctionCallError && error.status >= 400 && error.status < 500),
  })
}
