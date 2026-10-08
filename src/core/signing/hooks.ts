import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { secretKeys } from '@/core/settings/secrets/hooks'
import { toast } from '@/shared/ui/sonner'
import {
  fetchSigningSettings,
  lastDocumensoEventAt,
  lastSigningTest,
  listDocumentTemplates,
  sendSigningTestDocument,
  setSigningSettings,
  syncSignatureRequest,
  testSigningConnection,
  type SigningSettingsPatch,
} from './api'
import { signingErrorMessage } from './errors'

/** The signing reads. Changes invalidate `all` (CLAUDE.md §8): every read here is cheap. */
export const signingKeys = {
  all: ['signing'] as const,
  settings: () => [...signingKeys.all, 'settings'] as const,
  lastEvent: () => [...signingKeys.all, 'last-event', 'documenso'] as const,
  lastTest: (userId: string) => [...signingKeys.all, 'last-test', userId] as const,
  templates: () => [...signingKeys.all, 'templates'] as const,
}

/** The address and expiry. Fresh for a minute, so a refetch does not re-sync a card being typed in. */
export function useSigningSettings() {
  return useQuery({ queryKey: signingKeys.settings(), queryFn: fetchSigningSettings, staleTime: 60_000 })
}

/**
 * Saves one card's field (a patch: the other card's field is left as stored); `saved` is that
 * card's toast. A new address clears the API key (P3-34): the key's state is read again and the
 * toast says to type it again.
 */
export function useSetSigningSettings(saved: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SigningSettingsPatch) => setSigningSettings(patch),
    onSuccess: async ({ api_key_cleared }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: signingKeys.all }),
        api_key_cleared && queryClient.invalidateQueries({ queryKey: secretKeys.all }),
      ])
      toast.success(api_key_cleared ? t('settings.signing.connection.savedKeyCleared') : saved)
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}

/** When the clinic last received a Documenso event (null: never). */
export function useLastDocumensoEvent() {
  return useQuery({ queryKey: signingKeys.lastEvent(), queryFn: lastDocumensoEventAt, staleTime: 0 })
}

/**
 * The caller's latest test document. Only with `settings.integrations_manage` (`enabled`): nobody
 * else can read test requests. Refetched on window focus, so it follows the signature made in the
 * other tab.
 */
export function useLastSigningTest(enabled: boolean) {
  const { user_id: userId } = useReadyAccess()
  return useQuery({ queryKey: signingKeys.lastTest(userId), queryFn: () => lastSigningTest(userId), enabled, staleTime: 0 })
}

/** The document templates (« Modèles de documents »). */
export function useDocumentTemplates() {
  return useQuery({ queryKey: signingKeys.templates(), queryFn: listDocumentTemplates })
}

/** « Tester la connexion »: no toast; the card keeps the outcome next to the button (its `mutate` callbacks). */
export function useTestSigningConnection() {
  return useMutation({ mutationFn: testSigningConnection })
}

/**
 * « Envoyer un document test »: `send()` draws an idempotency key and keeps it until a send
 * succeeds, so a retry after a failure sends the same draft again instead of starting another
 * test. Toasts here, so the outcome shows even if the card unmounts first.
 */
export function useSendSigningTestDocument() {
  const queryClient = useQueryClient()
  const { email } = useReadyAccess()
  const key = useRef<string | null>(null)
  const mutation = useMutation({
    mutationFn: (idempotencyKey: string) => sendSigningTestDocument(idempotencyKey),
    onSuccess: async () => {
      key.current = null
      toast.success(t('settings.signing.send.testSent', { email }))
      await queryClient.invalidateQueries({ queryKey: signingKeys.all })
    },
    onError: (error) => {
      toast.error(signingErrorMessage(error))
    },
  })
  const send = () => {
    key.current ??= crypto.randomUUID()
    mutation.mutate(key.current)
  }
  return { send, isPending: mutation.isPending }
}

/** « Actualiser l'état »: `signing-sync` for one request, then the reads again. */
export function useSyncSignatureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) => syncSignatureRequest(requestId),
    onSuccess: async ({ outcome }) => {
      if (outcome === 'orphan_completed') toast.error(t('settings.signing.send.synced.orphanCompleted'))
      else if (outcome === 'unchanged') toast.success(t('settings.signing.send.synced.unchanged'))
      else if (outcome === 'sending') toast.success(t('settings.signing.send.synced.sending'))
      // `signed`, `updated`.
      else toast.success(t('settings.signing.send.synced.updated'))
      await queryClient.invalidateQueries({ queryKey: signingKeys.all })
    },
    onError: (error) => {
      toast.error(signingErrorMessage(error))
    },
  })
}
