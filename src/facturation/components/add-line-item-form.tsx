// src/facturation/components/add-line-item-form.tsx
// Form for adding a line item to an existing invoice

import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { useAddLineItem } from '../hooks'
import { useActiveServices, useServicePrices, useProfessionCategories } from '@/services-catalog/hooks'
import { formatCentsCurrency, parseCurrencyToCents } from '../utils/pricing'
import { TPS_RATE, TVQ_RATE } from '../constants'

interface AddLineItemFormProps {
  invoiceId: string
  /** Profession category key from the invoice/appointment for price lookup */
  professionCategoryKey?: string
  onSuccess: () => void
  onCancel: () => void
}

export function AddLineItemForm({
  invoiceId,
  professionCategoryKey,
  onSuccess,
  onCancel,
}: AddLineItemFormProps) {
  const addLineItem = useAddLineItem()
  const { data: services = [] } = useActiveServices()
  const { data: servicePrices = [] } = useServicePrices()
  const { data: professionCategories = [] } = useProfessionCategories()

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unitPriceInput, setUnitPriceInput] = useState('')

  // Selected service details
  const selectedService = services.find(s => s.id === selectedServiceId)

  // Determine taxability
  const isTaxable = useMemo(() => {
    if (!selectedService) return false
    // Service override takes priority
    if (selectedService.isTaxableOverride === true) return true
    // Otherwise use category setting
    if (professionCategoryKey) {
      const category = professionCategories.find(c => c.key === professionCategoryKey)
      return category?.taxIncluded ?? false
    }
    return false
  }, [selectedService, professionCategoryKey, professionCategories])

  // When service is selected, populate fields
  const handleSelectService = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId)
    if (!service) return

    setSelectedServiceId(serviceId)
    setDescription(service.name)
    setQuantity(1)

    // Try to get price
    let price = 0
    if (professionCategoryKey) {
      const categoryPrice = servicePrices.find(
        p => p.serviceId === serviceId && p.professionCategoryKey === professionCategoryKey && p.isActive
      )
      price = categoryPrice?.priceCents ?? 0
    }
    if (!price) {
      const globalPrice = servicePrices.find(
        p => p.serviceId === serviceId && !p.professionCategoryKey && p.isActive
      )
      price = globalPrice?.priceCents ?? 0
    }
    setUnitPriceInput((price / 100).toFixed(2))
  }

  // Calculate totals
  const unitPriceCents = parseCurrencyToCents(unitPriceInput) || 0
  const subtotalCents = quantity * unitPriceCents
  const taxTpsCents = isTaxable ? Math.round(subtotalCents * TPS_RATE) : 0
  const taxTvqCents = isTaxable ? Math.round(subtotalCents * TVQ_RATE) : 0
  const totalCents = subtotalCents + taxTpsCents + taxTvqCents

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description || unitPriceCents <= 0) return

    try {
      await addLineItem.mutateAsync({
        invoiceId,
        lineType: selectedServiceId ? 'service' : 'adjustment',
        serviceId: selectedServiceId || undefined,
        serviceName: description,
        serviceKey: selectedService?.key,
        quantityUnit: 'unit',
        quantity,
        unitPriceCents,
        professionCategoryKey: professionCategoryKey || undefined,
        isTaxable,
      })
      onSuccess()
    } catch (error) {
      console.error('Failed to add line item:', error)
    }
  }

  const canSubmit = description.trim() && unitPriceCents > 0 && !addLineItem.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Service selector */}
      <div className="space-y-2">
        <Label>Service</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between"
              type="button"
            >
              <span className={selectedService ? '' : 'text-foreground-muted'}>
                {selectedService?.name || 'Sélectionner un service...'}
              </span>
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 max-h-64 overflow-y-auto">
            {services.map(service => (
              <DropdownMenuItem
                key={service.id}
                onClick={() => handleSelectService(service.id)}
              >
                <div className="flex flex-col">
                  <span>{service.name}</span>
                  {service.duration && (
                    <span className="text-xs text-foreground-muted">{service.duration} min</span>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description de l'article"
        />
      </div>

      {/* Quantity and Price */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">Quantité</Label>
          <Input
            id="quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unitPrice">Prix unitaire ($)</Label>
          <Input
            id="unitPrice"
            type="text"
            value={unitPriceInput}
            onChange={(e) => setUnitPriceInput(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Totals preview */}
      <div className="p-3 bg-muted/50 rounded-lg space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Sous-total</span>
          <span>{formatCentsCurrency(subtotalCents)}</span>
        </div>
        <div className="flex justify-between text-foreground-muted">
          <span>TPS (5%)</span>
          <span>{formatCentsCurrency(taxTpsCents)}</span>
        </div>
        <div className="flex justify-between text-foreground-muted">
          <span>TVQ (9,975%)</span>
          <span>{formatCentsCurrency(taxTvqCents)}</span>
        </div>
        <div className="flex justify-between font-medium pt-1 border-t">
          <span>Total</span>
          <span>{formatCentsCurrency(totalCents)}</span>
        </div>
        {isTaxable && (
          <div className="text-xs text-foreground-muted">* Article taxable</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {addLineItem.isPending ? 'Ajout...' : 'Ajouter'}
        </Button>
      </div>
    </form>
  )
}
