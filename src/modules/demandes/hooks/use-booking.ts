import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchBookingSettings, saveBookingSettings, type BookingSettings } from '../api/booking'

/** Query keys of the booking rule (Paramètres → Appels découverte). */
export const bookingKeys = {
  all: ['demandes', 'booking'] as const,
  settings: () => [...bookingKeys.all, 'settings'] as const,
}

export const useBookingSettings = () => useQuery({ queryKey: bookingKeys.settings(), queryFn: fetchBookingSettings })

export function useSaveBookingSettings({ onErrorMessage }: { onErrorMessage?: (message: string) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: BookingSettings) => saveBookingSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(bookingKeys.settings(), saved)
      toast.success(t('modules.demandes.booking.settings.saved'))
    },
    onError: (error) => {
      const message = moduleErrorMessage(error, t('modules.demandes.booking.settings.saveError'), 'demandes')
      if (onErrorMessage) onErrorMessage(message)
      else toast.error(message)
    },
  })
}
