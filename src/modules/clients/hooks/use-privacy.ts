import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { saveBlob } from '@/shared/lib/files'
import { toast } from '@/shared/ui/sonner'
import { exportClientPrivacy, type ClientsReference } from '../api/clients'
import { clientNumberLabel } from '../lib/display'

/** Starts loading the PDF renderer (react-pdf) as the menu opens. */
export const preloadPrivacyRenderer = () => void import('../pdf/render-privacy-pdf').catch(() => undefined)

/**
 * « Exporter le dossier (PDF) » (clients.privacy, Loi 25): the export is read (and logged), made
 * into a PDF in the browser and saved as « dossier-CLI-000123.pdf » (the number, never the name).
 * The export is personal data: it lives in this call only, never in the query cache.
 */
export function useExportClientPrivacy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reference, clinic }: { id: string; reference: ClientsReference | undefined; clinic: string }) => {
      const data = await exportClientPrivacy(id)
      const { renderPrivacyPdf } = await import('../pdf/render-privacy-pdf')
      const blob = await renderPrivacyPdf(data, reference, clinic)
      saveBlob(blob, `dossier-${clientNumberLabel(data.summary.client.clientNumber)}.pdf`)
    },
    gcTime: 0,
    onSuccess: () => toast.success(t('modules.clients.privacy.exported')),
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      // A failure without a code (the renderer, the network) is reported by name only: its message could quote the file.
      const reported = rpcErrorCode(error) ? error : new Error('clients: privacy export failed')
      toast.error(moduleErrorMessage(reported, t('modules.clients.privacy.exportFailed'), 'clients'))
    },
  })
}
