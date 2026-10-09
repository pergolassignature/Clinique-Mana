import { useState } from 'react'

/**
 * A stored image shown through a signed URL (`useSignedFileUrl`): when it fails to load, one new
 * URL is asked for per file (the 5-min URL may have expired); a second failure marks that URL dead,
 * so an image that can never be decoded never calls `storage-sign` in a loop (OrgAssetCard's guard).
 */
export function useImageRetry(fileId: string | null, url: string | undefined, refetch: () => Promise<{ isError: boolean }>) {
  const [retriedFor, setRetriedFor] = useState<string | null>(null)
  const [deadUrl, setDeadUrl] = useState<string | null>(null)
  const onError = () => {
    if (!url) return
    if (retriedFor === fileId) return setDeadUrl(url)
    setRetriedFor(fileId)
    void refetch().then((result) => {
      if (result.isError) setDeadUrl(url)
    })
  }
  return { dead: url !== undefined && url === deadUrl, onError }
}
