// src/facturation/api.ts
// Supabase API functions for the facturation module

import { supabase } from '@/lib/supabaseClient'
import type {
  Invoice,
  InvoiceLineItem,
  InvoicePayment,
  InvoicePayerAllocation,
  InvoiceAuditEntry,
  InvoiceStatus,
  CreateInvoiceInput,
  AddLineItemInput,
  UpdateLineItemInput,
  RecordPaymentInput,
  AllocatePayerInput,
  InvoiceFilters,
  PayerAllocationFilters,
  PayerAllocationStatus,
} from './types'
import { getClinicDateString } from '@/shared/lib/timezone'
import {
  mapInvoiceFromDb,
  mapInvoicesFromDb,
  mapLineItemFromDb,
  mapLineItemsFromDb,
  mapPaymentFromDb,
  mapPaymentsFromDb,
  mapPayerAllocationFromDb,
  mapPayerAllocationsFromDb,
  mapAuditEntriesFromDb,
  mapInvoiceClientFromDb,
  type InvoiceRow,
  type InvoiceLineItemRow,
  type InvoicePaymentRow,
  type InvoicePayerAllocationRow,
  type InvoiceAuditLogRow,
} from './mappers'

// =============================================================================
// INVOICE CRUD
// =============================================================================

/**
 * Create a new invoice for an appointment.
 * Links the invoice to the specified client (important for multi-client appointments).
 * Automatically adds the appointment's service as the first line item.
 * Optionally adds file opening fee for new clients.
 * Uses a SECURITY DEFINER function to ensure line items can be created.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  // Validate required inputs
  if (!input.appointmentId) {
    throw new Error('Appointment ID is required')
  }
  if (!input.clientId) {
    throw new Error('Client ID is required')
  }

  // Call the RPC function that creates invoice + line item atomically
  const { data, error } = await supabase.rpc('create_invoice_with_line_item', {
    p_appointment_id: input.appointmentId,
    p_client_id: input.clientId,
    p_notes_client: input.notesClient || null,
    p_notes_internal: input.notesInternal || null,
    p_add_file_opening_fee: input.addFileOpeningFee || false,
  })

  if (error) {
    // Parse RPC error for user-friendly message
    const errorMsg = error.message || 'Unknown error'
    if (errorMsg.includes('already exists')) {
      throw new Error('Une facture existe déjà pour ce rendez-vous')
    }
    if (errorMsg.includes('not found')) {
      throw new Error('Rendez-vous ou client introuvable')
    }
    throw new Error(`Échec de création de facture: ${errorMsg}`)
  }

  if (!data) {
    throw new Error('Échec de création de facture: aucun ID retourné')
  }

  // The RPC returns the invoice ID, now fetch the full invoice
  const invoice = await fetchInvoice(data as string)
  if (!invoice) {
    throw new Error('Facture créée mais impossible à charger')
  }

  return invoice
}

/**
 * Fetch a single invoice by ID with all related data.
 */
