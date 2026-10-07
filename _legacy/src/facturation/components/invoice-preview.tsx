// src/facturation/components/invoice-preview.tsx
// Invoice preview component - shows editable line items before invoice creation

import { useState, useMemo } from 'react'
import { Pencil, Trash2, X, Check } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/lib/utils'
import { formatCentsCurrency } from '../utils/pricing'
import { TPS_RATE, TVQ_RATE } from '../constants'
import type { LineItemType, QuantityUnit } from '../types'

// =============================================================================
// TYPES
// =============================================================================

export interface PreviewLineItem {
  id: string  // Temporary ID for UI
  lineType: LineItemType
  serviceId: string | null
  serviceName: string
  serviceKey: string | null
  quantityUnit: QuantityUnit
  quantity: number
  billableMinutes: number | null
  unitPriceCents: number
  isTaxable: boolean
  displayOrder: number
  description: string | null
}

interface InvoicePreviewProps {
  /** Default line items based on appointment */
  defaultLineItems: PreviewLineItem[]
  /** Callback when user confirms and creates invoice */
  onConfirm: (lineItems: PreviewLineItem[], options: { addFileOpeningFee: boolean }) => void
  /** Callback when user cancels */
  onCancel: () => void
  /** Whether file opening fee should be suggested */
  suggestFileOpeningFee: boolean
  /** File opening fee price in cents */
  fileOpeningFeeCents?: number
  /** Whether we're currently creating */
  isCreating: boolean
  /** Appointment status */
  appointmentStatus?: string
  /** Cancellation fee applied */
  cancellationFeeApplied?: boolean
  /** Cancellation fee percent */
  cancellationFeePercent?: number
}

// =============================================================================
// COMPONENT
// =============================================================================

