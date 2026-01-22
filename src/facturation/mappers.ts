// src/facturation/mappers.ts
// Type mappers for converting between Supabase database types and frontend types

import type {
  Invoice,
  InvoiceLineItem,
  InvoicePayment,
  InvoicePayerAllocation,
  InvoiceAuditEntry,
  InvoiceClient,
  InvoiceProfessional,
  InvoiceAppointment,
  InvoiceStatus,
  LineItemType,
  QuantityUnit,
  PaymentMethod,
  PaymentSource,
  DiscountType,
  QboSyncStatus,
  PayerAllocationType,
  PayerAllocationStatus,
  InvoiceAuditAction,
} from './types'

// =============================================================================
// DATABASE ROW TYPES (snake_case from Supabase)
// =============================================================================

export interface InvoiceRow {
  id: string
  invoice_number: string
  appointment_id: string
  client_id: string
  professional_id: string
  invoice_date: string
  due_date: string | null
  status: string
  subtotal_cents: number
  discount_cents: number
  tax_tps_cents: number
  tax_tvq_cents: number
  total_cents: number
  external_payer_amount_cents: number
  client_amount_cents: number
  amount_paid_cents: number
  balance_cents: number
  qbo_invoice_id: string | null
  qbo_invoice_number: string | null
  qbo_sync_status: string | null
  qbo_sync_error: string | null
  qbo_synced_at: string | null
  notes_internal: string | null
  notes_client: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceLineItemRow {
  id: string
  invoice_id: string
  line_type: string
  service_id: string | null
  service_name_snapshot: string
  service_key_snapshot: string | null
  quantity_unit: string
  quantity: number
  billable_minutes: number | null
  unit_price_cents: number
  profession_category_key_snapshot: string | null
  discount_type: string | null
  discount_value: number | null
  discount_cents: number
  is_taxable: boolean
  tax_tps_rate_snapshot: number | null
  tax_tvq_rate_snapshot: number | null
  tax_tps_cents: number
  tax_tvq_cents: number
  subtotal_cents: number
  total_cents: number
  display_order: number
  description: string | null
  created_at: string
  updated_at: string
}

export interface InvoicePaymentRow {
  id: string
  invoice_id: string
  amount_cents: number
  payment_date: string
  payment_method: string | null
  reference_number: string | null
  qbo_payment_id: string | null
  qbo_synced_at: string | null
  source: string
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface InvoicePayerAllocationRow {
  id: string
  invoice_id: string
  client_external_payer_id: string
  payer_type: string
  amount_cents: number
  ivac_rate_applied_cents: number | null
  pae_rule_type_applied: string | null
  pae_percentage_applied: number | null
  status: string
  reported_at: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
}

export interface InvoiceAuditLogRow {
  id: string
  invoice_id: string
  actor_id: string | null
  action: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  context: Record<string, unknown> | null
  created_at: string
}

// =============================================================================
// INVOICE MAPPER
// =============================================================================

export function mapInvoiceFromDb(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    professionalId: row.professional_id,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    status: row.status as InvoiceStatus,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    taxTpsCents: row.tax_tps_cents,
    taxTvqCents: row.tax_tvq_cents,
    totalCents: row.total_cents,
    externalPayerAmountCents: row.external_payer_amount_cents,
    clientAmountCents: row.client_amount_cents,
    amountPaidCents: row.amount_paid_cents,
    balanceCents: row.balance_cents,
    qboInvoiceId: row.qbo_invoice_id,
    qboInvoiceNumber: row.qbo_invoice_number,
    qboSyncStatus: (row.qbo_sync_status || 'pending') as QboSyncStatus,
    qboSyncError: row.qbo_sync_error,
    qboSyncedAt: row.qbo_synced_at,
    notesInternal: row.notes_internal,
    notesClient: row.notes_client,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapInvoiceToDb(invoice: Partial<Invoice>): Partial<InvoiceRow> {
  const row: Partial<InvoiceRow> = {}

  if (invoice.appointmentId !== undefined) row.appointment_id = invoice.appointmentId
  if (invoice.clientId !== undefined) row.client_id = invoice.clientId
  if (invoice.professionalId !== undefined) row.professional_id = invoice.professionalId
  if (invoice.invoiceDate !== undefined) row.invoice_date = invoice.invoiceDate
  if (invoice.dueDate !== undefined) row.due_date = invoice.dueDate
  if (invoice.status !== undefined) row.status = invoice.status
  if (invoice.notesInternal !== undefined) row.notes_internal = invoice.notesInternal
  if (invoice.notesClient !== undefined) row.notes_client = invoice.notesClient
  if (invoice.qboInvoiceId !== undefined) row.qbo_invoice_id = invoice.qboInvoiceId
  if (invoice.qboInvoiceNumber !== undefined) row.qbo_invoice_number = invoice.qboInvoiceNumber
  if (invoice.qboSyncStatus !== undefined) row.qbo_sync_status = invoice.qboSyncStatus
  if (invoice.qboSyncError !== undefined) row.qbo_sync_error = invoice.qboSyncError
  if (invoice.qboSyncedAt !== undefined) row.qbo_synced_at = invoice.qboSyncedAt

  return row
}

// =============================================================================
// LINE ITEM MAPPER
// =============================================================================

export function mapLineItemFromDb(row: InvoiceLineItemRow): InvoiceLineItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    lineType: row.line_type as LineItemType,
    serviceId: row.service_id,
    serviceNameSnapshot: row.service_name_snapshot,
    serviceKeySnapshot: row.service_key_snapshot,
    quantityUnit: row.quantity_unit as QuantityUnit,
    quantity: row.quantity,
    billableMinutes: row.billable_minutes,
    unitPriceCents: row.unit_price_cents,
    professionCategoryKeySnapshot: row.profession_category_key_snapshot,
    discountType: row.discount_type as DiscountType | null,
    discountValue: row.discount_value,
    discountCents: row.discount_cents,
    isTaxable: row.is_taxable,
    taxTpsRateSnapshot: row.tax_tps_rate_snapshot,
    taxTvqRateSnapshot: row.tax_tvq_rate_snapshot,
    taxTpsCents: row.tax_tps_cents,
    taxTvqCents: row.tax_tvq_cents,
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    displayOrder: row.display_order,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapLineItemToDb(item: Partial<InvoiceLineItem>): Partial<InvoiceLineItemRow> {
  const row: Partial<InvoiceLineItemRow> = {}

  if (item.invoiceId !== undefined) row.invoice_id = item.invoiceId
  if (item.lineType !== undefined) row.line_type = item.lineType
  if (item.serviceId !== undefined) row.service_id = item.serviceId
  if (item.serviceNameSnapshot !== undefined) row.service_name_snapshot = item.serviceNameSnapshot
  if (item.serviceKeySnapshot !== undefined) row.service_key_snapshot = item.serviceKeySnapshot
  if (item.quantityUnit !== undefined) row.quantity_unit = item.quantityUnit
  if (item.quantity !== undefined) row.quantity = item.quantity
  if (item.billableMinutes !== undefined) row.billable_minutes = item.billableMinutes
  if (item.unitPriceCents !== undefined) row.unit_price_cents = item.unitPriceCents
  if (item.professionCategoryKeySnapshot !== undefined) row.profession_category_key_snapshot = item.professionCategoryKeySnapshot
  if (item.discountType !== undefined) row.discount_type = item.discountType
  if (item.discountValue !== undefined) row.discount_value = item.discountValue
  if (item.discountCents !== undefined) row.discount_cents = item.discountCents
  if (item.isTaxable !== undefined) row.is_taxable = item.isTaxable
  if (item.taxTpsRateSnapshot !== undefined) row.tax_tps_rate_snapshot = item.taxTpsRateSnapshot
  if (item.taxTvqRateSnapshot !== undefined) row.tax_tvq_rate_snapshot = item.taxTvqRateSnapshot
  if (item.taxTpsCents !== undefined) row.tax_tps_cents = item.taxTpsCents
  if (item.taxTvqCents !== undefined) row.tax_tvq_cents = item.taxTvqCents
  if (item.subtotalCents !== undefined) row.subtotal_cents = item.subtotalCents
  if (item.totalCents !== undefined) row.total_cents = item.totalCents
  if (item.displayOrder !== undefined) row.display_order = item.displayOrder
  if (item.description !== undefined) row.description = item.description

  return row
}

// =============================================================================
// PAYMENT MAPPER
// =============================================================================

export function mapPaymentFromDb(row: InvoicePaymentRow): InvoicePayment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amountCents: row.amount_cents,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method as PaymentMethod | null,
    referenceNumber: row.reference_number,
    qboPaymentId: row.qbo_payment_id,
    qboSyncedAt: row.qbo_synced_at,
    source: row.source as PaymentSource,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export function mapPaymentToDb(payment: Partial<InvoicePayment>): Partial<InvoicePaymentRow> {
  const row: Partial<InvoicePaymentRow> = {}

  if (payment.invoiceId !== undefined) row.invoice_id = payment.invoiceId
  if (payment.amountCents !== undefined) row.amount_cents = payment.amountCents
  if (payment.paymentDate !== undefined) row.payment_date = payment.paymentDate
  if (payment.paymentMethod !== undefined) row.payment_method = payment.paymentMethod
  if (payment.referenceNumber !== undefined) row.reference_number = payment.referenceNumber
  if (payment.source !== undefined) row.source = payment.source
  if (payment.notes !== undefined) row.notes = payment.notes

  return row
}

// =============================================================================
// PAYER ALLOCATION MAPPER
// =============================================================================

export function mapPayerAllocationFromDb(row: InvoicePayerAllocationRow): InvoicePayerAllocation {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    clientExternalPayerId: row.client_external_payer_id,
    payerType: row.payer_type as PayerAllocationType,
    amountCents: row.amount_cents,
    ivacRateAppliedCents: row.ivac_rate_applied_cents,
    paeRuleTypeApplied: row.pae_rule_type_applied,
    paePercentageApplied: row.pae_percentage_applied,
    status: row.status as PayerAllocationStatus,
    reportedAt: row.reported_at,
    paidAt: row.paid_at,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

export function mapPayerAllocationToDb(allocation: Partial<InvoicePayerAllocation>): Partial<InvoicePayerAllocationRow> {
  const row: Partial<InvoicePayerAllocationRow> = {}

  if (allocation.invoiceId !== undefined) row.invoice_id = allocation.invoiceId
  if (allocation.clientExternalPayerId !== undefined) row.client_external_payer_id = allocation.clientExternalPayerId
  if (allocation.payerType !== undefined) row.payer_type = allocation.payerType
  if (allocation.amountCents !== undefined) row.amount_cents = allocation.amountCents
  if (allocation.ivacRateAppliedCents !== undefined) row.ivac_rate_applied_cents = allocation.ivacRateAppliedCents
  if (allocation.paeRuleTypeApplied !== undefined) row.pae_rule_type_applied = allocation.paeRuleTypeApplied
  if (allocation.paePercentageApplied !== undefined) row.pae_percentage_applied = allocation.paePercentageApplied
  if (allocation.status !== undefined) row.status = allocation.status
  if (allocation.reportedAt !== undefined) row.reported_at = allocation.reportedAt
  if (allocation.paidAt !== undefined) row.paid_at = allocation.paidAt
  if (allocation.notes !== undefined) row.notes = allocation.notes

  return row
}

// =============================================================================
// AUDIT LOG MAPPER
// =============================================================================

export function mapAuditEntryFromDb(row: InvoiceAuditLogRow): InvoiceAuditEntry {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    actorId: row.actor_id,
    action: row.action as InvoiceAuditAction,
    oldValue: row.old_value,
    newValue: row.new_value,
    context: row.context,
    createdAt: row.created_at,
  }
}

// =============================================================================
// CLIENT MAPPER (from joined query)
// =============================================================================

export interface ClientJoinRow {
  id: string
  client_id: string
  first_name: string
  last_name: string
  email: string | null
  cell_phone: string | null
  street_number: string | null
  street_name: string | null
  apartment: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  balance_cents: number
}

export function mapInvoiceClientFromDb(row: ClientJoinRow): InvoiceClient {
  return {
    id: row.id,
    clientId: row.client_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    cellPhone: row.cell_phone,
    streetNumber: row.street_number,
    streetName: row.street_name,
    apartment: row.apartment,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    balanceCents: row.balance_cents,
  }
}

// =============================================================================
// PROFESSIONAL MAPPER (from joined query)
// =============================================================================

export interface ProfessionalJoinRow {
  id: string
  profiles: {
    display_name: string
  }
  professional_professions?: Array<{
    profession_title_key: string
    is_primary: boolean
  }>
}

export function mapInvoiceProfessionalFromDb(row: ProfessionalJoinRow): InvoiceProfessional {
  const primaryProfession = row.professional_professions?.find(p => p.is_primary)

  return {
    id: row.id,
    displayName: row.profiles.display_name,
    professionTitleKey: primaryProfession?.profession_title_key || null,
  }
}

// =============================================================================
// APPOINTMENT MAPPER (from joined query)
// =============================================================================

export interface AppointmentJoinRow {
  id: string
  start_time: string
  duration_minutes: number
  status: string
  service_id: string
  services: {
    name_fr: string
  }
  cancellation_fee_applied: boolean
  cancellation_fee_percent: number | null
}

export function mapInvoiceAppointmentFromDb(row: AppointmentJoinRow): InvoiceAppointment {
  return {
    id: row.id,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    status: row.status,
    serviceId: row.service_id,
    serviceName: row.services.name_fr,
    cancellationFeeApplied: row.cancellation_fee_applied,
    cancellationFeePercent: row.cancellation_fee_percent,
  }
}

// =============================================================================
// BATCH MAPPERS
// =============================================================================

export function mapInvoicesFromDb(rows: InvoiceRow[]): Invoice[] {
  return rows.map(mapInvoiceFromDb)
}

export function mapLineItemsFromDb(rows: InvoiceLineItemRow[]): InvoiceLineItem[] {
  return rows.map(mapLineItemFromDb)
}

export function mapPaymentsFromDb(rows: InvoicePaymentRow[]): InvoicePayment[] {
  return rows.map(mapPaymentFromDb)
}

export function mapPayerAllocationsFromDb(rows: InvoicePayerAllocationRow[]): InvoicePayerAllocation[] {
  return rows.map(mapPayerAllocationFromDb)
}

export function mapAuditEntriesFromDb(rows: InvoiceAuditLogRow[]): InvoiceAuditEntry[] {
  return rows.map(mapAuditEntryFromDb)
}