export async function fetchInvoice(id: string): Promise<Invoice | null> {
  // First, fetch just the invoice
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const invoice = mapInvoiceFromDb(data as InvoiceRow)

  // Fetch client separately
  if (data.client_id) {
    const { data: clientData } = await supabase
      .from('clients')
      .select('id, client_id, first_name, last_name, email, cell_phone, street_number, street_name, apartment, city, province, postal_code, balance_cents')
      .eq('id', data.client_id)
      .single()
    if (clientData) {
      invoice.client = mapInvoiceClientFromDb(clientData)
    }
  }

  // Fetch professional separately (avoid FK join issues with separate queries)
  // Note: profile lookup may fail due to RLS if user is provider viewing another professional's invoice
  if (data.professional_id) {
    try {
      const { data: profData } = await supabase
        .from('professionals')
        .select('id, profile_id')
        .eq('id', data.professional_id)
        .single()
      if (profData?.profile_id) {
        // profiles table has display_name, not first_name/last_name
        const { data: profileData } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', profData.profile_id)
          .single()
        if (profileData) {
          invoice.professional = {
            id: profData.id,
            displayName: profileData.display_name,
            professionTitleKey: null,
          }
        } else {
          // RLS blocked access - use a placeholder
          invoice.professional = {
            id: profData.id,
            displayName: 'Professionnel',
            professionTitleKey: null,
          }
        }
      }
    } catch {
      // Silently handle RLS errors - professional name not critical for invoice display
      invoice.professional = {
        id: data.professional_id,
        displayName: 'Professionnel',
        professionTitleKey: null,
      }
    }
  }

  // Fetch appointment separately (avoid FK join issues with separate queries)
  if (data.appointment_id) {
    const { data: aptData } = await supabase
      .from('appointments')
      .select('id, start_time, duration_minutes, status, service_id, cancellation_fee_applied, cancellation_fee_percent')
      .eq('id', data.appointment_id)
      .single()
    if (aptData) {
      let serviceName = ''
      if (aptData.service_id) {
        const { data: serviceData } = await supabase
          .from('services')
          .select('name_fr')
          .eq('id', aptData.service_id)
          .single()
        serviceName = serviceData?.name_fr || ''
      }
      invoice.appointment = {
        id: aptData.id,
        startTime: aptData.start_time,
        durationMinutes: aptData.duration_minutes,
        status: aptData.status,
        serviceId: aptData.service_id,
        serviceName,
        cancellationFeeApplied: aptData.cancellation_fee_applied,
        cancellationFeePercent: aptData.cancellation_fee_percent,
      }
    }
  }

  // Fetch line items
  invoice.lineItems = await fetchInvoiceLineItems(id)

  // Fetch payments
  invoice.payments = await fetchInvoicePayments(id)

  // Fetch payer allocations
  invoice.payerAllocations = await fetchInvoicePayerAllocations(id)

  return invoice
}

/**
 * Fetch invoice by appointment ID (check if invoice already exists).
 */
export async function fetchInvoiceByAppointment(appointmentId: string): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('appointment_id', appointmentId)
    .neq('status', 'void')
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return mapInvoiceFromDb(data as InvoiceRow)
}

/**
 * Fetch all invoices for a client.
 */
export async function fetchInvoicesForClient(clientId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('client_id', clientId)
    .order('invoice_date', { ascending: false })

  if (error) throw error

  return mapInvoicesFromDb((data || []) as InvoiceRow[])
}

/**
 * Fetch invoices with filters.
 */
export async function fetchInvoices(filters?: InvoiceFilters): Promise<Invoice[]> {
  let query = supabase
    .from('invoices')
    .select('*')
    .order('invoice_date', { ascending: false })

  if (filters?.clientId) {
    query = query.eq('client_id', filters.clientId)
  }

  if (filters?.professionalId) {
    query = query.eq('professional_id', filters.professionalId)
  }

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status)
    } else {
      query = query.eq('status', filters.status)
    }
  }

  if (filters?.dateFrom) {
    query = query.gte('invoice_date', filters.dateFrom)
  }

  if (filters?.dateTo) {
    query = query.lte('invoice_date', filters.dateTo)
  }

  if (filters?.hasBalance) {
    query = query.gt('balance_cents', 0)
  }

  const { data, error } = await query

  if (error) throw error

  return mapInvoicesFromDb((data || []) as InvoiceRow[])
}

/**
 * Update invoice status.
 */
