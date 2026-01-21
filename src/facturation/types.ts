// src/facturation/types.ts
// TypeScript types for the facturation (billing) module

// =============================================================================
// INVOICE STATUS & ENUMS
// =============================================================================

export type InvoiceStatus = 'draft' | 'pending' | 'partial' | 'paid' | 'void'

export type LineItemType =
  | 'service'           // Standard service from catalog
  | 'cancellation_fee'  // Cancellation fee
  | 'file_opening_fee'  // Ouverture de dossier
  | 'adjustment'        // Manual adjustment
  | 'discount'          // Discount line

export type QuantityUnit = 'unit' | 'minute' | 'hour'

export type PaymentMethod =
  | 'cash'
  | 'debit'
  | 'credit'
  | 'etransfer'
  | 'cheque'
  | 'other'

export type PaymentSource = 'manual' | 'qbo_webhook' | 'qbo_sync'

export type DiscountType = 'percent' | 'fixed'

export type QboSyncStatus = 'pending' | 'synced' | 'error' | 'not_applicable'

export type PayerAllocationType = 'ivac' | 'pae'

export type PayerAllocationStatus = 'pending' | 'reported' | 'paid'

// =============================================================================
// INVOICE AUDIT ACTIONS
// =============================================================================

export type InvoiceAuditAction =
  | 'created'
  | 'line_added'
  | 'line_updated'
  | 'line_removed'
  | 'discount_applied'
  | 'finalized'
  | 'payment_recorded'
  | 'payment_removed'
  | 'synced_to_qbo'
  | 'sync_failed'
  | 'voided'
  | 'payer_allocated'
  | 'payer_reported'
  | 'payer_paid'
  | 'updated'

// =============================================================================
// INVOICE
// =============================================================================

export interface Invoice {
  id: string
  invoiceNumber: string
  appointmentId: string
  clientId: string
  professionalId: string

  invoiceDate: string  // ISO date string (YYYY-MM-DD)
  dueDate: string | null
  status: InvoiceStatus

  // Totals in cents
  subtotalCents: number
  discountCents: number
  taxTpsCents: number
  taxTvqCents: number
  totalCents: number
  amountPaidCents: number
  balanceCents: number
  externalPayerAmountCents: number

  // QuickBooks sync (Phase B)
  qboInvoiceId: string | null
  qboInvoiceNumber: string | null
  qboSyncStatus: QboSyncStatus
  qboSyncError: string | null
  qboSyncedAt: string | null

  // Notes
  notesInternal: string | null
  notesClient: string | null

  // Metadata
  createdBy: string | null
  createdAt: string
  updatedAt: string

  // Joined data (populated when fetching)
  lineItems?: InvoiceLineItem[]
  payments?: InvoicePayment[]
  payerAllocations?: InvoicePayerAllocation[]
  client?: InvoiceClient
  professional?: InvoiceProfessional
  appointment?: InvoiceAppointment
}

// Minimal client info for invoice display
export interface InvoiceClient {
  id: string
  clientId: string         // Human-readable: CLI-0000001
  firstName: string
  lastName: string
  email: string | null
  cellPhone: string | null
  streetNumber: string | null
  streetName: string | null
  apartment: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  balanceCents: number
}

// Minimal professional info for invoice display
export interface InvoiceProfessional {
  id: string
  displayName: string
  professionTitleKey: string | null
}

// Minimal appointment info for invoice display
export interface InvoiceAppointment {
  id: string
  startTime: string
  durationMinutes: number
  status: string
  serviceId: string
  serviceName: string
  cancellationFeeApplied: boolean
  cancellationFeePercent: number | null
}

// =============================================================================
// INVOICE LINE ITEM
// =============================================================================

export interface InvoiceLineItem {
  id: string
  invoiceId: string
  lineType: LineItemType

  // Service reference (snapshot)
  serviceId: string | null
  serviceNameSnapshot: string
  serviceKeySnapshot: string | null

  // Quantity
  quantityUnit: QuantityUnit
  quantity: number
  billableMinutes: number | null

  // Pricing (snapshot)
  unitPriceCents: number
  professionCategoryKeySnapshot: string | null

  // Discount
  discountType: DiscountType | null
  discountValue: number | null
  discountCents: number

  // Tax (snapshot)
  isTaxable: boolean
  taxTpsRateSnapshot: number | null   // 0.05 for 5%
  taxTvqRateSnapshot: number | null   // 0.09975 for 9.975%
  taxTpsCents: number
  taxTvqCents: number

  // Totals
  subtotalCents: number
  totalCents: number

  // Display
  displayOrder: number
  description: string | null

