// src/facturation/components/invoice-detail-view.tsx
// Full invoice detail view component

import { useState } from 'react'
import {
  FileText,
  Calendar,
  User,
  Clock,
  Printer,
  Plus,
  Trash2,
  AlertCircle,
  Check,
  X,
} from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { cn } from '@/shared/lib/utils'
import { formatClinicDateShort, formatClinicTime } from '@/shared/lib/timezone'
import { formatCentsCurrency } from '../utils/pricing'
import { useInvoice, useVoidInvoice, useUpdateInvoiceStatus, useRemoveLineItem, useRemovePayment } from '../hooks'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  LINE_ITEM_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYER_ALLOCATION_STATUS_LABELS,
} from '../constants'
import type { Invoice, InvoiceLineItem, InvoicePayment, InvoicePayerAllocation } from '../types'

interface InvoiceDetailViewProps {
  invoiceId: string
  onAddLineItem?: () => void
  onRecordPayment?: () => void
  onPrint?: () => void
  onClose?: () => void
}

export function InvoiceDetailView({
  invoiceId,
  onAddLineItem,
  onRecordPayment,
  onPrint,
  onClose,
}: InvoiceDetailViewProps) {
  const { data: invoice, isLoading, error } = useInvoice(invoiceId)
  const voidInvoice = useVoidInvoice()
  const updateStatus = useUpdateInvoiceStatus()
  const removeLineItem = useRemoveLineItem()
  const removePayment = useRemovePayment()

  const [confirmVoid, setConfirmVoid] = useState(false)
  const [isFinalizingInvoice, setIsFinalizingInvoice] = useState(false)

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse">
        <div className="h-8 bg-muted rounded w-1/3 mb-4" />
        <div className="h-64 bg-muted rounded" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <p className="text-foreground-muted">
          Erreur lors du chargement de la facture
        </p>
      </div>
    )
  }

  const handleVoid = async () => {
    await voidInvoice.mutateAsync({ id: invoiceId })
    setConfirmVoid(false)
  }

  const handleFinalize = async () => {
    setIsFinalizingInvoice(true)
    try {
      await updateStatus.mutateAsync({ id: invoiceId, status: 'pending' })
    } finally {
      setIsFinalizingInvoice(false)
    }
  }

  const handleRemoveLineItem = async (lineItemId: string) => {
    await removeLineItem.mutateAsync({ lineItemId, invoiceId })
  }

  const handleRemovePayment = async (paymentId: string) => {
    await removePayment.mutateAsync({ paymentId, invoiceId })
  }

  const canEdit = !['paid', 'void'].includes(invoice.status)
  const showQboWarning = invoice.qboSyncStatus === 'synced'
  const canVoid = invoice.status !== 'void'
  const canPay = invoice.status !== 'void' && invoice.status !== 'paid' && invoice.balanceCents > 0

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-foreground-muted" />
            <h2 className="text-xl font-semibold">{invoice.invoiceNumber}</h2>
            <Badge className={cn('text-xs', INVOICE_STATUS_COLORS[invoice.status])}>
              {INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
          </div>
          <p className="text-sm text-foreground-muted mt-1">
            {formatClinicDateShort(invoice.invoiceDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onPrint && (
            <Button variant="outline" size="sm" onClick={onPrint}>
              <Printer className="h-4 w-4 mr-2" />
              Imprimer
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* QuickBooks sync warning */}
      {showQboWarning && canEdit && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
          <div className="text-sm font-medium text-amber-800">
            ⚠️ Facture synchronisée avec QuickBooks
          </div>
          <div className="text-xs text-amber-700">
            Les modifications ici ne seront pas automatiquement reflétées dans QuickBooks.
          </div>
        </div>
      )}

      {/* Client & Appointment Info */}
      <div className="grid grid-cols-2 gap-4">
        {invoice.client && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <User className="h-4 w-4 text-foreground-muted" />
                Client
              </div>
              <div className="text-sm">
                {invoice.client.firstName} {invoice.client.lastName}
              </div>
              {invoice.client.email && (
                <div className="text-xs text-foreground-muted">{invoice.client.email}</div>
              )}
            </CardContent>
          </Card>
        )}
        {invoice.appointment && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Calendar className="h-4 w-4 text-foreground-muted" />
                Rendez-vous
              </div>
              <div className="text-sm">
                {formatClinicDateShort(invoice.appointment.startTime)}
              </div>
              <div className="text-xs text-foreground-muted flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatClinicTime(invoice.appointment.startTime)} · {invoice.appointment.durationMinutes} min
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Articles</CardTitle>
            {canEdit && onAddLineItem && (
              <Button variant="outline" size="sm" onClick={onAddLineItem}>
                <Plus className="h-4 w-4 mr-1" />
                Ajouter
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <LineItemsTable
            lineItems={invoice.lineItems || []}
            canEdit={canEdit}
            onRemove={handleRemoveLineItem}
          />
        </CardContent>
      </Card>

      {/* Totals */}
      <TotalsCard invoice={invoice} />

      {/* Payer Allocations */}
      {invoice.payerAllocations && invoice.payerAllocations.length > 0 && (
        <PayerAllocationsCard allocations={invoice.payerAllocations} />
      )}

      {/* Payments */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Paiements</CardTitle>
            {canPay && onRecordPayment && (
              <Button variant="outline" size="sm" onClick={onRecordPayment}>
                <Plus className="h-4 w-4 mr-1" />
                Paiement
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <PaymentsTable
            payments={invoice.payments || []}
            canEdit={canEdit}
            onRemove={handleRemovePayment}
          />
        </CardContent>
      </Card>

      {/* Notes */}
      {(invoice.notesClient || invoice.notesInternal) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invoice.notesClient && (
              <div>
                <div className="text-xs font-medium text-foreground-muted mb-1">Note client</div>
                <p className="text-sm">{invoice.notesClient}</p>
              </div>
            )}
            {invoice.notesInternal && (
              <div>
                <div className="text-xs font-medium text-foreground-muted mb-1">Note interne</div>
                <p className="text-sm text-foreground-muted">{invoice.notesInternal}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div>
          {canVoid && !confirmVoid && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirmVoid(true)}
            >
              Annuler la facture
            </Button>
          )}
          {confirmVoid && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-muted">Confirmer l'annulation ?</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleVoid}
                disabled={voidInvoice.isPending}
              >
                <Check className="h-4 w-4 mr-1" />
                Oui
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmVoid(false)}
              >
                Non
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === 'draft' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleFinalize}
              disabled={isFinalizingInvoice}
            >
              {isFinalizingInvoice ? 'Finalisation...' : 'Finaliser'}
            </Button>
          )}
          {canPay && onRecordPayment && (
            <Button size="sm" onClick={onRecordPayment}>
              Enregistrer un paiement
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface LineItemsTableProps {
  lineItems: InvoiceLineItem[]
  canEdit: boolean
  onRemove: (id: string) => void
}

function LineItemsTable({ lineItems, canEdit, onRemove }: LineItemsTableProps) {
  if (lineItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-foreground-muted">
        Aucun article
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs">
          <tr>
            <th className="text-left p-3">Description</th>
            <th className="text-right p-3">Qté</th>
            <th className="text-right p-3">Prix unit.</th>
            <th className="text-right p-3">Rabais</th>
            <th className="text-right p-3">Total</th>
            {canEdit && <th className="w-10 p-3"></th>}
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="p-3">
                <div className="font-medium">{item.serviceNameSnapshot}</div>
                <div className="text-xs text-foreground-muted">
                  {LINE_ITEM_TYPE_LABELS[item.lineType]}
                  {item.isTaxable && ' · Taxable'}
                </div>
              </td>
              <td className="text-right p-3">
                {item.quantityUnit === 'minute'
                  ? `${item.quantity} min`
                  : item.quantity}
              </td>
              <td className="text-right p-3">
                {formatCentsCurrency(item.unitPriceCents)}
              </td>
              <td className="text-right p-3">
                {item.discountCents > 0
                  ? `-${formatCentsCurrency(item.discountCents)}`
                  : '-'}
              </td>
              <td className="text-right p-3 font-medium">
                {formatCentsCurrency(item.totalCents)}
              </td>
              {canEdit && (
                <td className="p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => onRemove(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface TotalsCardProps {
  invoice: Invoice
}

function TotalsCard({ invoice }: TotalsCardProps) {
  return (
    <Card className="bg-muted/30">
      <CardContent className="p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Sous-total</span>
          <span>{formatCentsCurrency(invoice.subtotalCents)}</span>
        </div>
        {invoice.discountCents > 0 && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>Rabais</span>
            <span>-{formatCentsCurrency(invoice.discountCents)}</span>
          </div>
        )}
        {invoice.taxTpsCents > 0 && (
          <div className="flex justify-between text-sm text-foreground-muted">
            <span>TPS (5%)</span>
            <span>{formatCentsCurrency(invoice.taxTpsCents)}</span>
          </div>
        )}
        {invoice.taxTvqCents > 0 && (
          <div className="flex justify-between text-sm text-foreground-muted">
            <span>TVQ (9,975%)</span>
            <span>{formatCentsCurrency(invoice.taxTvqCents)}</span>
          </div>
        )}
        <div className="flex justify-between font-medium pt-2 border-t">
          <span>Total</span>
          <span>{formatCentsCurrency(invoice.totalCents)}</span>
        </div>
        {invoice.externalPayerAmountCents > 0 && (
          <div className="flex justify-between text-sm text-sky-600">
            <span>Couvert par tiers payeur</span>
            <span>-{formatCentsCurrency(invoice.externalPayerAmountCents)}</span>
          </div>
        )}
        {invoice.amountPaidCents > 0 && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>Payé</span>
            <span>-{formatCentsCurrency(invoice.amountPaidCents)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-lg pt-2 border-t">
          <span>Solde</span>
          <span className={invoice.balanceCents > 0 ? 'text-amber-600' : 'text-emerald-600'}>
            {formatCentsCurrency(invoice.balanceCents)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

interface PayerAllocationsCardProps {
  allocations: InvoicePayerAllocation[]
}

function PayerAllocationsCard({ allocations }: PayerAllocationsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Tiers payeurs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allocations.map((allocation) => (
          <div
            key={allocation.id}
            className="flex items-center justify-between p-3 rounded bg-muted/50"
          >
            <div>
              <div className="font-medium text-sm">
                {allocation.payerType === 'ivac' ? 'IVAC' : 'PAE'}
              </div>
              <div className="text-xs text-foreground-muted">
                {PAYER_ALLOCATION_STATUS_LABELS[allocation.status]}
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium">
                {formatCentsCurrency(allocation.amountCents)}
              </div>
              {allocation.ivacRateAppliedCents && (
                <div className="text-xs text-foreground-muted">
                  Taux: {formatCentsCurrency(allocation.ivacRateAppliedCents)}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

interface PaymentsTableProps {
  payments: InvoicePayment[]
  canEdit: boolean
  onRemove: (id: string) => void
}

function PaymentsTable({ payments, canEdit, onRemove }: PaymentsTableProps) {
  if (payments.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-foreground-muted">
        Aucun paiement
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs">
          <tr>
            <th className="text-left p-3">Date</th>
            <th className="text-left p-3">Méthode</th>
            <th className="text-left p-3">Référence</th>
            <th className="text-right p-3">Montant</th>
            {canEdit && <th className="w-10 p-3"></th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-t">
              <td className="p-3">
                {formatClinicDateShort(payment.paymentDate)}
              </td>
              <td className="p-3">
                {payment.paymentMethod
                  ? PAYMENT_METHOD_LABELS[payment.paymentMethod]
                  : '-'}
              </td>
              <td className="p-3 text-foreground-muted">
                {payment.referenceNumber || '-'}
              </td>
              <td className="text-right p-3 font-medium text-emerald-600">
                {formatCentsCurrency(payment.amountCents)}
              </td>
              {canEdit && (
                <td className="p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => onRemove(payment.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
