// src/facturation/components/invoice-billing-tab.tsx
// Billing tab component for the appointment editor

import { useState, useMemo } from 'react'
import { FileText, Plus, DollarSign, AlertCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent } from '@/shared/ui/card'
import { Select } from '@/shared/ui/select'
import { cn } from '@/shared/lib/utils'
import { formatCentsCurrency } from '../utils/pricing'
import {
  useInvoiceByAppointment,
  useNewClientStatus,
  useClientActivePayers,
  useCreateInvoice,
} from '../hooks'
import { useProfessional } from '@/professionals/hooks'
import { useClientRelations } from '@/clients/hooks'
import { useServicePrices, useProfessionTitles, useProfessionCategories } from '@/services-catalog/hooks'
import { calculateCancellationFee } from '../utils/pricing'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
} from '../constants'
import { InvoiceCreationDialog, type InvoiceLineItem } from './invoice-creation-dialog'
import type { Appointment, Client, BookableService } from '@/availability/types'

interface InvoiceBillingTabProps {
  appointment: Appointment | null
  clients: Client[]
  selectedClients: Client[]
  service: BookableService | undefined
  professionalId: string | null
  onInvoiceCreated?: (invoiceId: string) => void
  onViewInvoice?: (invoiceId: string) => void
}

export function InvoiceBillingTab({
  appointment,
  clients: _clients,
  selectedClients,
  service,
  professionalId,
  onInvoiceCreated,
  onViewInvoice,
}: InvoiceBillingTabProps) {
  const [selectedClientId, setSelectedClientId] = useState<string>(
    selectedClients[0]?.id || ''
  )
  const [isCreating, setIsCreating] = useState(false)
  const [showDialog, setShowDialog] = useState(false)

  // Fetch professional data for available services
  const { data: professional } = useProfessional(professionalId ?? undefined)

  // Price resolution hooks
  const { data: servicePrices = [] } = useServicePrices()
  const { data: professionTitles = [] } = useProfessionTitles()
  const { data: professionCategories = [] } = useProfessionCategories()

  // Check if invoice exists for this appointment
  const { data: existingInvoice, isLoading: invoiceLoading } = useInvoiceByAppointment(
    appointment?.id || ''
  )

  // Check new client status for file opening fee
  const { data: newClientStatus } = useNewClientStatus(selectedClientId)

  // Check for external payers
  const { data: activePayers } = useClientActivePayers(selectedClientId)

  // Load relations for first client (to find parents)
  const firstClientId = selectedClients[0]?.id
  const { data: firstClientRelations } = useClientRelations(firstClientId)

  // Build billing options: participants + parents of first client
  const billingOptions = useMemo(() => {
    const options = selectedClients.map(c => ({
      id: c.id,
      label: `${c.firstName} ${c.lastName}`,
      isParent: false,
      childName: undefined as string | undefined,
    }))

    // Add parents of first client as billing options
    if (firstClientRelations?.length) {
      for (const rel of firstClientRelations) {
        if (rel.relationType === 'parent' || rel.relationType === 'guardian') {
          if (!options.find(o => o.id === rel.relatedClientId)) {
            options.push({
              id: rel.relatedClientId,
              label: rel.relatedClientName,
              isParent: true,
              childName: selectedClients[0]?.firstName,
            })
          }
        }
      }
    }

    return options
  }, [selectedClients, firstClientRelations])

  const createInvoice = useCreateInvoice()

  // Get selected client object
  const selectedClient = selectedClients.find(c => c.id === selectedClientId) || null

  // Resolve professional's category key (pattern from invoice-creation-dialog.tsx:237-246)
  const professionCategoryKey = useMemo(() => {
    if (!professional?.professions?.length) return null
    const firstProfession = professional.professions[0]
    if (!firstProfession) return null
    const title = professionTitles.find(t => t.key === firstProfession.profession_title_key)
    return title?.professionCategoryKey ?? null
  }, [professional, professionTitles])

  // Resolve service price (same logic as RPC create_invoice_with_line_item)
  const resolvedServicePrice = useMemo(() => {
    if (!service) return null

    // Priority 1: Category-specific price
    if (professionCategoryKey) {
      const categoryPrice = servicePrices.find(
        p => p.serviceId === service.id && p.professionCategoryKey === professionCategoryKey && p.isActive
      )
      if (categoryPrice) {
        // For BookableService we don't have isTaxableOverride, check category tax status
        const category = professionCategories.find(c => c.key === professionCategoryKey)
        const isTaxable = category?.taxIncluded ?? false
        return { priceCents: categoryPrice.priceCents, isTaxable, missingPrice: false }
      }
    }

    // Priority 2: Global price (profession_category_key = null)
    const globalPrice = servicePrices.find(
      p => p.serviceId === service.id && !p.professionCategoryKey && p.isActive
    )
    if (globalPrice) {
      // Use category tax status if available
      const category = professionCategoryKey ? professionCategories.find(c => c.key === professionCategoryKey) : null
      const isTaxable = category?.taxIncluded ?? false
      return { priceCents: globalPrice.priceCents, isTaxable, missingPrice: false }
    }

    // No price found - return 0 with warning flag
    return { priceCents: 0, isTaxable: false, missingPrice: true }
  }, [service, professionCategoryKey, servicePrices, professionCategories])

  // Check if appointment is cancelled
  const isCancelled = appointment?.status === 'cancelled'
  const cancellationFeeApplied = appointment?.cancellationFeeApplied ?? false
  const cancellationFeePercent = appointment?.cancellationFeePercent ?? 0

  // Generate default line items based on appointment status
  const defaultLineItems: InvoiceLineItem[] = useMemo(() => {
    if (!service) return []

    // For cancelled appointments with fee
    if (isCancelled && cancellationFeeApplied && cancellationFeePercent > 0) {
      const originalPrice = resolvedServicePrice?.priceCents ?? 0
      const isTaxable = resolvedServicePrice?.isTaxable ?? false
      const feeCalculation = calculateCancellationFee(originalPrice, cancellationFeePercent, isTaxable)

      return [{
        id: 'cancellation-fee',
        lineType: 'cancellation_fee' as const,
        serviceId: service.id,
        serviceName: `${service.nameFr} - Frais d'annulation (${cancellationFeePercent}%)`,
        serviceKey: null,
        quantityUnit: 'unit' as const,
        quantity: 1,
        billableMinutes: null,
        unitPriceCents: feeCalculation.unitPriceCents,
        isTaxable: feeCalculation.isTaxable,
        displayOrder: 0,
        description: `Frais d'annulation - ${cancellationFeePercent}% du service`,
      }]
    }

    // For cancelled appointments without fee
    if (isCancelled && !cancellationFeeApplied) {
      return []
    }

    // For normal appointments - bill full service
    return [{
      id: 'service',
      lineType: 'service' as const,
      serviceId: service.id,
      serviceName: service.nameFr,
      serviceKey: null,
      quantityUnit: 'unit' as const,
      quantity: 1,
      billableMinutes: appointment?.durationMinutes ?? service.durationMinutes,
      unitPriceCents: resolvedServicePrice?.priceCents ?? 0,
      isTaxable: resolvedServicePrice?.isTaxable ?? false,
      displayOrder: 0,
      description: null,
    }]
  }, [service, isCancelled, cancellationFeeApplied, cancellationFeePercent, appointment?.durationMinutes, resolvedServicePrice])

  const handleOpenDialog = () => {
    setShowDialog(true)
  }

  const handleConfirmCreate = async (
    _lineItems: InvoiceLineItem[],
    options: { addFileOpeningFee: boolean; notesClient: string; notesInternal: string }
  ) => {
    if (!appointment?.id || !selectedClientId) return

    setIsCreating(true)
    try {
      const invoice = await createInvoice.mutateAsync({
        appointmentId: appointment.id,
        clientId: selectedClientId,
        addFileOpeningFee: options.addFileOpeningFee,
        notesClient: options.notesClient || undefined,
        notesInternal: options.notesInternal || undefined,
      })

      setShowDialog(false)
      onInvoiceCreated?.(invoice.id)
    } catch (error) {
      console.error('Failed to create invoice:', error)
    } finally {
      setIsCreating(false)
    }
  }

  // If no appointment, show message
  if (!appointment?.id || appointment.id.startsWith('new-')) {
    return (
      <div className="space-y-3 p-3 rounded-lg bg-background-secondary border border-border">
        <div className="text-sm font-medium text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-foreground-muted" />
          Facturation
        </div>
        <div className="text-sm text-foreground-muted">
          Enregistrez le rendez-vous pour accéder à la facturation.
        </div>
      </div>
    )
  }

  // Loading state
  if (invoiceLoading) {
    return (
      <div className="space-y-3 p-3 rounded-lg bg-background-secondary border border-border">
        <div className="text-sm font-medium text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-foreground-muted" />
          Facturation
        </div>
        <div className="text-sm text-foreground-muted animate-pulse">
          Chargement...
        </div>
      </div>
    )
  }

  // Invoice already exists - show summary
  if (existingInvoice) {
    return (
      <div className="space-y-3 p-3 rounded-lg bg-background-secondary border border-border">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-foreground-muted" />
            Facturation
          </div>
          <Badge className={cn('text-xs', INVOICE_STATUS_COLORS[existingInvoice.status])}>
            {INVOICE_STATUS_LABELS[existingInvoice.status]}
          </Badge>
        </div>

        <Card className="bg-background border-border">
          <CardContent className="p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground-muted">Facture</span>
              <span className="text-sm font-medium">{existingInvoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground-muted">Total</span>
              <span className="text-sm font-medium">
                {formatCentsCurrency(existingInvoice.totalCents)}
              </span>
            </div>
            {existingInvoice.balanceCents > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Solde</span>
                <span className="text-sm font-medium text-amber-600">
                  {formatCentsCurrency(existingInvoice.balanceCents)}
                </span>
              </div>
            )}
            {existingInvoice.balanceCents === 0 && existingInvoice.status === 'paid' && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Solde</span>
                <span className="text-sm font-medium text-emerald-600">
                  Payé
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onViewInvoice?.(existingInvoice.id)}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Voir la facture
        </Button>
      </div>
    )
  }

  // No invoice yet - show creation form
  return (
    <>
      <div className="space-y-3 p-3 rounded-lg bg-background-secondary border border-border">
        <div className="text-sm font-medium text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-foreground-muted" />
          Facturation
        </div>

        {/* Client selector for multi-client or parent available */}
        {billingOptions.length > 1 && (
          <div className="space-y-2">
            <label className="text-xs text-foreground-muted">
              Facturer à
            </label>
            <Select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              placeholder="Sélectionner un client"
            >
              {billingOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.isParent && option.childName && ` (parent de ${option.childName})`}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Service info */}
        {service && (
          <Card className="bg-background border-border">
            <CardContent className="p-3 space-y-1">
              <div className="text-sm font-medium">{service.nameFr}</div>
              <div className="text-xs text-foreground-muted">
                {appointment?.durationMinutes || service.durationMinutes} minutes
              </div>
              {/* Price preview */}
              {resolvedServicePrice && (
                <div className="text-xs text-foreground-muted">
                  {formatCentsCurrency(resolvedServicePrice.priceCents)}
                  {resolvedServicePrice.isTaxable && ' + taxes'}
                </div>
              )}
              {/* Missing price warning */}
              {resolvedServicePrice?.missingPrice && (
                <div className="text-xs text-amber-600">
                  ⚠️ Prix non configuré pour cette catégorie
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Cancelled appointment info */}
        {isCancelled && (
          <div className="flex items-start gap-2 p-2 rounded bg-wine-50 border border-wine-200">
            <AlertCircle className="h-4 w-4 text-wine-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-wine-800">Rendez-vous annulé</div>
              <div className="text-wine-700">
                {cancellationFeeApplied
                  ? `Frais d'annulation : ${cancellationFeePercent}% du service`
                  : 'Aucun frais d\'annulation à facturer'}
              </div>
            </div>
          </div>
        )}

        {/* New client alert */}
        {!isCancelled && newClientStatus?.shouldAddFileOpeningFee && (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-amber-800">Nouveau client</div>
              <div className="text-amber-700">
                Les frais d'ouverture de dossier seront ajoutés à la facture.
              </div>
            </div>
          </div>
        )}

        {!isCancelled && newClientStatus?.hasRelationWithHistory && !newClientStatus.shouldAddFileOpeningFee && (
          <div className="flex items-start gap-2 p-2 rounded bg-sky-50 border border-sky-200">
            <AlertCircle className="h-4 w-4 text-sky-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-sky-800">Relation existante</div>
              <div className="text-sky-700">
                Ce client a un membre de la famille déjà dans notre système.
              </div>
            </div>
          </div>
        )}

        {/* External payer info */}
        {activePayers && activePayers.length > 0 && (
          <div className="space-y-2">
            {activePayers.map(payer => (
              <div
                key={payer.id}
                className="flex items-start gap-2 p-2 rounded bg-sage-50 border border-sage-200"
              >
                <DollarSign className="h-4 w-4 text-sage-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <div className="font-medium text-sage-800">
                    {payer.payer_type === 'ivac' ? 'IVAC' : 'PAE'}
                  </div>
                  <div className="text-sage-700">
                    {payer.payer_type === 'ivac'
                      ? `Dossier: ${payer.ivac_details.file_number}`
                      : `${payer.pae_details.pae_provider_name} - ${payer.pae_details.file_number}`
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create invoice button */}
        <Button
          onClick={handleOpenDialog}
          disabled={!selectedClientId || (isCancelled && !cancellationFeeApplied)}
          className="w-full"
          size="sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Créer la facture
        </Button>

        {/* Message for cancelled appointments with no fee */}
        {isCancelled && !cancellationFeeApplied && (
          <p className="text-xs text-foreground-muted text-center">
            Aucun frais d'annulation n'est appliqué à ce rendez-vous.
          </p>
        )}
      </div>

      {/* Invoice creation dialog */}
      <InvoiceCreationDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        client={selectedClient}
        professional={professional ?? null}
        defaultLineItems={defaultLineItems}
        appointmentStatus={appointment?.status}
        cancellationFeeApplied={cancellationFeeApplied}
        cancellationFeePercent={cancellationFeePercent}
        suggestFileOpeningFee={!isCancelled && (newClientStatus?.shouldAddFileOpeningFee || false)}
        fileOpeningFeeCents={3500}
        onConfirm={handleConfirmCreate}
        isCreating={isCreating}
      />
    </>
  )
}
