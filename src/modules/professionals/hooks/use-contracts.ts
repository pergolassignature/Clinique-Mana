import { useRef } from 'react'
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { syncSignatureRequest } from '@/core/signing/api'
import { syncOutcomeText } from '@/core/signing/hooks'
import { FunctionCallError } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'
import { toast } from '@/shared/ui/sonner'
import {
  archiveTemplateVersion,
  createTemplateVersion,
  fetchProfessionalContract,
  fetchProfessionalImageConsent,
  fetchTemplateVersions,
  listContractTemplates,
  publishTemplateVersion,
  sendProfessionalContract,
  updateTemplateVersion,
  type ContractAction,
  type DraftContent,
  type SigningForm,
} from '../api/contracts'
import { contractTemplateKeys, isContractKey, professionalKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const T = 'modules.professionals.contract.toasts'
const E = 'modules.professionals.contract.errors'

/** The i18n root of a form's own words (the card's title, its toasts, its refusals). */
export const formTextRoot = (form: SigningForm) => (form === 'image_consent' ? 'modules.professionals.imageConsent' : 'modules.professionals.contract')

// --- The card -----------------------------------------------------------------------------------

const contractQuery = (id: string) =>
  queryOptions({ queryKey: professionalKeys.contract(id), queryFn: () => fetchProfessionalContract(id), staleTime: 30_000 })

/**
 * The record's contract card (Documents tab); refetched on focus, so it follows a signature made
 * elsewhere. « Prochaine action » reads it too, only when the contract is the file's last gap
 * (`enabled`).
 */
export function useProfessionalContract(id: string, enabled = true) {
  return useQuery({ ...contractQuery(id), enabled: enabled && id !== '' })
}

/** Documents' hover or focus: the card with the tab's chunk. */
export function prefetchProfessionalContract(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(contractQuery(id))
}

const imageConsentQuery = (id: string) =>
  queryOptions({ queryKey: professionalKeys.imageConsent(id), queryFn: () => fetchProfessionalImageConsent(id), staleTime: 30_000 })

/** The image consent's signing state (Documents → « Consentement droit à l'image », P4-484). */
export function useProfessionalImageConsent(id: string) {
  return useQuery({ ...imageConsentQuery(id), enabled: id !== '' })
}

/** Documents' hover or focus, with the contract card. */
export function prefetchProfessionalImageConsent(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(imageConsentQuery(id))
}

/** A form's card read: the contract's or the image consent's. */
export function useSigningForm(form: SigningForm, id: string) {
  const contract = useQuery({ ...contractQuery(id), enabled: form === 'service_contract' && id !== '' })
  const consent = useQuery({ ...imageConsentQuery(id), enabled: form === 'image_consent' && id !== '' })
  return form === 'image_consent' ? consent : contract
}

/** After a send, a sync or a refusal: the record (readiness, the card), the lists and the history. */
function refreshAfterContract(queryClient: QueryClient, id: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: professionalKeys.record(id) }),
    queryClient.invalidateQueries({ queryKey: professionalKeys.lists() }),
    refreshProfessionalHistory(queryClient, id),
  ])
}

/**
 * The French text of a failed send (P3-28): a refusal (P0001: no published template, the prices to
 * configure, a contract already out…) as the database wrote it; a missing template value with its
 * label; Documenso or its settings by code; anything else through `showMutationError`.
 */
export function contractErrorMessage(error: unknown, form: SigningForm = 'service_contract'): string | null {
  if (!(error instanceof FunctionCallError)) return null
  const F = formTextRoot(form)
  switch (error.code) {
    case 'missing_variable': {
      const label = typeof error.extra.label === 'string' ? error.extra.label : null
      return label ? t(`${F}.errors.missingVariable`, { label }) : t(`${F}.errors.missingVariableUnknown`)
    }
    case 'not_configured':
      return t(`${E}.notConfigured`)
    case 'provider_error':
      return t(`${E}.providerError`)
    case 'conflict':
      return t(`${F}.errors.inProgress`)
    case 'rate_limited':
      return `${t(`${E}.rateLimited`)} ${retryInText(error.retryAfter)}`
    case 'network':
      return t(`${E}.network`)
    default:
      return null
  }
}

/**
 * Whether a failed send may have left work under its key (a request, an envelope): then the retry
 * keeps the key, so it resumes that work. Not after a missing value (the snapshot was written with
 * the empty value, and the first write wins: the same key would print it again once the file is
 * completed) nor after a refusal (nothing was written).
 */
