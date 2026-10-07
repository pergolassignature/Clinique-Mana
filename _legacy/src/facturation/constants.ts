// src/facturation/constants.ts
// Constants and label mappings for the facturation module

import type {
  InvoiceStatus,
  LineItemType,
  PaymentMethod,
  QuantityUnit,
  PayerAllocationStatus,
  InvoiceAuditAction,
} from './types'

// =============================================================================
// INVOICE STATUS
// =============================================================================

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Brouillon',
  pending: 'En attente',
  partial: 'Partiellement payé',
  paid: 'Payé',
  void: 'Annulé',
}

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-stone-100 text-stone-700',
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-sky-100 text-sky-700',
  paid: 'bg-emerald-100 text-emerald-700',
  void: 'bg-red-100 text-red-700',
}

// =============================================================================
// LINE ITEM TYPE
// =============================================================================

export const LINE_ITEM_TYPE_LABELS: Record<LineItemType, string> = {
  service: 'Service',
  cancellation_fee: 'Frais d\'annulation',
  file_opening_fee: 'Ouverture de dossier',
  adjustment: 'Ajustement',
  discount: 'Rabais',
}

// =============================================================================
// PAYMENT METHOD
// =============================================================================

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Comptant',
  debit: 'Débit',
  credit: 'Crédit',
  etransfer: 'Virement Interac',
  cheque: 'Chèque',
  other: 'Autre',
}

export const PAYMENT_METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS).map(
  ([value, label]) => ({ value: value as PaymentMethod, label })
)

// =============================================================================
// QUANTITY UNIT
// =============================================================================

export const QUANTITY_UNIT_LABELS: Record<QuantityUnit, string> = {
  unit: 'unité',
  minute: 'minute',
  hour: 'heure',
}

export const QUANTITY_UNIT_LABELS_PLURAL: Record<QuantityUnit, string> = {
  unit: 'unités',
  minute: 'minutes',
  hour: 'heures',
}

// =============================================================================
// PAYER ALLOCATION STATUS
// =============================================================================

export const PAYER_ALLOCATION_STATUS_LABELS: Record<PayerAllocationStatus, string> = {
  pending: 'En attente',
  reported: 'Déclaré',
  paid: 'Payé',
}

export const PAYER_ALLOCATION_STATUS_COLORS: Record<PayerAllocationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  reported: 'bg-sky-100 text-sky-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

// =============================================================================
// AUDIT ACTIONS
// =============================================================================

export const AUDIT_ACTION_LABELS: Record<InvoiceAuditAction, string> = {
  created: 'Facture créée',
  line_added: 'Ligne ajoutée',
  line_updated: 'Ligne modifiée',
  line_removed: 'Ligne supprimée',
  discount_applied: 'Rabais appliqué',
  finalized: 'Facture finalisée',
  payment_recorded: 'Paiement enregistré',
  payment_removed: 'Paiement supprimé',
  synced_to_qbo: 'Synchronisé avec QuickBooks',
  sync_failed: 'Échec de synchronisation',
  voided: 'Facture annulée',
  payer_allocated: 'Payeur externe assigné',
  payer_removed: 'Payeur externe retiré',
  payer_reported: 'Payeur déclaré',
  payer_paid: 'Paiement payeur reçu',
  updated: 'Facture modifiée',
}

// =============================================================================
// FILE OPENING FEE
// =============================================================================

/** Service key for file opening fee */
export const FILE_OPENING_SERVICE_KEY = 'ouverture_dossier'

/** Default file opening fee in cents ($35.00) - actual price comes from service_prices */
export const DEFAULT_FILE_OPENING_FEE_CENTS = 3500

// =============================================================================
// TAX CONSTANTS (from src/utils/tax.ts)
// =============================================================================

export const TPS_RATE = 0.05
export const TVQ_RATE = 0.09975
export const COMBINED_TAX_RATE = TPS_RATE + TVQ_RATE

// =============================================================================
// DEFAULT VALUES
// =============================================================================

/** Default due date offset in days (30 days after invoice date) */
export const DEFAULT_DUE_DATE_OFFSET_DAYS = 30

/** Maximum discount percentage allowed */
export const MAX_DISCOUNT_PERCENT = 100

// =============================================================================
// DISPLAY FORMATTING
// =============================================================================

/**
 * Format a line item quantity with appropriate unit.
 */
export function formatQuantityWithUnit(
  quantity: number,
  unit: QuantityUnit
): string {
  const unitLabel = quantity === 1
    ? QUANTITY_UNIT_LABELS[unit]
    : QUANTITY_UNIT_LABELS_PLURAL[unit]
  return `${quantity} ${unitLabel}`
}