export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus
): Promise<Invoice> {
  const oldInvoice = await fetchInvoice(id)

  const { data, error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  await logInvoiceAudit(id, status === 'pending' ? 'finalized' : 'updated',
    { status: oldInvoice?.status },
    { status }
  )

  return mapInvoiceFromDb(data as InvoiceRow)
}

/**
 * Update invoice notes.
 */
export async function updateInvoiceNotes(
  id: string,
  notesClient?: string,
  notesInternal?: string
): Promise<Invoice> {
  const updateData: Partial<InvoiceRow> = {}
  if (notesClient !== undefined) updateData.notes_client = notesClient
  if (notesInternal !== undefined) updateData.notes_internal = notesInternal

  const { data, error } = await supabase
    .from('invoices')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  return mapInvoiceFromDb(data as InvoiceRow)
}

/**
 * Void an invoice.
 */
export async function voidInvoice(id: string, reason?: string): Promise<Invoice> {
  const oldInvoice = await fetchInvoice(id)

  const { data, error } = await supabase
    .from('invoices')
    .update({
      status: 'void',
      notes_internal: reason
        ? `${oldInvoice?.notesInternal || ''}\n[Annulé: ${reason}]`.trim()
        : oldInvoice?.notesInternal,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  await logInvoiceAudit(id, 'voided',
    { status: oldInvoice?.status },
    { status: 'void', reason }
  )

  return mapInvoiceFromDb(data as InvoiceRow)
}

// =============================================================================
// LINE ITEMS
// =============================================================================

/**
 * Fetch line items for an invoice.
 */
export async function fetchInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
  const { data, error } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('display_order')

  if (error) throw error

  return mapLineItemsFromDb((data || []) as InvoiceLineItemRow[])
}

/**
 * Add a line item to an invoice.
 */
export async function addLineItem(input: AddLineItemInput): Promise<InvoiceLineItem> {
  // Calculate totals
  const subtotal = Math.round(input.quantity! * input.unitPriceCents)
  let discountCents = 0

  if (input.discountType && input.discountValue) {
    if (input.discountType === 'percent') {
      discountCents = Math.round(subtotal * (input.discountValue / 100))
    } else {
      discountCents = Math.round(input.discountValue)
    }
  }

  const afterDiscount = subtotal - discountCents

  // Calculate tax if taxable
  let taxTpsCents = 0
  let taxTvqCents = 0
  if (input.isTaxable) {
    taxTpsCents = Math.round(afterDiscount * 0.05)
    taxTvqCents = Math.round(afterDiscount * 0.09975)
  }

  const total = afterDiscount + taxTpsCents + taxTvqCents

  const { data, error } = await supabase
    .from('invoice_line_items')
    .insert({
      invoice_id: input.invoiceId,
      line_type: input.lineType,
      service_id: input.serviceId || null,
      service_name_snapshot: input.serviceName,
      service_key_snapshot: input.serviceKey || null,
      quantity_unit: input.quantityUnit || 'unit',
      quantity: input.quantity || 1,
      billable_minutes: input.billableMinutes || null,
      unit_price_cents: input.unitPriceCents,
      profession_category_key_snapshot: input.professionCategoryKey || null,
      discount_type: input.discountType || null,
      discount_value: input.discountValue || null,
      discount_cents: discountCents,
      is_taxable: input.isTaxable,
      tax_tps_rate_snapshot: input.isTaxable ? 0.05 : null,
      tax_tvq_rate_snapshot: input.isTaxable ? 0.09975 : null,
      tax_tps_cents: taxTpsCents,
      tax_tvq_cents: taxTvqCents,
      subtotal_cents: afterDiscount,
      total_cents: total,
      display_order: input.displayOrder || 0,
      description: input.description || null,
    })
    .select()
    .single()

  if (error) throw error

  await logInvoiceAudit(input.invoiceId, 'line_added', null, {
    lineType: input.lineType,
    serviceName: input.serviceName,
    totalCents: total,
  })

  return mapLineItemFromDb(data as InvoiceLineItemRow)
}

/**
 * Update a line item.
 */
export async function updateLineItem(input: UpdateLineItemInput): Promise<InvoiceLineItem> {
  // Fetch current item
  const { data: current, error: fetchError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('id', input.id)
    .single()

  if (fetchError) throw fetchError

  // Build update with recalculated totals
  const quantity = input.quantity ?? current.quantity
  const unitPriceCents = input.unitPriceCents ?? current.unit_price_cents
  const discountType = input.discountType !== undefined ? input.discountType : current.discount_type
  const discountValue = input.discountValue !== undefined ? input.discountValue : current.discount_value

  const subtotal = Math.round(quantity * unitPriceCents)
  let discountCents = 0

  if (discountType && discountValue) {
    if (discountType === 'percent') {
      discountCents = Math.round(subtotal * (discountValue / 100))
    } else {
      discountCents = Math.round(discountValue)
    }
  }

  const afterDiscount = subtotal - discountCents

  let taxTpsCents = 0
  let taxTvqCents = 0
  if (current.is_taxable) {
    taxTpsCents = Math.round(afterDiscount * 0.05)
    taxTvqCents = Math.round(afterDiscount * 0.09975)
  }

  const total = afterDiscount + taxTpsCents + taxTvqCents

  const { data, error } = await supabase
    .from('invoice_line_items')
    .update({
      quantity,
      billable_minutes: input.billableMinutes ?? current.billable_minutes,
      unit_price_cents: unitPriceCents,
      discount_type: discountType,
      discount_value: discountValue,
      discount_cents: discountCents,
      tax_tps_cents: taxTpsCents,
      tax_tvq_cents: taxTvqCents,
      subtotal_cents: afterDiscount,
      total_cents: total,
      description: input.description ?? current.description,
    })
    .eq('id', input.id)
    .select()
    .single()

  if (error) throw error

  await logInvoiceAudit(current.invoice_id, 'line_updated',
    { totalCents: current.total_cents },
    { totalCents: total }
  )

  return mapLineItemFromDb(data as InvoiceLineItemRow)
}

/**
 * Remove a line item.
 */
export async function removeLineItem(id: string): Promise<void> {
  // Get invoice ID for audit
  const { data: item, error: fetchError } = await supabase
    .from('invoice_line_items')
    .select('invoice_id, service_name_snapshot, total_cents')
    .eq('id', id)
    .single()

  if (fetchError) throw fetchError

  const { error } = await supabase
    .from('invoice_line_items')
    .delete()
    .eq('id', id)

  if (error) throw error

  await logInvoiceAudit(item.invoice_id, 'line_removed', {
    serviceName: item.service_name_snapshot,
    totalCents: item.total_cents,
  }, null)
}

// =============================================================================
// PAYMENTS
// =============================================================================

/**
 * Fetch payments for an invoice.
 */
export async function fetchInvoicePayments(invoiceId: string): Promise<InvoicePayment[]> {
  const { data, error } = await supabase
    .from('invoice_payments')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('payment_date', { ascending: false })

  if (error) throw error

  return mapPaymentsFromDb((data || []) as InvoicePaymentRow[])
}

/**
 * Record a payment for an invoice.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<InvoicePayment> {
  // Validate payment amount
  if (!input.amountCents || input.amountCents <= 0) {
    throw new Error('Payment amount must be greater than zero')
  }

  // Use clinic timezone for default payment date
  const paymentDate = input.paymentDate || getClinicDateString(new Date())

  const { data, error } = await supabase
    .from('invoice_payments')
    .insert({
      invoice_id: input.invoiceId,
      amount_cents: input.amountCents,
      payment_date: paymentDate,
      payment_method: input.paymentMethod || null,
      reference_number: input.referenceNumber || null,
      source: 'manual',
      notes: input.notes || null,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to record payment: ${error.message}`)
  }

  await logInvoiceAudit(input.invoiceId, 'payment_recorded', null, {
    amountCents: input.amountCents,
    paymentMethod: input.paymentMethod,
    paymentDate,
  })

  return mapPaymentFromDb(data as InvoicePaymentRow)
}

/**
 * Remove a payment.
 */
export async function removePayment(paymentId: string): Promise<void> {
  // Get invoice ID for audit
  const { data: payment, error: fetchError } = await supabase
    .from('invoice_payments')
    .select('invoice_id, amount_cents')
    .eq('id', paymentId)
    .single()

  if (fetchError) throw fetchError

  const { error } = await supabase
    .from('invoice_payments')
    .delete()
    .eq('id', paymentId)

  if (error) throw error

  await logInvoiceAudit(payment.invoice_id, 'payment_removed', {
    amountCents: payment.amount_cents,
  }, null)
}

// =============================================================================
// PAYER ALLOCATIONS
// =============================================================================

/**
 * Fetch payer allocations for an invoice.
 */
export async function fetchInvoicePayerAllocations(
  invoiceId: string
): Promise<InvoicePayerAllocation[]> {
  const { data, error } = await supabase
    .from('invoice_payer_allocations')
    .select('*')
    .eq('invoice_id', invoiceId)

  if (error) throw error

  return mapPayerAllocationsFromDb((data || []) as InvoicePayerAllocationRow[])
}

/**
 * Fetch payer allocations with filters (for reporting).
 */
export async function fetchPayerAllocations(
  filters?: PayerAllocationFilters
): Promise<InvoicePayerAllocation[]> {
  let query = supabase
    .from('invoice_payer_allocations')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters?.payerType) {
    query = query.eq('payer_type', filters.payerType)
  }

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }

  if (filters?.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }

  if (filters?.dateTo) {
    query = query.lte('created_at', filters.dateTo)
  }

  const { data, error } = await query

  if (error) throw error

  return mapPayerAllocationsFromDb((data || []) as InvoicePayerAllocationRow[])
}

/**
 * Allocate an amount to an external payer.
 */
export async function allocateToExternalPayer(
  input: AllocatePayerInput
): Promise<InvoicePayerAllocation> {
  const { data, error } = await supabase
    .from('invoice_payer_allocations')
    .insert({
      invoice_id: input.invoiceId,
      client_external_payer_id: input.clientExternalPayerId,
      payer_type: input.payerType,
      amount_cents: input.amountCents,
      ivac_rate_applied_cents: input.ivacRateAppliedCents || null,
      pae_rule_type_applied: input.paeRuleTypeApplied || null,
      pae_percentage_applied: input.paePercentageApplied || null,
      notes: input.notes || null,
    })
    .select()
    .single()

  if (error) throw error

  // Update invoice external_payer_amount_cents
  await supabase.rpc('update_invoice_payer_amount', { p_invoice_id: input.invoiceId })

  await logInvoiceAudit(input.invoiceId, 'payer_allocated', null, {
    payerType: input.payerType,
    amountCents: input.amountCents,
  })

  return mapPayerAllocationFromDb(data as InvoicePayerAllocationRow)
}

/**
 * Update payer allocation status (for reporting workflow).
 */
export async function updatePayerAllocationStatus(
  allocationId: string,
  status: PayerAllocationStatus
): Promise<InvoicePayerAllocation> {
  const updateData: Partial<InvoicePayerAllocationRow> = {
    status,
  }

  if (status === 'reported') {
    updateData.reported_at = new Date().toISOString()
  } else if (status === 'paid') {
    updateData.paid_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('invoice_payer_allocations')
    .update(updateData)
    .eq('id', allocationId)
    .select()
    .single()

  if (error) throw error

  const action = status === 'reported' ? 'payer_reported' : 'payer_paid'
  await logInvoiceAudit(data.invoice_id, action, null, { status })

  return mapPayerAllocationFromDb(data as InvoicePayerAllocationRow)
}

// =============================================================================
// AUDIT LOG
// =============================================================================

/**
 * Fetch audit log for an invoice.
 */
export async function fetchInvoiceAuditLog(invoiceId: string): Promise<InvoiceAuditEntry[]> {
  const { data, error } = await supabase
    .from('invoice_audit_log')
    .select(`
      *,
      profiles:actor_id ( display_name )
    `)
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return mapAuditEntriesFromDb((data || []) as InvoiceAuditLogRow[]).map((entry, i) => ({
    ...entry,
    actorName: data?.[i]?.profiles?.display_name || undefined,
  }))
}

/**
 * Log an audit entry (internal helper).
 */
async function logInvoiceAudit(
  invoiceId: string,
  action: string,
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): Promise<void> {
  // Get current user's profile ID
  const { data: { user } } = await supabase.auth.getUser()

  let actorId: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    actorId = profile?.id || null
  }

  await supabase
    .from('invoice_audit_log')
    .insert({
      invoice_id: invoiceId,
      actor_id: actorId,
      action,
      old_value: oldValue,
      new_value: newValue,
    })
}

// =============================================================================
// CLIENT BALANCE
// =============================================================================

/**
 * Fetch client balance.
 */
export async function fetchClientBalance(clientId: string): Promise<number> {
  const { data, error } = await supabase
    .from('clients')
    .select('balance_cents')
    .eq('id', clientId)
    .single()

  if (error) throw error

  return data?.balance_cents || 0
}

/**
 * Recalculate client balance from invoices.
 * This should rarely be needed as triggers handle it automatically.
 */
export async function recalculateClientBalance(clientId: string): Promise<number> {
  // Sum all non-void invoice balances (negative = owes money)
  const { data, error } = await supabase
    .from('invoices')
    .select('balance_cents')
    .eq('client_id', clientId)
    .neq('status', 'void')

  if (error) throw error

  const totalBalance = (data || []).reduce(
    (sum, inv) => sum - inv.balance_cents, // Negative because balance_cents > 0 means owed
    0
  )

  // Update client
  await supabase
    .from('clients')
    .update({ balance_cents: totalBalance })
    .eq('id', clientId)

  return totalBalance
}
