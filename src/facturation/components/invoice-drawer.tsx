// src/facturation/components/invoice-drawer.tsx
// Dialog component for viewing and managing invoice details

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog'
import { InvoiceDetailView } from './invoice-detail-view'
import { PaymentForm } from './payment-form'
import { AddLineItemForm } from './add-line-item-form'
import { useInvoice } from '../hooks'

interface InvoiceDrawerProps {
  invoiceId: string | null
  open: boolean
  onClose: () => void
}

type ViewMode = 'detail' | 'payment' | 'add-item'

export function InvoiceDrawer({ invoiceId, open, onClose }: InvoiceDrawerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const { data: invoice } = useInvoice(invoiceId || '')

  if (!invoiceId) return null

  // Get profession category key from line items (for price lookup when adding items)
  const professionCategoryKey = invoice?.lineItems?.[0]?.professionCategoryKeySnapshot || undefined

  const handleClose = () => {
    setViewMode('detail')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>
            {invoice?.invoiceNumber || 'Facture'}
          </DialogTitle>
          <DialogDescription>
            Détails de la facture et options de paiement
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {viewMode === 'payment' && invoice ? (
            <div className="p-6">
              <h3 className="text-lg font-medium mb-4">Enregistrer un paiement</h3>
              <PaymentForm
                invoiceId={invoiceId}
                balanceCents={invoice.balanceCents}
                onSuccess={() => setViewMode('detail')}
                onCancel={() => setViewMode('detail')}
              />
            </div>
          ) : viewMode === 'add-item' ? (
            <div className="p-6">
              <h3 className="text-lg font-medium mb-4">Ajouter un article</h3>
              <AddLineItemForm
                invoiceId={invoiceId}
                professionCategoryKey={professionCategoryKey}
                onSuccess={() => setViewMode('detail')}
                onCancel={() => setViewMode('detail')}
              />
            </div>
          ) : (
            <InvoiceDetailView
              invoiceId={invoiceId}
              onAddLineItem={() => setViewMode('add-item')}
              onRecordPayment={() => setViewMode('payment')}
              onPrint={() => {
                window.print()
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