  createdAt: string
  updatedAt: string
}

// =============================================================================
// INVOICE PAYMENT
// =============================================================================

export interface InvoicePayment {
  id: string
  invoiceId: string
  amountCents: number
  paymentDate: string          // ISO date string (YYYY-MM-DD)
  paymentMethod: PaymentMethod | null
  referenceNumber: string | null

  // QuickBooks sync (Phase B)
  qboPaymentId: string | null
  qboSyncedAt: string | null

  source: PaymentSource
  notes: string | null

  createdBy: string | null
  createdAt: string
}

// =============================================================================
// INVOICE PAYER ALLOCATION
// =============================================================================

export interface InvoicePayerAllocation {
  id: string
  invoiceId: string
  clientExternalPayerId: string
  payerType: PayerAllocationType
  amountCents: number

  // IVAC specific
  ivacRateAppliedCents: number | null

  // PAE specific
  paeRuleTypeApplied: string | null
  paePercentageApplied: number | null

  status: PayerAllocationStatus
  reportedAt: string | null
  paidAt: string | null
  notes: string | null

  createdAt: string

  // Joined data
  payerDetails?: {
    type: 'ivac' | 'pae'
    fileNumber: string
    providerName?: string  // PAE only
  }
}

// =============================================================================
// INVOICE AUDIT LOG
// =============================================================================

export interface InvoiceAuditEntry {
  id: string
  invoiceId: string
  actorId: string | null
  action: InvoiceAuditAction
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  context: Record<string, unknown> | null
  createdAt: string

  // Joined data
  actorName?: string
}

// =============================================================================
// INPUT TYPES (for API calls)
// =============================================================================

export interface CreateInvoiceInput {
  appointmentId: string
  clientId: string    // Which client to bill (for multi-client appointments)
  notesClient?: string
  notesInternal?: string
}

export interface AddLineItemInput {
  invoiceId: string
  lineType: LineItemType
  serviceId?: string
  serviceName: string
  serviceKey?: string
  quantityUnit?: QuantityUnit
  quantity?: number
  billableMinutes?: number
  unitPriceCents: number
  professionCategoryKey?: string
  discountType?: DiscountType
  discountValue?: number
  isTaxable: boolean
  description?: string
  displayOrder?: number
}

export interface UpdateLineItemInput {
  id: string
  quantity?: number
  billableMinutes?: number
  unitPriceCents?: number
  discountType?: DiscountType | null
  discountValue?: number | null
  description?: string
}

export interface RecordPaymentInput {
  invoiceId: string
  amountCents: number
  paymentDate?: string  // Defaults to today
  paymentMethod?: PaymentMethod
  referenceNumber?: string
  notes?: string
}

export interface AllocatePayerInput {
  invoiceId: string
  clientExternalPayerId: string
  payerType: PayerAllocationType
  amountCents: number
  ivacRateAppliedCents?: number
  paeRuleTypeApplied?: string
  paePercentageApplied?: number
  notes?: string
}

// =============================================================================
// NEW CLIENT DETECTION
// =============================================================================

export interface NewClientStatus {
  isNew: boolean                           // True if client has no invoice history
  hasRelationWithHistory: boolean          // True if related client has history
  suggestedTag: 'new_client' | 'existing_relation' | null
  shouldAddFileOpeningFee: boolean         // True if ouverture de dossier should be added
}

// =============================================================================
// PRICING CALCULATION TYPES
// =============================================================================

export interface CalculatedPrice {
  unitPriceCents: number
  quantityUnit: QuantityUnit
  quantity: number
  subtotalCents: number
  isTaxable: boolean
  taxTpsCents: number
  taxTvqCents: number
  totalCents: number
}

export interface LineItemCalculation {
  subtotalCents: number     // quantity * unitPrice
  discountCents: number     // calculated discount
  afterDiscountCents: number // subtotal - discount
  taxTpsCents: number
  taxTvqCents: number
  totalCents: number
}

// =============================================================================
// FILTER & QUERY TYPES
// =============================================================================

export interface InvoiceFilters {
  clientId?: string
  professionalId?: string
  status?: InvoiceStatus | InvoiceStatus[]
  dateFrom?: string
  dateTo?: string
  hasBalance?: boolean      // Only invoices with balance > 0
}

export interface PayerAllocationFilters {
  payerType?: PayerAllocationType
  status?: PayerAllocationStatus
  dateFrom?: string
  dateTo?: string
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

export type InvoiceTab = 'details' | 'payments' | 'audit'

export interface InvoiceFormState {
  isCreating: boolean
  isSaving: boolean
  isRecordingPayment: boolean
  error: string | null
}