export function InvoicePreview({
  defaultLineItems,
  onConfirm,
  onCancel,
  suggestFileOpeningFee,
  fileOpeningFeeCents = 3500,
  isCreating,
  appointmentStatus,
  cancellationFeeApplied,
  cancellationFeePercent,
}: InvoicePreviewProps) {
  const [lineItems, setLineItems] = useState<PreviewLineItem[]>(defaultLineItems)
  const [addFileOpeningFee, setAddFileOpeningFee] = useState(suggestFileOpeningFee)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ quantity: number; unitPriceCents: number }>({
    quantity: 1,
    unitPriceCents: 0,
  })

  // Calculate totals
  const totals = useMemo(() => {
    let subtotalCents = 0
    let taxTpsCents = 0
    let taxTvqCents = 0

    for (const item of lineItems) {
      const itemSubtotal = item.quantity * item.unitPriceCents
      subtotalCents += itemSubtotal

      if (item.isTaxable) {
        taxTpsCents += Math.round(itemSubtotal * TPS_RATE)
        taxTvqCents += Math.round(itemSubtotal * TVQ_RATE)
      }
    }

    // Add file opening fee if selected
    if (addFileOpeningFee) {
      subtotalCents += fileOpeningFeeCents
      // File opening fee is typically not taxable, but check your business rules
    }

    const totalCents = subtotalCents + taxTpsCents + taxTvqCents

    return { subtotalCents, taxTpsCents, taxTvqCents, totalCents }
  }, [lineItems, addFileOpeningFee, fileOpeningFeeCents])

  const handleStartEdit = (item: PreviewLineItem) => {
    setEditingItemId(item.id)
    setEditValues({
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })
  }

  const handleSaveEdit = (itemId: string) => {
    setLineItems(items =>
      items.map(item =>
        item.id === itemId
          ? { ...item, quantity: editValues.quantity, unitPriceCents: editValues.unitPriceCents }
          : item
      )
    )
    setEditingItemId(null)
  }

  const handleCancelEdit = () => {
    setEditingItemId(null)
  }

  const handleRemoveItem = (itemId: string) => {
    setLineItems(items => items.filter(item => item.id !== itemId))
  }

  const handleConfirm = () => {
    onConfirm(lineItems, { addFileOpeningFee })
  }

  const isCancelled = appointmentStatus === 'cancelled'

  return (
    <div className="space-y-4">
      {/* Header with cancellation info */}
      {isCancelled && (
        <div className="p-3 rounded-lg bg-wine-50 border border-wine-200">
          <div className="text-sm font-medium text-wine-700">Rendez-vous annulé</div>
          <div className="text-xs text-wine-600 mt-1">
            {cancellationFeeApplied
              ? `Frais d'annulation : ${cancellationFeePercent}% du service`
              : 'Aucun frais d\'annulation'}
          </div>
        </div>
      )}

      {/* Line items */}
      <Card className="bg-background border-border">
        <CardContent className="p-0">
          {/* Header */}
          <div className="grid grid-cols-[1fr,80px,100px,80px,40px] gap-2 p-3 border-b border-border bg-background-secondary text-xs font-medium text-foreground-muted">
            <div>Description</div>
            <div className="text-right">Qté</div>
            <div className="text-right">Prix unit.</div>
            <div className="text-right">Total</div>
            <div></div>
          </div>

          {/* Line items */}
          {lineItems.length > 0 ? (
            lineItems.map(item => {
              const isEditing = editingItemId === item.id
              const itemTotal = item.quantity * item.unitPriceCents

              return (
                <div
                  key={item.id}
                  className={cn(
                    'grid grid-cols-[1fr,80px,100px,80px,40px] gap-2 p-3 border-b border-border items-center',
                    isEditing && 'bg-sage-50'
                  )}
                >
                  {/* Description */}
                  <div>
                    <div className="text-sm font-medium">{item.serviceName}</div>
                    {item.billableMinutes && (
                      <div className="text-xs text-foreground-muted">
                        {item.billableMinutes} minutes
                      </div>
                    )}
                    {item.lineType === 'cancellation_fee' && (
                      <div className="text-xs text-wine-600">Frais d'annulation</div>
                    )}
                  </div>

                  {/* Quantity */}
                  <div className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        min={1}
                        value={editValues.quantity}
                        onChange={(e) => setEditValues(v => ({ ...v, quantity: Number(e.target.value) }))}
                        className="h-7 text-xs text-right w-16"
                      />
                    ) : (
                      <span className="text-sm">{item.quantity}</span>
                    )}
                  </div>

                  {/* Unit price */}
                  <div className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={editValues.unitPriceCents}
                        onChange={(e) => setEditValues(v => ({ ...v, unitPriceCents: Number(e.target.value) }))}
                        className="h-7 text-xs text-right w-20"
                      />
                    ) : (
                      <span className="text-sm">{formatCentsCurrency(item.unitPriceCents)}</span>
                    )}
                  </div>

                  {/* Total */}
                  <div className="text-right">
                    <span className="text-sm font-medium">
                      {formatCentsCurrency(isEditing ? editValues.quantity * editValues.unitPriceCents : itemTotal)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-1">
                    {isEditing ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleSaveEdit(item.id)}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={handleCancelEdit}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleStartEdit(item)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-wine-600 hover:text-wine-700"
                          onClick={() => handleRemoveItem(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="p-4 text-center text-sm text-foreground-muted">
              Aucun élément à facturer
            </div>
          )}

          {/* File opening fee option */}
          {suggestFileOpeningFee && (
            <div className="p-3 border-b border-border bg-amber-50/50">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addFileOpeningFee}
                  onChange={(e) => setAddFileOpeningFee(e.target.checked)}
                  className="rounded border-amber-400"
                />
                <span className="text-sm">
                  Ajouter frais d'ouverture de dossier
                </span>
              </label>
              <div className="text-xs text-amber-700 mt-1 ml-5">
                Nouveau client sans historique
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Totals */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-foreground-muted">Sous-total</span>
          <span>{formatCentsCurrency(totals.subtotalCents)}</span>
        </div>
        {totals.taxTpsCents > 0 && (
          <div className="flex justify-between">
            <span className="text-foreground-muted">TPS (5%)</span>
            <span>{formatCentsCurrency(totals.taxTpsCents)}</span>
          </div>
        )}
        {totals.taxTvqCents > 0 && (
          <div className="flex justify-between">
            <span className="text-foreground-muted">TVQ (9,975%)</span>
            <span>{formatCentsCurrency(totals.taxTvqCents)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-base border-t border-border pt-2">
          <span>Total</span>
          <span>{formatCentsCurrency(totals.totalCents)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isCreating}
          className="flex-1"
        >
          Annuler
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={isCreating || lineItems.length === 0}
          className="flex-1"
        >
          {isCreating ? 'Création...' : 'Créer la facture'}
        </Button>
      </div>
    </div>
  )
}
