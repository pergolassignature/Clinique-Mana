// src/facturation/components/invoice-creation-dialog.tsx
// Full dialog for creating and editing invoices before finalization

import { useState, useMemo } from 'react'
import {
  Pencil,
  Trash2,
  X,
  Check,
  Plus,
  Calendar,
  FileText,
  ChevronDown,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/lib/utils'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { formatCentsCurrency, parseCurrencyToCents } from '../utils/pricing'
import { TPS_RATE, TVQ_RATE } from '../constants'
import { useProfessionTitles } from '@/professionals/hooks'
import { useServicesForCategories, useServicePrices, useProfessionCategories } from '@/services-catalog/hooks'
import type { LineItemType, QuantityUnit } from '../types'
import type { Client } from '@/availability/types'
import type { ProfessionalWithRelations } from '@/professionals/types'

// =============================================================================
// TYPES
// =============================================================================

export interface InvoiceLineItem {
  id: string
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

interface InvoiceCreationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Client to bill */
  client: Client | null
  /** Professional for this appointment (to get available services) */
  professional: ProfessionalWithRelations | null
  /** Default line items from appointment */
  defaultLineItems: InvoiceLineItem[]
  /** Appointment status */
  appointmentStatus?: string
  /** Cancellation fee info */
  cancellationFeeApplied?: boolean
  cancellationFeePercent?: number
  /** Whether to suggest file opening fee */
  suggestFileOpeningFee: boolean
  /** File opening fee price in cents */
  fileOpeningFeeCents?: number
  /** Profession category from the appointment (determines pricing) */
  appointmentProfessionCategoryKey?: string
  /** Callback when confirmed */
  onConfirm: (lineItems: InvoiceLineItem[], options: {
    addFileOpeningFee: boolean
    notesClient: string
    notesInternal: string
  }) => void
  /** Whether currently creating */
  isCreating: boolean
}

// =============================================================================
// LINE ITEM ROW COMPONENT
// =============================================================================

interface LineItemRowProps {
  item: InvoiceLineItem
  isEditing: boolean
  editValues: { quantity: number; unitPriceCents: number; description: string }
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onRemove: () => void
  onEditValuesChange: (values: { quantity: number; unitPriceCents: number; description: string }) => void
}

function LineItemRow({
  item,
  isEditing,
  editValues,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
  onEditValuesChange,
}: LineItemRowProps) {
  const itemTotal = item.quantity * item.unitPriceCents
  const editTotal = editValues.quantity * editValues.unitPriceCents

  return (
    <tr className={cn('border-b border-border', isEditing && 'bg-sage-50')}>
      {/* Checkbox placeholder */}
      <td className="p-3 w-8">
        <input type="checkbox" className="rounded border-border" disabled />
      </td>
      {/* Edit icon */}
      <td className="p-3 w-8">
        {isEditing ? (
          <Check className="h-4 w-4 text-sage-600 cursor-pointer" onClick={onSaveEdit} />
        ) : (
          <Pencil className="h-4 w-4 text-foreground-muted cursor-pointer" onClick={onStartEdit} />
        )}
      </td>
      {/* Description */}
      <td className="p-3">
        {isEditing ? (
          <Input
            value={editValues.description}
            onChange={(e) => onEditValuesChange({ ...editValues, description: e.target.value })}
            className="h-8 text-sm"
            placeholder="Description"
          />
        ) : (
          <div>
            <div className="text-sm font-medium">{item.serviceName}</div>
            {item.description && (
              <div className="text-xs text-foreground-muted">{item.description}</div>
            )}
            {item.lineType === 'cancellation_fee' && (
              <div className="text-xs text-wine-600">Frais d'annulation</div>
            )}
            {item.lineType === 'file_opening_fee' && (
              <div className="text-xs text-amber-600">Ouverture de dossier</div>
            )}
          </div>
        )}
      </td>
      {/* Date */}
      <td className="p-3 text-center text-sm">
        {formatClinicDateShort(new Date())}
      </td>
      {/* Quantity */}
      <td className="p-3 text-center">
        {isEditing ? (
          <Input
            type="number"
            min={1}
            value={editValues.quantity}
            onChange={(e) => onEditValuesChange({ ...editValues, quantity: Number(e.target.value) })}
            className="h-8 w-16 text-sm text-center"
          />
        ) : (
          <span className="text-sm">{item.quantity}</span>
        )}
      </td>
      {/* Unit price */}
      <td className="p-3 text-right">
        {isEditing ? (
          <Input
            type="text"
            value={(editValues.unitPriceCents / 100).toFixed(2)}
            onChange={(e) => onEditValuesChange({
              ...editValues,
              unitPriceCents: parseCurrencyToCents(e.target.value)
            })}
            className="h-8 w-24 text-sm text-right"
          />
        ) : (
          <span className="text-sm">{formatCentsCurrency(item.unitPriceCents)}</span>
        )}
      </td>
      {/* Total */}
      <td className="p-3 text-right">
        <span className="text-sm font-medium">
          {formatCentsCurrency(isEditing ? editTotal : itemTotal)}
        </span>
      </td>
      {/* Actions */}
      <td className="p-3 w-8">
        {isEditing ? (
          <X className="h-4 w-4 text-foreground-muted cursor-pointer" onClick={onCancelEdit} />
        ) : (
          <Trash2
            className="h-4 w-4 text-wine-500 cursor-pointer hover:text-wine-600"
            onClick={onRemove}
          />
        )}
      </td>
    </tr>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function InvoiceCreationDialog({
  open,
  onOpenChange,
  client,
  professional,
  defaultLineItems,
  appointmentStatus,
  cancellationFeeApplied,
  cancellationFeePercent,
  suggestFileOpeningFee,
  fileOpeningFeeCents = 3500,
  appointmentProfessionCategoryKey,
  onConfirm,
  isCreating,
}: InvoiceCreationDialogProps) {
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>(defaultLineItems)
  const [addFileOpeningFee, setAddFileOpeningFee] = useState(suggestFileOpeningFee)
  const [notesClient, setNotesClient] = useState('')
  const [notesInternal, setNotesInternal] = useState('')
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({ quantity: 1, unitPriceCents: 0, description: '' })

  // Get profession titles to map profession_title_key to category_key
  const { data: professionTitles = [] } = useProfessionTitles()

  // Get profession category keys for fetching services
  // Priority: 1) appointmentProfessionCategoryKey (from stored appointment)
  //           2) All professional's profession categories (fallback)
  const professionalProfessions = professional?.professions || []
  const professionCategoryKeys = useMemo(() => {
    // If we have the category from the appointment, use it exclusively for price resolution
    if (appointmentProfessionCategoryKey) {
      return [appointmentProfessionCategoryKey]
    }
    // Fallback: use all professional's categories (legacy behavior)
    const keys: string[] = []
    for (const prof of professionalProfessions) {
      const title = professionTitles.find((t) => t.key === prof.profession_title_key)
      if (title?.profession_category_key && !keys.includes(title.profession_category_key)) {
        keys.push(title.profession_category_key)
      }
    }
    return keys
  }, [appointmentProfessionCategoryKey, professionalProfessions, professionTitles])

  // Fetch services available for this professional's profession categories
  const { data: servicesByCategory } = useServicesForCategories(professionCategoryKeys)
  const availableServices = servicesByCategory?.all || []

  // Fetch service prices and profession categories (for tax info)
  const { data: servicePrices = [] } = useServicePrices()
  const { data: professionCategories = [] } = useProfessionCategories()

  // Get profession label for display
  const selectedProfessionLabel = useMemo(() => {
    // If we have a specific category from appointment, find its label
    if (appointmentProfessionCategoryKey) {
      // Find which profession has this category
      for (const prof of professionalProfessions) {
        const title = professionTitles.find(t => t.key === prof.profession_title_key)
        if (title?.profession_category_key === appointmentProfessionCategoryKey) {
          return title.label_fr
        }
      }
    }
    // Fallback: use primary profession
    const primaryProf = professionalProfessions.find(p => p.is_primary) || professionalProfessions[0]
    if (primaryProf) {
      const title = professionTitles.find(t => t.key === primaryProf.profession_title_key)
      return title?.label_fr || null
    }
    return null
  }, [appointmentProfessionCategoryKey, professionalProfessions, professionTitles])

  // Get the active profession category key for price resolution
  const activeProfessionCategoryKey = appointmentProfessionCategoryKey || professionCategoryKeys[0] || null

  const isCancelled = appointmentStatus === 'cancelled'

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
    }

    const totalCents = subtotalCents + taxTpsCents + taxTvqCents

    return { subtotalCents, taxTpsCents, taxTvqCents, totalCents }
  }, [lineItems, addFileOpeningFee, fileOpeningFeeCents])

  const handleStartEdit = (item: InvoiceLineItem) => {
    setEditingItemId(item.id)
    setEditValues({
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      description: item.description || item.serviceName,
    })
  }

  const handleSaveEdit = (itemId: string) => {
    setLineItems(items =>
      items.map(item =>
        item.id === itemId
          ? {
              ...item,
              quantity: editValues.quantity,
              unitPriceCents: editValues.unitPriceCents,
              serviceName: editValues.description || item.serviceName,
            }
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

  const handleAddService = (serviceId: string) => {
    const service = availableServices.find(s => s.id === serviceId)
    if (!service) return

    // Find the price for this service using the same priority as RPC:
    // 1. Category-specific price (if activeProfessionCategoryKey is set)
    // 2. Global price (profession_category_key = null)
    let priceCents = 0

    if (activeProfessionCategoryKey) {
      // Try category-specific price first
      const categoryPrice = servicePrices.find(
        p => p.serviceId === serviceId &&
             p.professionCategoryKey === activeProfessionCategoryKey &&
             p.isActive
      )
      if (categoryPrice) {
        priceCents = categoryPrice.priceCents
      } else {
        // Fallback to global price
        const globalPrice = servicePrices.find(
          p => p.serviceId === serviceId && !p.professionCategoryKey && p.isActive
        )
        if (globalPrice) {
          priceCents = globalPrice.priceCents
        }
      }
    } else {
      // No category - use global price
      const globalPrice = servicePrices.find(
        p => p.serviceId === serviceId && !p.professionCategoryKey && p.isActive
      )
      if (globalPrice) {
        priceCents = globalPrice.priceCents
      }
    }

    // Determine taxability:
    // 1. If service has isTaxableOverride = true, it's always taxable (e.g., file opening fee)
    // 2. Otherwise, use profession category's taxIncluded setting
    const category = activeProfessionCategoryKey
      ? professionCategories.find(c => c.key === activeProfessionCategoryKey)
      : null
    const isTaxable = service.isTaxableOverride === true || (category?.taxIncluded ?? false)

    const newItem: InvoiceLineItem = {
      id: `service-${Date.now()}`,
      lineType: 'service',
      serviceId: service.id,
      serviceName: service.name,
      serviceKey: service.key,
      quantityUnit: 'unit',
      quantity: 1,
      billableMinutes: service.duration ?? null,
      unitPriceCents: priceCents,
      isTaxable,
      displayOrder: lineItems.length,
      description: null,
    }
    setLineItems([...lineItems, newItem])
  }

  const handleConfirm = () => {
    onConfirm(lineItems, {
      addFileOpeningFee,
      notesClient,
      notesInternal,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 border-b pb-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">Nouvelle facture</DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>
                QuickBooks
              </Button>
              <Button variant="outline" size="sm" disabled>
                Envoyer
              </Button>
              <Button variant="outline" size="sm" disabled>
                Imprimer
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 p-1">
          {/* Cancelled appointment banner */}
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

          {/* Client, Professional and Invoice info */}
          <div className="grid grid-cols-3 gap-6">
            {/* Client info */}
            <div>
              <div className="text-sm font-medium text-sage-600 mb-2">Client</div>
              {client ? (
                <div className="text-sm">
                  <div className="font-medium">{client.firstName} {client.lastName}</div>
                  {client.email && (
                    <div className="text-foreground-muted">{client.email}</div>
                  )}
                  {client.phone && (
                    <div className="text-foreground-muted">{client.phone}</div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-foreground-muted">Aucun client sélectionné</div>
              )}
            </div>

            {/* Professional info */}
            <div>
              <div className="text-sm font-medium text-sage-600 mb-2">Professionnel</div>
              {professional ? (
                <div className="text-sm">
                  <div className="font-medium">{professional.profile?.display_name || 'Professionnel'}</div>
                  {selectedProfessionLabel && (
                    <div className="text-foreground-muted">{selectedProfessionLabel}</div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-foreground-muted">Aucun professionnel</div>
              )}
            </div>

            {/* Invoice info */}
            <div className="text-right">
              <div className="text-sm font-medium text-sage-600 mb-2">Numéro de facture</div>
              <div className="text-sm text-foreground-muted italic">
                (Généré automatiquement)
              </div>
              <div className="text-sm font-medium text-sage-600 mt-4 mb-2">Date de la facture</div>
              <div className="text-sm">
                {formatClinicDateShort(new Date())}
              </div>
            </div>
          </div>

              {/* Line items table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-background-secondary">
                    <tr className="text-xs font-medium text-foreground-muted">
                      <th className="p-3 w-8"></th>
                      <th className="p-3 w-8"></th>
                      <th className="p-3 text-left">Item / Description</th>
                      <th className="p-3 text-center">Date du service</th>
                      <th className="p-3 text-center">Quantité</th>
                      <th className="p-3 text-right">Prix unitaire</th>
                      <th className="p-3 text-right">Montant</th>
                      <th className="p-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map(item => (
                      <LineItemRow
                        key={item.id}
                        item={item}
                        isEditing={editingItemId === item.id}
                        editValues={editValues}
                        onStartEdit={() => handleStartEdit(item)}
                        onSaveEdit={() => handleSaveEdit(item.id)}
                        onCancelEdit={handleCancelEdit}
                        onRemove={() => handleRemoveItem(item.id)}
                        onEditValuesChange={setEditValues}
                      />
                    ))}
                    {lineItems.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-sm text-foreground-muted">
                          Aucun élément à facturer
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add service dropdown */}
              <div className="flex gap-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-sage-600 hover:text-sage-700"
                      disabled={availableServices.length === 0}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Ajouter un service
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {availableServices.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-foreground-muted">
                        Aucun service disponible
                      </div>
                    ) : (
                      availableServices.map((service) => (
                        <DropdownMenuItem
                          key={service.id}
                          onClick={() => handleAddService(service.id)}
                        >
                          <div className="flex flex-col">
                            <span>{service.name}</span>
                            {service.duration && (
                              <span className="text-xs text-foreground-muted">
                                {service.duration} min
                              </span>
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* File opening fee checkbox */}
              {suggestFileOpeningFee && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
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

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Sous-total</span>
                    <span>{formatCentsCurrency(totals.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-foreground-muted">
                    <span>TPS (5%)</span>
                    <span>{formatCentsCurrency(totals.taxTpsCents)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-foreground-muted">
                    <span>TVQ (9,975%)</span>
                    <span>{formatCentsCurrency(totals.taxTvqCents)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-border pt-2">
                    <span>Total</span>
                    <span>{formatCentsCurrency(totals.totalCents)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-foreground-muted">
                    <span>Payé</span>
                    <span>{formatCentsCurrency(0)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-base">
                    <span>Solde</span>
                    <span>{formatCentsCurrency(totals.totalCents)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-sage-600">Notes (visible sur la facture)</label>
                  <Textarea
                    value={notesClient}
                    onChange={(e) => setNotesClient(e.target.value)}
                    placeholder="Notes pour le client..."
                    className="mt-1"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground-muted">Notes internes</label>
                  <Textarea
                    value={notesInternal}
                    onChange={(e) => setNotesInternal(e.target.value)}
                    placeholder="Notes internes (non visibles sur la facture)..."
                    className="mt-1"
                    rows={2}
                  />
                </div>
              </div>
        </div>

        {/* Footer actions */}
        <div className="flex-shrink-0 border-t pt-4 mt-4">
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled>
                <Calendar className="h-4 w-4 mr-1" />
                Payer
              </Button>
              <Button variant="outline" size="sm" disabled>
                <Plus className="h-4 w-4 mr-1" />
                Paiement
              </Button>
              <Button variant="outline" size="sm" disabled>
                <FileText className="h-4 w-4 mr-1" />
                Réclamation
              </Button>
              <Button variant="outline" size="sm" disabled className="text-wine-600">
                <X className="h-4 w-4 mr-1" />
                Annuler
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fermer
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isCreating || lineItems.length === 0}
              >
                {isCreating ? 'Création...' : 'Créer la facture'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