function keepsKey(error: unknown): boolean {
  return error instanceof FunctionCallError && error.code !== 'missing_variable'
}

/**
 * « Préparer et envoyer », « Réessayer l'envoi », « Renvoyer », « Régénérer »: `run(action)` draws
 * an idempotency key per action and keeps it until that action succeeds, so a retry after a
 * failure that may have sent something is the same request (P4-434), and a double click one
 * request; after a missing value or a refusal, the next try draws a new key (`keepsKey`). Toasts
 * here, so the outcome shows even if the card unmounts.
 */
export function useSendContract(professionalId: string, firstName: string, feedback?: MutationFeedback, form: SigningForm = 'service_contract') {
  const queryClient = useQueryClient()
  const keys = useRef<Partial<Record<ContractAction, string>>>({})
  const F = formTextRoot(form)
  const mutation = useMutation({
    mutationFn: ({ action, key }: { action: ContractAction; key: string; recipient: string }) => sendProfessionalContract(professionalId, action, key, form),
    onSuccess: (_id, { action, recipient }) => {
      delete keys.current[action]
      toast.success(t(`${F}.toasts.${action}`, { firstName: recipient }))
    },
    onError: (error, { action }) => {
      if (!keepsKey(error)) delete keys.current[action]
      const message = contractErrorMessage(error, form)
      if (message === null) showMutationError(queryClient, error, feedback)
      else if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
      else toast.error(message)
    },
    onSettled: () => refreshAfterContract(queryClient, professionalId),
  })
  /** `recipient`: who « Renvoyer » writes to (the next signer); the professional otherwise. */
  const run = (action: ContractAction, recipient: string = firstName) => {
    keys.current[action] ??= crypto.randomUUID()
    mutation.mutate({ action, key: keys.current[action], recipient })
  }
  return { run, isPending: mutation.isPending, pendingAction: mutation.isPending ? mutation.variables?.action : undefined }
}

/** « Synchroniser » (core `signing-sync`, the caller's read): the outcome in words, then the record again. */
export function useSyncContract(professionalId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) => syncSignatureRequest(requestId),
    onSuccess: ({ outcome }) => {
      const { ok, text } = syncOutcomeText(outcome)
      if (ok) toast.success(text)
      else toast.error(text)
    },
    onError: (error) => toast.error(contractErrorMessage(error) ?? t(`${E}.syncFailed`)),
    onSettled: () => refreshAfterContract(queryClient, professionalId),
  })
}

// --- « Paramètres → Contrats et formulaires » --------------------------------------------------------

export function useContractTemplates() {
  return useQuery({ queryKey: contractTemplateKeys.list(), queryFn: listContractTemplates })
}

/** A template's versions; not refetched on focus while a draft may be in the editor. */
export function useTemplateVersions(templateId: string | null) {
  return useQuery({
    queryKey: contractTemplateKeys.versions(templateId ?? ''),
    queryFn: () => fetchTemplateVersions(templateId as string),
    enabled: templateId !== null,
    refetchOnWindowFocus: false,
  })
}

/**
 * The editor's writes. Each refetches the templates and their versions; a publication or a retired
 * version also every signing card (« Aucun modèle … publié » follows it).
 */
export function useTemplateMutations(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  const refresh = (cards: boolean) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractTemplateKeys.all }),
      cards && queryClient.invalidateQueries({ queryKey: professionalKeys.all, predicate: (query) => isContractKey(query.queryKey) }),
    ])
  const onError = (error: unknown) => showMutationError(queryClient, error, feedback)
  const create = useMutation({
    mutationFn: createTemplateVersion,
    onSuccess: () => toast.success(t(`${T}.versionCreated`)),
    onError,
    onSettled: () => refresh(false),
  })
  const save = useMutation({
    mutationFn: ({ versionId, content }: { versionId: string; content: DraftContent }) => updateTemplateVersion(versionId, content),
    onSuccess: () => toast.success(t(`${T}.draftSaved`)),
    onError,
    onSettled: () => refresh(false),
  })
  const publish = useMutation({
    mutationFn: publishTemplateVersion,
    onSuccess: () => toast.success(t(`${T}.published`)),
    onError,
    onSettled: () => refresh(true),
  })
  const archive = useMutation({
    mutationFn: archiveTemplateVersion,
    onSuccess: () => toast.success(t(`${T}.archived`)),
    onError,
    onSettled: () => refresh(true),
  })
  return { create, save, publish, archive }
}
