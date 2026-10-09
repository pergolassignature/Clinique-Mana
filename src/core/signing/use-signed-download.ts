import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { t } from '@/i18n'
import { saveBlob } from '@/shared/lib/files'
import { toast } from '@/shared/ui/sonner'
import { prepareSignedDownload, signedDownloadErrorMessage, type SignedDocumentFiles, type SignedDownloadKind } from './downloads'

/**
 * A signed document's downloads (`downloads.ts`, P4-500): each press reads the files again through
 * new URLs (never cached: `gcTime` 0) and saves the result under its name. `hasCertificate` is
 * learnt at the first split (null until then): false disables « Télécharger le certificat et le
 * journal » with its reason. A failure is a toast. Its own file (not `hooks.ts`), so a module's
 * card does not pull the signing settings' hooks into its chunk.
 */
export function useSignedDocumentDownload(files: SignedDocumentFiles) {
  const [hasCertificate, setHasCertificate] = useState<boolean | null>(null)
  const mutation = useMutation({
    mutationFn: (kind: SignedDownloadKind) => prepareSignedDownload(files, kind),
    gcTime: 0,
    onSuccess: ({ file, hasCertificate: found }) => {
      if (found !== null) setHasCertificate(found)
      if (file) saveBlob(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), file.fileName)
      else toast.warning(t('signing.downloads.noCertificate'))
    },
    onError: (error) => toast.error(signedDownloadErrorMessage(error)),
  })
  return {
    download: (kind: SignedDownloadKind) => mutation.mutate(kind),
    /** The download under way, if any. */
    pendingKind: mutation.isPending ? (mutation.variables ?? null) : null,
    hasCertificate,
  }
}
