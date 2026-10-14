import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { documentTemplateKeys } from '@/core/signing/templates/hooks'
import { toast } from '@/shared/ui/sonner'
import {
  cancelConsentCampaign,
  cancelConsentRequest,
  fetchConsentCampaigns,
  startConsentCampaign,
  fetchClientConsentStatus,
  fetchConsentClauses,
  fetchConsentRules,
  fetchConsentSettings,
  fetchConsentTemplates,
  fetchConsentsToObtain,
  fetchConsentTypes,
  publishConsentVersion,
  resendConsentRequest,
  saveConsentClauses,
  saveConsentRule,
  saveConsentSettings,
  sendConsentCopy,
  sendConsentRequest,
  withdrawConsent,
  type ConsentRule,
  type ConsentSettings,
  type VersionClause,
  type Population,
} from '../api/consents'
import { clientsKeys, consentKeys } from './keys'

const S = 'modules.clients.consents'

export const useConsentTypes = () => useQuery({ queryKey: consentKeys.types(), queryFn: fetchConsentTypes })
export const useConsentRules = () => useQuery({ queryKey: consentKeys.rules(), queryFn: fetchConsentRules })
export const useConsentSettings = () => useQuery({ queryKey: consentKeys.settings(), queryFn: fetchConsentSettings })
export const useConsentTemplates = () => useQuery({ queryKey: consentKeys.templates(), queryFn: fetchConsentTemplates })
export const useConsentsToObtain = () => useQuery({ queryKey: consentKeys.toObtain(), queryFn: fetchConsentsToObtain, staleTime: 0 })

/** One client's states, each with its consent's sealed PDF, withdrawal and copy. */
export function useClientConsents(clientId: string) {
  return useQuery({
    queryKey: consentKeys.client(clientId),
    queryFn: () => fetchClientConsentStatus(clientId),
    staleTime: 0,
  })
}

export function useSaveConsentRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rule: Omit<ConsentRule, 'id'> & { id: string | null }) => saveConsentRule(rule),
    onSuccess: () => {
      toast.success(t(`${S}.settings.rules.saved`))
      return queryClient.invalidateQueries({ queryKey: consentKeys.rules() })
    },
    onError: (error) => toast.error(moduleErrorMessage(error, t(`${S}.settings.saveError`), 'clients')),
  })
}

export function useSaveConsentSettings({ onErrorMessage }: { onErrorMessage?: (message: string) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<ConsentSettings>) => saveConsentSettings(patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(consentKeys.settings(), saved)
      toast.success(t(`${S}.settings.saved`))
    },
    onError: (error) => {
      const message = moduleErrorMessage(error, t(`${S}.settings.saveError`), 'clients')
      if (onErrorMessage) onErrorMessage(message)
      else toast.error(message)
    },
  })
}

export function usePublishConsentVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, population }: { versionId: string; population: Population }) => publishConsentVersion(versionId, population),
    onSuccess: (flagged) => {
      toast.success(flagged > 0 ? t(`${S}.settings.texts.publishedFlagged`, { count: String(flagged) }) : t(`${S}.settings.texts.published`))
      // The shared editor's versions too (CC-12): the published one is now the one in force.
      return Promise.all([queryClient.invalidateQueries({ queryKey: consentKeys.all }), queryClient.invalidateQueries({ queryKey: documentTemplateKeys.all })])
    },
    onError: (error) => toast.error(moduleErrorMessage(error, t(`${S}.settings.saveError`), 'clients')),
  })
}

/** Refreshes the list to obtain and the client's states after a send, a re-send or a cancel. */
function useRefresh() {
  const queryClient = useQueryClient()
  return (clientId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: consentKeys.toObtain() }),
      queryClient.invalidateQueries({ queryKey: consentKeys.client(clientId) }),
    ])
}

export function useSendConsent(clientId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (consentKey: string) => sendConsentRequest(clientId, consentKey),
    onSettled: () => refresh(clientId),
  })
}

export function useResendConsent(clientId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (requestId: string) => resendConsentRequest(requestId),
    onSettled: () => refresh(clientId),
  })
}

export function useCancelConsent(clientId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (requestId: string) => cancelConsentRequest(requestId),
    onSuccess: () => toast.success(t(`${S}.cancelled`)),
    onError: (error) => toast.error(moduleErrorMessage(error, t(`${S}.cancelError`), 'clients')),
    onSettled: () => refresh(clientId),
  })
}

/**
 * « Retirer le consentement » (C5b, CC-16). The dialog shows a refusal where the person acted;
 * the client's states and the list to obtain are read again either way. Its own Historique too.
 */
export function useWithdrawConsent(clientId: string, { onErrorMessage }: { onErrorMessage: (message: string) => void }) {
  const refresh = useRefresh()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ consentId, note }: { consentId: string; note: string }) => withdrawConsent(consentId, note),
    onSuccess: () => toast.success(t(`${S}.withdraw.done`)),
    onError: (error) => onErrorMessage(moduleErrorMessage(error, t(`${S}.withdraw.error`), 'clients')),
    onSettled: () => Promise.all([refresh(clientId), queryClient.invalidateQueries({ queryKey: clientsKeys.history(clientId) })]),
  })
}

/** « Envoyer la copie signée » (C5b, CC-17): the outcome toasts are the caller's. */
export function useSendConsentCopy(clientId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (consentId: string) => sendConsentCopy(consentId),
    onSettled: () => refresh(clientId),
  })
}

/** A consent text version's clauses (CC-13). */
export function useConsentClauses(versionId: string | null) {
  return useQuery({
    queryKey: consentKeys.clauses(versionId ?? ''),
    queryFn: () => fetchConsentClauses(versionId as string),
    enabled: versionId !== null,
    refetchOnWindowFocus: false,
  })
}

/** Saves a draft's clauses; the page shows a refusal where the person acted. */
export function useSaveConsentClauses({ onErrorMessage }: { onErrorMessage?: (message: string) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, clauses }: { versionId: string; clauses: VersionClause[] }) => saveConsentClauses(versionId, clauses),
    onSuccess: () => toast.success(t(`${S}.settings.clauses.saved`)),
    onError: (error) => {
      const message = moduleErrorMessage(error, t(`${S}.settings.saveError`), 'clients')
      if (onErrorMessage) onErrorMessage(message)
      else toast.error(message)
    },
    onSettled: (_data, _error, { versionId }) => queryClient.invalidateQueries({ queryKey: consentKeys.clauses(versionId) }),
  })
}

/** The re-sign campaigns (C5b.4). */
export const useConsentCampaigns = () => useQuery({ queryKey: consentKeys.campaigns(), queryFn: fetchConsentCampaigns })

/** Starts a campaign; its count in the toast; every consent state refetched (the files are flagged). */
export function useStartConsentCampaign({ onErrorMessage }: { onErrorMessage: (message: string) => void }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (consentKey: string) => startConsentCampaign(consentKey),
    onSuccess: (total) => toast.success(t(`${S}.settings.campaigns.started`, { count: String(total) })),
    onError: (error) => onErrorMessage(moduleErrorMessage(error, t(`${S}.settings.campaigns.error`), 'clients')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: consentKeys.all }),
  })
}

export function useCancelConsentCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelConsentCampaign(id),
    onSuccess: () => toast.success(t(`${S}.settings.campaigns.stopped`)),
    onError: (error) => toast.error(moduleErrorMessage(error, t(`${S}.settings.campaigns.error`), 'clients')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: consentKeys.campaigns() }),
  })
}
