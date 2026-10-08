import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { addTaxRate, deleteTaxRate, fetchTaxRates, type Tax } from './api'

export const taxRateKeys = {
  all: ['tax-rates'] as const,
  list: () => [...taxRateKeys.all, 'list'] as const,
}

/** Every rate of the org, by tax, newest first (one query for both tables). */
export function useTaxRates() {
  return useQuery({ queryKey: taxRateKeys.list(), queryFn: fetchTaxRates })
}

/**
 * Both mutations refresh the rates once settled, failed or not: a refusal often means another
 * admin changed them meanwhile. The mutation stays pending until the fresh rates are in, so the
 * dialog closes onto the updated table. Success is a toast; a failure is shown by the dialog that
 * asked (« Nouveau taux », the delete confirmation), which stays open while the mutation runs.
 */
function useTaxRateMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>, successMessage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      toast.success(successMessage)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: taxRateKeys.all }),
  })
}

export function useAddTaxRate() {
  return useTaxRateMutation(
    ({ tax, rate, effectiveFrom }: { tax: Tax; rate: number; effectiveFrom: string }) => addTaxRate(tax, rate, effectiveFrom),
    t('settings.tax.dialog.added'),
  )
}

export function useDeleteTaxRate() {
  return useTaxRateMutation((id: string) => deleteTaxRate(id), t('settings.tax.rates.deleted'))
}
