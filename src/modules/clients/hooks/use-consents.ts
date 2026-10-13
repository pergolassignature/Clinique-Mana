import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  cancelConsentRequest,
  fetchClientConsentFiles,
  fetchClientConsentStatus,
  fetchConsentRules,
  fetchConsentSettings,
  fetchConsentTemplates,
  fetchConsentsToObtain,
  fetchConsentTypes,
  publishConsentVersion,
  resendConsentRequest,
  saveConsentRule,
  saveConsentSettings,
  sendConsentRequest,
  type ConsentRule,
  type ConsentSettings,
  type Population,
} from '../api/consents'
import { consentKeys } from './keys'

const S = 'modules.clients.consents'

export const useConsentTypes = () => useQuery({ queryKey: consentKeys.types(), queryFn: fetchConsentTypes })
export const useConsentRules = () => useQuery({ queryKey: consentKeys.rules(), queryFn: fetchConsentRules })
export const useConsentSettings = () => useQuery({ queryKey: consentKeys.settings(), queryFn: fetchConsentSettings })
export const useConsentTemplates = () => useQuery({ queryKey: consentKeys.templates(), queryFn: fetchConsentTemplates })
export const useConsentsToObtain = () => useQuery({ queryKey: consentKeys.toObtain(), queryFn: fetchConsentsToObtain, staleTime: 0 })

/** One client's states and the sealed PDFs of the consents in force. */
export function useClientConsents(clientId: string) {
  return useQuery({
    queryKey: consentKeys.client(clientId),
    queryFn: async () => {
      const [status, files] = await Promise.all([fetchClientConsentStatus(clientId), fetchClientConsentFiles(clientId)])
      return { status, files }
    },
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
      return queryClient.invalidateQueries({ queryKey: consentKeys.all })
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
