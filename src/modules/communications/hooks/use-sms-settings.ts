import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { sendSmsTest } from '../api/sms'
import { fetchLastYeastarEventAt, fetchSmsSettings, saveSmsSettings, type SmsSettings } from '../api/sms-settings'
import { smsSendErrorMessage } from '../lib/sms-errors'
import { smsKeys } from './keys'

const S = 'modules.communications.sms.settings'

/** The clinic's SMS settings (communications.sms). */
export function useSmsSettings() {
  return useQuery({ queryKey: smsKeys.settings(), queryFn: fetchSmsSettings })
}

/**
 * Saves a card's keys; the returned effective settings are written as is. A refusal goes to the
 * card (`onErrorMessage`, under its field or above its buttons), else a toast.
 */
export function useSaveSmsSettings({ onErrorMessage }: { onErrorMessage?: (message: string) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<SmsSettings>) => saveSmsSettings(patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(smsKeys.settings(), saved)
      toast.success(t(`${S}.saved`))
    },
    onError: (error) => {
      const message = moduleErrorMessage(error, t(`${S}.saveError`), 'communications')
      if (onErrorMessage) onErrorMessage(message)
      else toast.error(message)
    },
  })
}

/** When the PBX last posted to the clinic's webhook (settings.view). */
export function useLastYeastarEvent(enabled: boolean) {
  return useQuery({ queryKey: smsKeys.lastEvent(), queryFn: fetchLastYeastarEventAt, enabled, staleTime: 0 })
}

/** « Envoyer un texto de test »: the outcome is a toast (sent, or why not). */
export function useSendSmsTest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (to: string) => sendSmsTest(to),
    onSuccess: () => toast.success(t(`${S}.send.testSent`)),
    onError: (error) => toast.error(smsSendErrorMessage(error, { failed: 'settings.send.testFailed', fallback: t('common.errors.generic') })),
    // The test is a text like any other: « Textos » shows it.
    onSettled: () => queryClient.invalidateQueries({ queryKey: smsKeys.threads() }),
  })
}
