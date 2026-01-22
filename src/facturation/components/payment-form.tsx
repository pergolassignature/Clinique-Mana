// src/facturation/components/payment-form.tsx
// Form for recording invoice payments

import { useState } from 'react'
import { DollarSign, Calendar, CreditCard, Hash } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { Label } from '@/shared/ui/label'
import { useRecordPayment } from '../hooks'
import { formatCentsCurrency, parseCurrencyToCents } from '../utils/pricing'
import { PAYMENT_METHOD_LABELS } from '../constants'
import type { PaymentMethod } from '../types'

interface PaymentFormProps {
  invoiceId: string
  balanceCents: number
  onSuccess?: () => void
  onCancel?: () => void
}

export function PaymentForm({
  invoiceId,
  balanceCents,
  onSuccess,
  onCancel,
}: PaymentFormProps) {
  const [amount, setAmount] = useState(formatCentsToInput(balanceCents))
  const [paymentDate, setPaymentDate] = useState(getTodayString())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recordPayment = useRecordPayment()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const amountCents = parseCurrencyToCents(amount)

    if (amountCents <= 0) {
      setError('Le montant doit être supérieur à 0')
      return
    }

    if (amountCents > balanceCents) {
      setError(`Le montant ne peut pas dépasser le solde (${formatCentsCurrency(balanceCents)})`)
      return
    }

    try {
      await recordPayment.mutateAsync({
        invoiceId,
        amountCents,
        paymentDate,
        paymentMethod: paymentMethod || undefined,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
      })
      onSuccess?.()
    } catch (err) {
      setError('Erreur lors de l\'enregistrement du paiement')
      console.error(err)
    }
  }

  const handlePayFull = () => {
    setAmount(formatCentsToInput(balanceCents))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-6">
        <p className="text-sm text-foreground-muted">Solde restant</p>
        <p className="text-2xl font-semibold text-amber-600">
          {formatCentsCurrency(balanceCents)}
        </p>
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <Label htmlFor="amount">Montant</Label>
        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
          <Input
            id="amount"
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="pl-9"
            required
          />
        </div>
        {balanceCents > 0 && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0 h-auto text-xs"
            onClick={handlePayFull}
          >
            Payer le solde complet
          </Button>
        )}
      </div>

      {/* Payment Date */}
      <div className="space-y-2">
        <Label htmlFor="paymentDate">Date du paiement</Label>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
          <Input
            id="paymentDate"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="pl-9"
            required
          />
        </div>
      </div>

      {/* Payment Method */}
      <div className="space-y-2">
        <Label htmlFor="paymentMethod">Mode de paiement</Label>
        <div className="relative">
          <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted pointer-events-none z-10" />
          <Select
            id="paymentMethod"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
            className="pl-9"
          >
            <option value="">Sélectionner...</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Reference Number */}
      <div className="space-y-2">
        <Label htmlFor="referenceNumber">Numéro de référence (optionnel)</Label>
        <div className="relative">
          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
          <Input
            id="referenceNumber"
            type="text"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="Ex: 12345"
            className="pl-9"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optionnel)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes internes..."
          rows={2}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={recordPayment.isPending}>
          {recordPayment.isPending ? 'Enregistrement...' : 'Enregistrer le paiement'}
        </Button>
      </div>
    </form>
  )
}

// =============================================================================
// HELPERS
// =============================================================================

function getTodayString(): string {
  const today = new Date()
  const iso = today.toISOString()
  return iso.split('T')[0] ?? iso.slice(0, 10)
}

function formatCentsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}
