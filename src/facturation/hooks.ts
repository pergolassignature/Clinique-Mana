// src/facturation/hooks.ts
// React Query hooks for the facturation module

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchInvoice,
  fetchInvoiceByAppointment,
  fetchInvoicesForClient,
  fetchInvoices,
  createInvoice,
  updateInvoiceStatus,
  updateInvoiceNotes,
  voidInvoice,
  addLineItem,
  updateLineItem,
  removeLineItem,
  recordPayment,
  removePayment,
  allocateToExternalPayer,
  updatePayerAllocationStatus,
  removePayerAllocation,
  fetchInvoiceAuditLog,
  fetchClientBalance,
  fetchPayerAllocations,
  fetchIvacReport,
} from './api'
import { detectNewClientStatus, tagNewClient } from './utils/new-client-detection'
import {
  fetchClientActivePayers,
  calculateIvacAllocation,
  calculatePaeAllocation,
} from './utils/payer-allocation'
import type {
  InvoiceFilters,
  InvoiceStatus,
  CreateInvoiceInput,
  AddLineItemInput,
  UpdateLineItemInput,
  RecordPaymentInput,
  AllocatePayerInput,
  PayerAllocationStatus,
  PayerAllocationFilters,
  IvacReportFilters,
} from './types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: () => [...invoiceKeys.all, 'list'] as const,
  list: (filters?: InvoiceFilters) => [...invoiceKeys.lists(), filters] as const,
  details: () => [...invoiceKeys.all, 'detail'] as const,
  detail: (id: string) => [...invoiceKeys.details(), id] as const,
  byAppointment: (appointmentId: string) => [...invoiceKeys.all, 'appointment', appointmentId] as const,
  byClient: (clientId: string) => [...invoiceKeys.all, 'client', clientId] as const,
  audit: (invoiceId: string) => [...invoiceKeys.all, 'audit', invoiceId] as const,
}

export const clientBalanceKeys = {
  all: ['client-balance'] as const,
  client: (clientId: string) => [...clientBalanceKeys.all, clientId] as const,
}

export const newClientKeys = {
  all: ['new-client'] as const,
  status: (clientId: string) => [...newClientKeys.all, 'status', clientId] as const,
}

export const payerKeys = {
  all: ['payers'] as const,
  client: (clientId: string) => [...payerKeys.all, 'client', clientId] as const,
  allocations: (filters?: PayerAllocationFilters) => [...payerKeys.all, 'allocations', filters] as const,
}

export const ivacReportKeys = {
  all: ['ivac-report'] as const,
  list: (filters?: IvacReportFilters) => [...ivacReportKeys.all, 'list', filters] as const,
}

// =============================================================================
// INVOICE QUERIES
// =============================================================================

/**
 * Fetch a single invoice by ID with all related data.
 */
export function useInvoice(id: string) {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => fetchInvoice(id),
    enabled: !!id,
  })
}

/**
 * Fetch invoice by appointment ID (check if one exists).
 */
export function useInvoiceByAppointment(appointmentId: string) {
  return useQuery({
    queryKey: invoiceKeys.byAppointment(appointmentId),
    queryFn: () => fetchInvoiceByAppointment(appointmentId),
    enabled: !!appointmentId,
  })
}

/**
 * Fetch all invoices for a client.
 */
export function useClientInvoices(clientId: string) {
  return useQuery({
    queryKey: invoiceKeys.byClient(clientId),
    queryFn: () => fetchInvoicesForClient(clientId),
    enabled: !!clientId,
  })
}

/**
 * Fetch invoices with optional filters.
 */
export function useInvoices(filters?: InvoiceFilters) {
  return useQuery({
    queryKey: invoiceKeys.list(filters),
    queryFn: () => fetchInvoices(filters),
  })
}

/**
 * Fetch audit log for an invoice.
 */
export function useInvoiceAuditLog(invoiceId: string) {
  return useQuery({
    queryKey: invoiceKeys.audit(invoiceId),
    queryFn: () => fetchInvoiceAuditLog(invoiceId),
    enabled: !!invoiceId,
  })
}

// =============================================================================
// INVOICE MUTATIONS
// =============================================================================

/**
 * Create a new invoice.
 */
export function useCreateInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => createInvoice(input),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: invoiceKeys.byAppointment(invoice.appointmentId) })
      queryClient.invalidateQueries({ queryKey: invoiceKeys.byClient(invoice.clientId) })
      queryClient.invalidateQueries({ queryKey: clientBalanceKeys.client(invoice.clientId) })
    },
  })
}

/**
 * Update invoice status.
 */
export function useUpdateInvoiceStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: InvoiceStatus }) =>
      updateInvoiceStatus(id, status),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoice.id) })
      queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: clientBalanceKeys.client(invoice.clientId) })
    },
  })
}

/**
 * Update invoice notes.
 */
export function useUpdateInvoiceNotes() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      notesClient,
      notesInternal,
    }: {
      id: string
      notesClient?: string
      notesInternal?: string
    }) => updateInvoiceNotes(id, notesClient, notesInternal),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoice.id) })
    },
  })
}

/**
 * Void an invoice.
 */
export function useVoidInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      voidInvoice(id, reason),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoice.id) })
      queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: invoiceKeys.byClient(invoice.clientId) })
      queryClient.invalidateQueries({ queryKey: clientBalanceKeys.client(invoice.clientId) })
    },
  })
}

// =============================================================================
// LINE ITEM MUTATIONS
// =============================================================================

