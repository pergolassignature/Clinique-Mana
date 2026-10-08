import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/auth-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { signedFileUrl } from './api'

/** Read URLs live 300 s (P3-33): one is replaced after 240 s, before it expires. */
const SIGNED_URL_REFRESH_MS = 240_000

export const storageKeys = {
  all: ['storage'] as const,
  /** Per user as well as per file: a URL signed for one user is never served to the next (#10). */
  signedUrl: (userId: string, fileId: string) => [...storageKeys.all, 'signedUrl', userId, fileId] as const,
}

/**
 * A stored file's read URL (`storage-sign`), for an `<img>` or a link; nothing without a file.
 *
 * - Fresh for 240 s and refetched every 240 s while shown, so the 5-minute URL in use is replaced
 *   before it expires. Once unused it is dropped after 30 s, so a URL never outlives its expiry in
 *   the cache (240 + 30 < 300): a later mount signs a new one.
 * - Keyed by the signed-in user. The cache is also cleared when the user changes (AccessProvider).
 * - A 4xx (not readable: 404; 120 an hour: 429) is shown, not retried.
 */
export function useSignedFileUrl(fileId: string | null) {
  const userId = useAuth().session?.user.id ?? 'anonymous'
  return useQuery({
    queryKey: storageKeys.signedUrl(userId, fileId ?? ''),
    queryFn: ({ signal }) => signedFileUrl(fileId as string, { signal }),
    enabled: fileId !== null,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    gcTime: 30_000,
    retry: (failures, error) => failures < 1 && !(error instanceof FunctionCallError && error.status >= 400 && error.status < 500),
  })
}
