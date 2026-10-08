import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import * as Sentry from '@sentry/react'
import { moduleErrorMessage } from '@/core/modules/errors'
import { fetchOrganization } from '@/core/settings/organization/api'
import { organizationKeys } from '@/core/settings/organization/hooks'
import { UploadSendError, uploadFile } from '@/core/storage/api'
import { uploadErrorMessage } from '@/core/storage/errors'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { isChunkLoadError } from '@/shared/lib/app-update'
import { saveBlob } from '@/shared/lib/files'
import { retryInText } from '@/shared/lib/retry-after'
import { toast } from '@/shared/ui/sonner'
import { markFicheGenerated, sendFicheEmail } from '../api/fiche'
import type { ProfessionalRecord } from '../api/parse'
import type { CatalogView } from '../lib/catalog-view'
import { ficheFileName } from '../lib/fiche'

/**
 * « Fiche PDF » (Task 4c.5). The renderer is a chunk of its own (react-pdf, Raleway and the logo, P4-58),
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

/** A failure of « Envoyer par courriel », with the step it happened at. */
export class FicheSendError extends Error {
  constructor(
    readonly step: 'render' | 'upload' | 'send',
    readonly cause: unknown,
  ) {
    super(`fiche ${step} failed`)
    this.name = 'FicheSendError'
  }
}

/** What the send dialog shows for a failure: under the address field, or above the buttons. */
export interface FicheSendFailure {
  message: string
  field?: 'to'
}

const E = 'modules.professionals.fiche.errors'

/** The function's codes that have their own text, not reported. */
const SEND_TEXTS: Readonly<Record<string, () => string>> = {
  unauthenticated: () => t('storage.errors.unauthenticated'),
  forbidden: () => t('common.errors.forbidden'),
  module_disabled: () => t('common.errors.forbidden'),
  // The upload was purged meanwhile (staged one day), or never stored.
  not_found: () => t(`${E}.uploadGone`),
  not_configured: () => t(`${E}.notConfigured`),
  provider_error: () => t(`${E}.provider`),
  network: () => t('storage.errors.network'),
}

/** The French text of a failed send (see `useSendFiche`); unexpected codes are reported. */
export function ficheSendFailure(error: unknown): FicheSendFailure {
  if (!(error instanceof FicheSendError)) return { message: moduleErrorMessage(error, t(`${E}.send`), 'professionals') }
  const { step, cause } = error
  if (step === 'render') return { message: ficheErrorMessage(cause, t(`${E}.render`)) }
  if (step === 'upload') {
    // The storage texts ask to choose the file again; here the fiche is simply made again.
    const again =
      (cause instanceof FunctionCallError && (cause.code === 'not_found' || cause.code === 'conflict')) ||
      (cause instanceof UploadSendError && cause.status !== null && cause.status < 500)
    return { message: again ? t(`${E}.tryAgain`) : uploadErrorMessage(cause) }
  }
  if (!(cause instanceof FunctionCallError)) return { message: moduleErrorMessage(cause, t(`${E}.send`), 'professionals') }
  if (cause.status === 400 && cause.field === 'to') return { message: t(`${E}.invalidRecipient`), field: 'to' }
  const refusal = refusalMessage(cause)
  if (refusal !== null) return { message: refusal }
  if (cause.code === 'rate_limited') return { message: `${t(`${E}.rateLimited`)} ${retryInText(cause.retryAfter)}` }
  const text = SEND_TEXTS[cause.code]
  if (text) return { message: text() }
  // missing_variable (the clinic's template names a value this send lacks), internal, anything new.
  const report = new Error(cause.message)
  report.name = `FunctionCallError ${cause.code}`
  Sentry.captureException(report, { tags: { area: 'professionals', code: cause.code } })
  return { message: cause.code === 'missing_variable' ? t(`${E}.template`) : t(`${E}.send`) }
}

export interface FicheSend extends FicheTarget {
  to: string
  message: string
}

/**
 * « Envoyer par courriel » (P4-58): renders the fiche, uploads that very file (purpose
 * `professional_fiche`, kept one day), then `professionals-fiche` checks it and emails it to the
 * client. The function stamps `fiche_generated_at`. Failures carry their step (`FicheSendError`);
 * the dialog shows them (`ficheSendFailure`).
 */
export function useSendFiche() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ to, message, ...target }: FicheSend) => {
      const { blob, fileName } = await renderFiche(queryClient, target).catch((error: unknown) => {
        throw new FicheSendError('render', error)
      })
      const professionalId = target.record.professional.id
      const { fileId } = await uploadFile({
        purpose: 'professional_fiche',
        subjectType: 'professional',
        subjectId: professionalId,
        file: new File([blob], fileName, { type: 'application/pdf' }),
        mimeType: 'application/pdf',
      }).catch((error: unknown) => {
        throw new FicheSendError('upload', error)
      })
      return sendFicheEmail({ professionalId, fileId, to, message }).catch((error: unknown) => {
        throw new FicheSendError('send', error)
      })
    },
    onSuccess: (_sent, { to }) => toast.success(t('modules.professionals.fiche.send.sent', { email: to })),
  })
}
