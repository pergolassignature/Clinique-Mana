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
import { fetchPublicFees, markFicheGenerated, sendFicheEmail } from '../api/fiche'
import type { ProfessionalRecord } from '../api/parse'
import type { CatalogView } from '../lib/catalog-view'
import { imageConsentOnFile } from '../lib/documents'
import { ficheFileName, ficheProfession } from '../lib/fiche'
import { documentsQuery } from './use-documents'
import { refreshProfessionalHistory } from './use-professional-record'
import { professionalsSettingsQuery } from './use-professionals-settings'

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

interface FicheTarget {
  record: ProfessionalRecord
  catalog: CatalogView
  titleId: string | null
}

/**
 * The fiche as a PDF Blob and its file name, from the cached record and catalogue, the clinic's
 * identity, the fiche's render options (Paramètres → Fiche PDF, P4-353) and the public fees of the
 * fiche's title, read fresh (a grid can change any day). A failed read of any makes no fiche
 * (never one that shows what the clinic chose to hide).
 */
async function renderFiche(queryClient: QueryClient, { record, catalog, titleId }: FicheTarget): Promise<{ blob: Blob; fileName: string }> {
  const [{ renderFichePdf }, organization, settings, fees, photoFileId] = await Promise.all([
    loadRenderer(),
    // The same entry as Settings' cards: fresh for a minute, so a fiche made right after an edit of
    // the clinic's identity in another tab may wait that long to show it.
    queryClient.fetchQuery({ queryKey: organizationKeys.current(), queryFn: fetchOrganization, staleTime: 60_000 }),
    // The module's settings entry (the « Fiche PDF » card updates it on save), fresh for a minute too.
    queryClient.fetchQuery({ ...professionalsSettingsQuery, staleTime: 60_000 }),
    // The title the content prints (two titles: the chosen one), so the fees follow it (P4-218).
    fetchPublicFees(record.professional.id, ficheProfession(record, titleId)?.titleId ?? null),
    // The photo (P4-202): the public profile's, the newest verified one, from the Documents tab's
    // read (cached 30 s), and only with an image consent in force on file (P4-512: the same read).
    // Unreadable, or no consent → no photo: the initials take its place, never a failed fiche.
    queryClient
      .fetchQuery(documentsQuery(record.professional.id))
      .then((documents) => (documents && imageConsentOnFile(documents.documents) ? (documents.photo?.fileId ?? null) : null))
      .catch(() => null),
  ])
  const options = {
    showProContact: settings.ficheShowProContact,
    showClinicFooter: settings.ficheShowClinicFooter,
    showClosing: settings.ficheShowClosing,
  }
  const blob = await renderFichePdf({ record, catalog, titleId, organization, fees, options, photoFileId })
  return { blob, fileName: ficheFileName(record.professional) }
}

/** The French text for a fiche that could not be made (or sent): a new deploy, a refusal, else the generic one. */
function ficheErrorMessage(error: unknown, fallback: string): string {
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
class FicheSendError extends Error {
  constructor(
    readonly step: 'render' | 'upload' | 'send',
    readonly cause: unknown,
  ) {
    super(`fiche ${step} failed`)
    this.name = 'FicheSendError'
  }
}

/** What the send dialog shows for a failure: under the address field, or above the buttons. */
interface FicheSendFailure {
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
  // The code only: a function's message is never sent to Sentry.
  const report = new Error(cause.code)
  report.name = `FunctionCallError ${cause.code}`
  Sentry.captureException(report, { tags: { area: 'professionals', code: cause.code } })
  return { message: cause.code === 'missing_variable' ? t(`${E}.template`) : t(`${E}.send`) }
}

interface FicheSend extends FicheTarget {
  to: string
  message: string
}

/**
 * « Envoyer par courriel » (P4-58): renders the fiche, uploads that very file (purpose
 * `professional_fiche`, kept one day), then `professionals-fiche` checks it and emails it to the
 * client. The function stamps `fiche_generated_at`. Failures carry their step (`FicheSendError`);
 * the dialog shows them (`ficheSendFailure`). The client's address is never cached (`gcTime` 0);
 * a send refreshes the record's history (its first page and its emails).
 */
export function useSendFiche() {
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
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
    onSuccess: (_sent, { to, record }) => {
      void refreshProfessionalHistory(queryClient, record.professional.id)
      toast.success(t('modules.professionals.fiche.send.sent', { email: to }))
    },
  })
}