/**
 * Add a line item to an invoice.
 */
export function useAddLineItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AddLineItemInput) => addLineItem(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(variables.invoiceId) })
    },
  })
}

/**
 * Update a line item.
 */
export function useUpdateLineItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateLineItemInput) => updateLineItem(input),
    onSuccess: (lineItem) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(lineItem.invoiceId) })
    },
  })
}

/**
 * Remove a line item.
 */
export function useRemoveLineItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ lineItemId }: { lineItemId: string; invoiceId: string }) =>
      removeLineItem(lineItemId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(variables.invoiceId) })
    },
  })
}

// =============================================================================
// PAYMENT MUTATIONS
// =============================================================================

/**
 * Record a payment.
 */
export function useRecordPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: RecordPaymentInput) => recordPayment(input),
    onSuccess: (payment) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(payment.invoiceId) })
      // Also invalidate client balance since payment affects it
      queryClient.invalidateQueries({ queryKey: clientBalanceKeys.all })
    },
  })
}

/**
 * Remove a payment.
 */
export function useRemovePayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ paymentId }: { paymentId: string; invoiceId: string }) =>
      removePayment(paymentId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(variables.invoiceId) })
      queryClient.invalidateQueries({ queryKey: clientBalanceKeys.all })
    },
  })
}

// =============================================================================
// PAYER ALLOCATION MUTATIONS
// =============================================================================

/**
 * Allocate an amount to an external payer.
 */
export function useAllocateToExternalPayer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AllocatePayerInput) => allocateToExternalPayer(input),
    onSuccess: (allocation) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(allocation.invoiceId) })
      queryClient.invalidateQueries({ queryKey: payerKeys.allocations() })
    },
  })
}

/**
 * Update payer allocation status.
 */
export function useUpdatePayerAllocationStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      allocationId,
      status,
    }: {
      allocationId: string
      status: PayerAllocationStatus
    }) => updatePayerAllocationStatus(allocationId, status),
    onSuccess: (allocation) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(allocation.invoiceId) })
      queryClient.invalidateQueries({ queryKey: payerKeys.allocations() })
    },
  })
}

/**
 * Remove a payer allocation.
 */
export function useRemovePayerAllocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ allocationId }: { allocationId: string; invoiceId: string }) =>
      removePayerAllocation(allocationId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(variables.invoiceId) })
      queryClient.invalidateQueries({ queryKey: payerKeys.allocations() })
    },
  })
}

/**
 * Fetch payer allocations for reporting.
 */
export function usePayerAllocations(filters?: PayerAllocationFilters) {
  return useQuery({
    queryKey: payerKeys.allocations(filters),
    queryFn: () => fetchPayerAllocations(filters),
  })
}

// =============================================================================
// CLIENT BALANCE QUERIES
// =============================================================================

/**
 * Fetch client balance.
 */
export function useClientBalance(clientId: string) {
  return useQuery({
    queryKey: clientBalanceKeys.client(clientId),
    queryFn: () => fetchClientBalance(clientId),
    enabled: !!clientId,
  })
}

// =============================================================================
// NEW CLIENT DETECTION
// =============================================================================

/**
 * Check if a client is new (for file opening fee).
 */
export function useNewClientStatus(clientId: string) {
  return useQuery({
    queryKey: newClientKeys.status(clientId),
    queryFn: () => detectNewClientStatus(clientId),
    enabled: !!clientId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Tag a client as new_client or existing_relation.
 */
export function useTagNewClient() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      clientId,
      tag,
    }: {
      clientId: string
      tag: 'new_client' | 'existing_relation'
    }) => tagNewClient(clientId, tag),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: newClientKeys.status(variables.clientId) })
      queryClient.invalidateQueries({ queryKey: ['clients', variables.clientId] })
    },
  })
}

// =============================================================================
// IVAC REPORT QUERIES
// =============================================================================

/**
 * Fetch IVAC report data for billing/reporting.
 * Returns all IVAC allocations with related invoice, client, and professional data.
 */
export function useIvacReport(filters?: IvacReportFilters) {
  return useQuery({
    queryKey: ivacReportKeys.list(filters),
    queryFn: () => fetchIvacReport(filters),
  })
}

// =============================================================================
// EXTERNAL PAYER QUERIES
// =============================================================================

/**
 * Fetch active external payers for a client.
 */
export function useClientActivePayers(clientId: string) {
  return useQuery({
    queryKey: payerKeys.client(clientId),
    queryFn: () => fetchClientActivePayers(clientId),
    enabled: !!clientId,
  })
}

/**
 * Hook to calculate payer allocation for an invoice.
 * Returns the allocation calculation without persisting it.
 */
export function useCalculatePayerAllocation(
  clientId: string,
  totalCents: number
) {
  const { data: payers } = useClientActivePayers(clientId)

  // Build allocation previews for each active payer
  const allocations = payers?.map((payer) => {
    if (payer.payer_type === 'ivac') {
      return {
        payer,
        ...calculateIvacAllocation(totalCents),
      }
    } else if (payer.payer_type === 'pae') {
      // For PAE, we need the appointment count
      // This is a simplified version - real implementation would fetch count
      const appointmentNumber = payer.pae_details.appointments_used + 1
      return {
        payer,
        ...calculatePaeAllocation(totalCents, payer.pae_details, appointmentNumber),
      }
    }
    return null
  }).filter(Boolean)

  return allocations || []
}
