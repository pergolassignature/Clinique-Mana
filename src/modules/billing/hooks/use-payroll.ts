import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addPayoutAdjustment,
  buildPayoutMonth,
  checkQboBillVoided,
  discardPayoutDrafts,
  fetchPayoutPeriod,
  forceClearQboBill,
  generateProfessionalInvoice,
  listMyPayoutPeriods,
  listPayoutExport,
  listPayoutPeriods,
  listPayoutRules,
  markPeriodPaid,
  rebuildPayoutPeriod,
  removePayoutAdjustment,
  reopenPayoutPeriod,
  requestPayoutCorrection,
  sendPayoutPeriods,
  setPayoutRule,
  uploadProfessionalInvoice,
  validatePayoutPeriod,
  type PayoutRule,
  type UploadInvoiceInput,
} from '../api/payroll'

/**
 * Query keys of the payroll (FPay), under the module's root (`['billing']`). Every write
 * invalidates `all`: a period, its month's list, « Ma paie » and the export move together (a
 * clinic has ~50 periods a month).
 */
export const payrollKeys = {
  all: ['billing', 'payroll'] as const,
  month: (month: string) => [...payrollKeys.all, 'month', month] as const,
  period: (id: string) => [...payrollKeys.all, 'period', id] as const,
  mine: () => [...payrollKeys.all, 'mine'] as const,
  export: (month: string) => [...payrollKeys.all, 'export', month] as const,
  rules: () => [...payrollKeys.all, 'rules'] as const,
}

export function usePayoutMonth(month: string) {
  return useQuery({ queryKey: payrollKeys.month(month), queryFn: () => listPayoutPeriods(month) })
}

export function usePayoutPeriod(id: string | null) {
  return useQuery({ queryKey: payrollKeys.period(id ?? ''), queryFn: () => fetchPayoutPeriod(id as string), enabled: id !== null })
}

export function useMyPayoutPeriods() {
  return useQuery({ queryKey: payrollKeys.mine(), queryFn: listMyPayoutPeriods })
}

export function usePayoutExport(month: string, enabled: boolean) {
  return useQuery({ queryKey: payrollKeys.export(month), queryFn: () => listPayoutExport(month), enabled })
}

export function usePayoutRules() {
  return useQuery({ queryKey: payrollKeys.rules(), queryFn: listPayoutRules })
}

/** A payroll write: invalidates every payroll read once it settles. */
function usePayrollMutation<A, R>(fn: (args: A) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: payrollKeys.all }),
  })
}

export const useBuildPayoutMonth = () => usePayrollMutation((month: string) => buildPayoutMonth(month))
export const useDiscardPayoutDrafts = () => usePayrollMutation((month: string) => discardPayoutDrafts(month))
export const useRebuildPayoutPeriod = () => usePayrollMutation((id: string) => rebuildPayoutPeriod(id))
export const useSendPayoutPeriods = () => usePayrollMutation((ids: readonly string[]) => sendPayoutPeriods(ids))
export const useAddPayoutAdjustment = () =>
  usePayrollMutation(({ periodId, amountCents, note }: { periodId: string; amountCents: number; note: string }) =>
    addPayoutAdjustment(periodId, amountCents, note))
export const useRemovePayoutAdjustment = () => usePayrollMutation((lineId: string) => removePayoutAdjustment(lineId))
export const useReopenPayoutPeriod = () =>
  usePayrollMutation(({ id, reason }: { id: string; reason: string }) => reopenPayoutPeriod(id, reason))
export const useCheckQboBillVoided = () => usePayrollMutation((periodId: string) => checkQboBillVoided(periodId))
export const useForceClearQboBill = () =>
  usePayrollMutation(({ periodId, reason }: { periodId: string; reason: string }) => forceClearQboBill(periodId, reason))
export const useMarkPeriodPaid = () =>
  usePayrollMutation(({ id, paidOn, note }: { id: string; paidOn: string; note: string }) => markPeriodPaid(id, paidOn, note))
export const useRequestPayoutCorrection = () =>
  usePayrollMutation(({ id, note }: { id: string; note: string }) => requestPayoutCorrection(id, note))
export const useValidatePayoutPeriod = () => usePayrollMutation((id: string) => validatePayoutPeriod(id))
export const useUploadProfessionalInvoice = () => usePayrollMutation((input: UploadInvoiceInput) => uploadProfessionalInvoice(input))
export const useGenerateProfessionalInvoice = () =>
  usePayrollMutation(({ periodId, number, issuedOn }: { periodId: string; number: string; issuedOn: string }) =>
    generateProfessionalInvoice(periodId, number, issuedOn))
export const useSetPayoutRule = () =>
  usePayrollMutation(({ serviceId, rule }: { serviceId: string; rule: PayoutRule }) => setPayoutRule(serviceId, rule))
