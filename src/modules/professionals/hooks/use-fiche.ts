import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { fetchOrganization } from '@/core/settings/organization/api'
import { organizationKeys } from '@/core/settings/organization/hooks'
import { isChunkLoadError } from '@/shared/lib/app-update'
import { saveBlob } from '@/shared/lib/files'
import { toast } from '@/shared/ui/sonner'
import { markFicheGenerated } from '../api/fiche'
import type { ProfessionalRecord } from '../api/parse'
import type { CatalogView } from '../lib/catalog-view'
import { ficheFileName } from '../lib/fiche'

/**
 * « Fiche PDF » (Task 4c.5). The renderer is a chunk of its own (react-pdf and Inter, P4-58),
 * imported here on demand, never with the record page; `preloadFicheRenderer` starts it as the
 * menu opens.
 */

const loadRenderer = () => import('../pdf/generate-fiche-pdf')

/** Starts loading the renderer's chunk (the menu opening), so a click finds it ready. */
export function preloadFicheRenderer(): void {
  void loadRenderer().catch(() => undefined)
}

export interface FicheTarget {
  record: ProfessionalRecord
  catalog: CatalogView
  titleId: string | null
}

/** The fiche as a PDF Blob and its file name, from the cached record and catalogue and the clinic's identity. */
export async function renderFiche(queryClient: QueryClient, { record, catalog, titleId }: FicheTarget): Promise<{ blob: Blob; fileName: string }> {
  const [{ renderFichePdf }, organization] = await Promise.all([
    loadRenderer(),
    // The same entry as Settings' cards: fresh for a minute, so a fiche made right after an edit of
    // the clinic's identity in another tab may wait that long to show it.
    queryClient.fetchQuery({ queryKey: organizationKeys.current(), queryFn: fetchOrganization, staleTime: 60_000 }),
  ])
  const blob = await renderFichePdf({ record, catalog, titleId, organization })
  return { blob, fileName: ficheFileName(record.professional) }
}

/** The French text for a fiche that could not be made (or sent): a new deploy, a refusal, else the generic one. */
export function ficheErrorMessage(error: unknown, fallback: string): string {
  if (isChunkLoadError(error)) return t('modules.professionals.fiche.errors.appUpdated')
  return moduleErrorMessage(error, fallback, 'professionals')
}

/**
 * « Télécharger »: renders the fiche, saves it, then stamps `fiche_generated_at`. The stamp is
 * bookkeeping: the file is already saved, so a failed stamp is not shown (P4-203).
 */
export function useDownloadFiche() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (target: FicheTarget) => {
      const { blob, fileName } = await renderFiche(queryClient, target)
      saveBlob(blob, fileName)
      await markFicheGenerated(target.record.professional.id).catch(() => undefined)
    },
    onError: (error) => toast.error(ficheErrorMessage(error, t('modules.professionals.fiche.errors.render'))),
  })
}
