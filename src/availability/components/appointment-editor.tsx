// src/availability/components/appointment-editor.tsx

import { useState, useEffect, useMemo } from 'react'
import { differenceInHours } from 'date-fns'
import { Trash2, Plus, ChevronDown, ChevronUp, Clock, Calendar, MapPin, Video, Phone, History } from 'lucide-react'
import {
  getClinicDateString,
  getClinicTimeString,
  clinicTimeToUTC,
  formatInClinicTimezone,
} from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { cn } from '@/shared/lib/utils'
import type { Appointment, AppointmentStatus, AppointmentMode, BookableService, Client } from '../types'
import { ClientCard, ClientPickerItem } from './client-card'
import { CompactCalendarHistory } from './calendar-history'
import { useAppointmentAuditLog } from '../hooks'
import { InvoiceBillingTab, InvoiceDrawer } from '@/facturation/components'
import { ClientDrawer } from '@/clients/components/client-drawer'
import { useProfessionTitles } from '@/services-catalog/hooks'
import { useProfessional } from '@/professionals/hooks'

interface AppointmentEditorProps {
  appointment: Appointment | null
  onSave: (data: Partial<Appointment>) => void
  onCancel: () => void
  onCancelAppointment?: (info?: { reason?: string; feeApplied?: boolean; feePercent?: number }) => void
  onRestoreAppointment?: () => void
  onDirtyChange: (dirty: boolean) => void
  /** Real data from database */
  bookableServices: BookableService[]
  clients: Client[]
  /** Selected professional ID to filter clients and load profession data */
  selectedProfessionalId?: string | null
}

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'created', label: 'Créé' },
  { value: 'confirmed', label: 'Confirmé' },
]

const MODE_OPTIONS: { value: AppointmentMode; label: string; icon: typeof MapPin }[] = [
  { value: 'in_person', label: 'En personne', icon: MapPin },
  { value: 'video', label: 'Vidéo', icon: Video },
  { value: 'phone', label: 'Téléphone', icon: Phone },
]

export function AppointmentEditor({
  appointment,
  onSave,
  onCancel,
  onCancelAppointment,
  onRestoreAppointment,
  onDirtyChange,
  bookableServices,
  clients,
  selectedProfessionalId,
}: AppointmentEditorProps) {
  const isNew = !appointment?.id || appointment.id.startsWith('new-')
  const isCancelled = appointment?.status === 'cancelled'
  const initialTab = isNew ? 'participants' : 'details'

  const [serviceId, setServiceId] = useState(appointment?.serviceId || '')
  const [clientIds, setClientIds] = useState<string[]>(appointment?.clientIds || [])
  const [date, setDate] = useState(
    appointment ? getClinicDateString(appointment.startTime) : getClinicDateString(new Date())
  )
  const [startTime, setStartTime] = useState(
    appointment ? getClinicTimeString(appointment.startTime) : '09:00'
  )
  const [durationMinutes, setDurationMinutes] = useState(appointment?.durationMinutes || 50)
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status === 'cancelled' ? 'confirmed' : (appointment?.status || 'created'))
  const [mode, setMode] = useState<AppointmentMode>(appointment?.mode || 'video')
  const [notes, setNotes] = useState(appointment?.notesInternal || '')
  const [showClientPicker, setShowClientPicker] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelFeeApplied, setCancelFeeApplied] = useState<boolean>(appointment?.cancellationFeeApplied ?? false)
  const [cancelFeePercent, setCancelFeePercent] = useState<number>(appointment?.cancellationFeePercent ?? 50)
  const [editingCancelFee, setEditingCancelFee] = useState(false)
  const [activeTab, setActiveTab] = useState<'participants' | 'details' | 'billing' | 'history'>(initialTab)
  const [showInvoiceDrawer, setShowInvoiceDrawer] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [showClientDrawer, setShowClientDrawer] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [professionCategoryKey, setProfessionCategoryKey] = useState<string | undefined>(
    appointment?.professionCategoryKey
  )

  // Fetch professional data with professions
  const { data: professionalData } = useProfessional(selectedProfessionalId ?? undefined)

  // Fetch profession titles for display
  const { data: professionTitles = [] } = useProfessionTitles()

  // Fetch audit log for existing appointments
  const { data: auditLog, isLoading: auditLoading } = useAppointmentAuditLog(
    !isNew && appointment?.id ? appointment.id : ''
  )

  // Get available professions for this professional
  const availableProfessions = useMemo(() => {
    if (!professionalData?.professions?.length) return []
    return professionalData.professions.map(prof => {
      const title = professionTitles.find(t => t.key === prof.profession_title_key)
      return {
        professionTitleKey: prof.profession_title_key,
        professionCategoryKey: title?.professionCategoryKey ?? prof.profession_title?.profession_category_key ?? '',
        labelFr: title?.labelFr ?? prof.profession_title?.label_fr ?? prof.profession_title_key,
        isPrimary: prof.is_primary,
      }
    })
  }, [professionalData, professionTitles])

  // Auto-select profession if not set and professional has professions
  useEffect(() => {
    if (!professionCategoryKey && availableProfessions.length > 0) {
      // Prefer primary profession, fallback to first
      const primary = availableProfessions.find(p => p.isPrimary)
      setProfessionCategoryKey(primary?.professionCategoryKey || availableProfessions[0]?.professionCategoryKey)
    }
  }, [professionCategoryKey, availableProfessions])

  // Get selected profession label for display
  const selectedProfessionLabel = useMemo(() => {
    if (!professionCategoryKey) return null
    const profession = availableProfessions.find(p => p.professionCategoryKey === professionCategoryKey)
    return profession?.labelFr || null
  }, [professionCategoryKey, availableProfessions])

  const selectedService = useMemo(
    () => bookableServices.find(s => s.id === serviceId),
    [bookableServices, serviceId]
  )

  // Get selected client objects
  const selectedClients = useMemo(
    () => clientIds.map(id => clients.find(c => c.id === id)).filter(Boolean),
    [clients, clientIds]
  )

  // Filter clients to only show those assigned to the selected professional
  const filteredClients = useMemo(
    () => {
      if (!selectedProfessionalId) return clients
      return clients.filter(c => c.primaryProfessionalId === selectedProfessionalId)
    },
    [clients, selectedProfessionalId]
  )

  // Track dirty state
  useEffect(() => {
    if (!appointment) {
      onDirtyChange(true)
      return
    }

    const isDirty =
      serviceId !== appointment.serviceId ||
      JSON.stringify(clientIds) !== JSON.stringify(appointment.clientIds) ||
      date !== getClinicDateString(appointment.startTime) ||
      startTime !== getClinicTimeString(appointment.startTime) ||
      durationMinutes !== appointment.durationMinutes ||
      (appointment.status !== 'cancelled' && status !== appointment.status) ||
      mode !== (appointment.mode || 'video') ||
      notes !== (appointment.notesInternal || '')

    onDirtyChange(isDirty)
  }, [serviceId, clientIds, date, startTime, durationMinutes, status, mode, notes, appointment, onDirtyChange])

  useEffect(() => {
    setActiveTab(initialTab)
    setShowClientPicker(false)
    setShowDetails(false)
    setCancelReason('')
    setEditingCancelFee(false)
    setCancelFeeApplied(appointment?.cancellationFeeApplied ?? false)
    setCancelFeePercent(appointment?.cancellationFeePercent ?? 50)
  }, [
    initialTab,
    appointment?.id,
    appointment?.cancellationFeeApplied,
    appointment?.cancellationFeePercent,
  ])

  useEffect(() => {
    if (!appointment) return
    const nextServiceId = appointment.serviceId || ''
    const nextService = bookableServices.find(s => s.id === nextServiceId)

    setServiceId(nextServiceId)
    setClientIds(appointment.clientIds || [])
    setDate(getClinicDateString(appointment.startTime))
    setStartTime(getClinicTimeString(appointment.startTime))
    setDurationMinutes(appointment.durationMinutes || nextService?.durationMinutes || 50)
    setStatus(appointment.status === 'cancelled' ? 'confirmed' : (appointment.status || 'created'))
    setMode(appointment.mode || 'video')
    setNotes(appointment.notesInternal || '')
  }, [appointment?.id, bookableServices])

  const canEditClients = isNew && !isCancelled

  const handleClientToggle = (clientId: string) => {
    if (!canEditClients) return
    if (!selectedService) return

    if (clientIds.includes(clientId)) {
      setClientIds(clientIds.filter(id => id !== clientId))
    } else if (clientIds.length < selectedService.maxClients) {
      setClientIds([...clientIds, clientId])
    }
  }

  const handleRemoveClient = (clientId: string) => {
    if (!canEditClients) return
    setClientIds(clientIds.filter(id => id !== clientId))
  }

  const handleSave = () => {
    // Convert clinic local time to UTC for storage
    const startTimeUTC = clinicTimeToUTC(date, startTime)

    onSave({
      serviceId,
      clientIds,
      startTime: startTimeUTC,
      durationMinutes,
      status,
      mode,
      notesInternal: notes || undefined,
      professionCategoryKey,
    })
  }

  const clientCountValid = selectedService
    ? clientIds.length >= selectedService.minClients && clientIds.length <= selectedService.maxClients
    : true

  const canAddMoreClients = selectedService && clientIds.length < selectedService.maxClients
  const canConfirm = !isCancelled && status === 'created'
  const canCancelAppointment = !!appointment && !isNew && !isCancelled
  const hoursUntilAppointment = appointment
    ? differenceInHours(new Date(appointment.startTime), new Date())
    : null
  const isLateCancel = canCancelAppointment && hoursUntilAppointment !== null && hoursUntilAppointment < 24
  const normalizedCancelFeePercent = Math.max(0, Math.min(100, Math.round(cancelFeePercent || 0)))

  // Calculate end time for display (add duration to start time)
  const endTimeDisplay = useMemo(() => {
    const parts = startTime.split(':').map(Number)
    const hours = parts[0] ?? 0
    const minutes = parts[1] ?? 0
    const totalMinutes = hours * 60 + minutes + durationMinutes
    const endHours = Math.floor(totalMinutes / 60) % 24
    const endMins = totalMinutes % 60
    return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`
  }, [startTime, durationMinutes])

  const ModeIcon = MODE_OPTIONS.find(m => m.value === mode)?.icon || MapPin

  return (
    <div className="space-y-5">
      {/* Cancelled banner */}
      {isCancelled && (
        <div className="p-3 rounded-lg bg-wine-50 border border-wine-200">
          <div className="text-sm font-medium text-wine-700">Rendez-vous annulé</div>
          {appointment?.cancellationReason && (
            <div className="text-sm text-wine-600 mt-1">{appointment.cancellationReason}</div>
          )}
          <div className="mt-2 text-xs text-foreground-muted">
            Frais d'annulation :{' '}
            {appointment?.cancellationFeeApplied
              ? `${appointment.cancellationFeePercent ?? 0}%`
              : 'Aucun frais'}
          </div>
          {onRestoreAppointment && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestoreAppointment}
              className="mt-2"
            >
              Restaurer
            </Button>
          )}
          {onSave && (
            <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-foreground">Frais d'annulation</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCancelFee(prev => !prev)}
                >
                  {editingCancelFee ? 'Fermer' : 'Modifier'}
                </Button>
              </div>
              {editingCancelFee && (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCancelFeeApplied(false)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                        !cancelFeeApplied
                          ? 'border-sage-400 bg-sage-50 text-sage-700'
                          : 'border-border hover:border-sage-300'
                      )}
                    >
                      Aucun frais
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelFeeApplied(true)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                        cancelFeeApplied
                          ? 'border-sage-400 bg-sage-50 text-sage-700'
                          : 'border-border hover:border-sage-300'
                      )}
                    >
                      Appliquer des frais
                    </button>
                  </div>
                  {cancelFeeApplied && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="cancelFeePercent" className="text-xs">
                        Pourcentage
                      </Label>
                      <Input
                        id="cancelFeePercent"
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={cancelFeePercent}
                        onChange={(e) => setCancelFeePercent(Number(e.target.value))}
                        className="h-8 w-20 text-xs"
                      />
                      <span className="text-xs text-foreground-muted">%</span>
                    </div>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      onSave({
                        cancellationFeeApplied: cancelFeeApplied,
                        cancellationFeePercent: cancelFeeApplied ? normalizedCancelFeePercent : undefined,
                      })
                      setEditingCancelFee(false)
                    }}
                  >
                    Enregistrer les frais
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Service header - compact display */}
      <div
        className="flex items-center gap-3 p-3 rounded-xl border border-border"
        style={{ backgroundColor: `${selectedService?.colorHex}10` }}
      >
        <div
          className="w-1.5 h-12 rounded-full flex-shrink-0"
          style={{ backgroundColor: selectedService?.colorHex }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground truncate">{selectedService?.nameFr || 'Service'}</div>
          <div className="text-sm text-foreground-muted">
            {selectedService?.durationMinutes} min · {selectedService?.clientType === 'individual' ? 'Individuel' : selectedService?.clientType === 'couple' ? 'Couple' : 'Famille'}
          </div>
          {/* Show profession - selector if multiple, label if single */}
          {availableProfessions.length > 1 ? (
            <select
              value={professionCategoryKey || ''}
              onChange={(e) => setProfessionCategoryKey(e.target.value)}
              className="mt-1 text-xs bg-transparent border border-sage-200 rounded px-2 py-0.5 text-sage-700 focus:outline-none focus:ring-1 focus:ring-sage-400"
            >
              {availableProfessions.map(prof => (
                <option key={prof.professionCategoryKey} value={prof.professionCategoryKey}>
                  {prof.labelFr}{prof.isPrimary ? ' (principal)' : ''}
                </option>
              ))}
            </select>
          ) : selectedProfessionLabel ? (
            <div className="text-xs text-sage-600 mt-0.5">{selectedProfessionLabel}</div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-background-tertiary/40 p-1">
        {[
          { id: 'participants', label: 'Participants' },
          { id: 'details', label: 'Rendez-vous' },
          { id: 'billing', label: 'Facturation' },
          ...(!isNew ? [{ id: 'history', label: 'Historique', icon: History }] : []),
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={cn(
              'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1',
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            )}
          >
            {'icon' in tab && tab.icon && <tab.icon className="h-3 w-3" />}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'participants' && (
        <div className="space-y-3">
          {selectedClients.length > 0 && (
            <div className="space-y-2">
              {selectedClients.map(client => client && (
                <ClientCard
                  key={client.id}
                  client={client}
                  onRemove={canEditClients ? () => handleRemoveClient(client.id) : undefined}
                  onClick={() => {
                    setSelectedClientId(client.id)
                    setShowClientDrawer(true)
                  }}
                />
              ))}
            </div>
          )}

          {/* Add client button */}
          {canAddMoreClients && canEditClients && (
            <button
              onClick={() => setShowClientPicker(!showClientPicker)}
              className={cn(
                'w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed transition-colors',
                showClientPicker
                  ? 'border-sage-400 bg-sage-50 text-sage-700'
                  : 'border-border-light text-foreground-muted hover:border-sage-300 hover:text-sage-600'
              )}
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">
                {clientIds.length === 0 ? 'Ajouter un client' : 'Ajouter un autre client'}
              </span>
            </button>
          )}

          {/* Client picker */}
          {showClientPicker && canEditClients && (
            <div className="space-y-2 p-3 rounded-lg bg-background-secondary border border-border">
              <div className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Sélectionner un client
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredClients.filter(c => !clientIds.includes(c.id)).length === 0 ? (
                  <p className="text-xs text-foreground-muted py-2">
                    Aucun client assigné à ce professionnel
                  </p>
                ) : (
                  filteredClients.filter(c => !clientIds.includes(c.id)).map(client => (
                    <ClientPickerItem
                      key={client.id}
                      client={client}
                      isSelected={false}
                      canSelect={canAddMoreClients || false}
                      onToggle={() => {
                        handleClientToggle(client.id)
                        if (clientIds.length + 1 >= (selectedService?.maxClients || 1)) {
                          setShowClientPicker(false)
                        }
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* Client count validation */}
          {!clientCountValid && selectedService && (
            <p className="text-xs text-wine-600 bg-wine-50 p-2 rounded-lg">
              {selectedService.clientType === 'couple'
                ? 'Sélectionnez 2 clients pour une consultation couple'
                : `Sélectionnez entre ${selectedService.minClients} et ${selectedService.maxClients} clients`}
            </p>
          )}

          {!canEditClients && (
            <p className="text-xs text-foreground-muted bg-background-secondary p-2 rounded-lg">
              Les clients sont verrouillés pour les rendez-vous existants. Supprimez et recréez le rendez-vous pour modifier les participants.
            </p>
          )}
        </div>
      )}

      {activeTab === 'details' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background-secondary">
            <Calendar className="h-4 w-4 text-foreground-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {formatInClinicTimezone(`${date}T12:00:00`, 'EEEE d MMMM yyyy')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-background-secondary">
            <Clock className="h-4 w-4 text-foreground-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {startTime} – {endTimeDisplay}
              </div>
              <div className="text-xs text-foreground-muted">{durationMinutes} minutes</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-background-secondary">
            <ModeIcon className="h-4 w-4 text-foreground-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {MODE_OPTIONS.find(m => m.value === mode)?.label}
              </div>
            </div>
          </div>

          {!isCancelled && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background-secondary">
              <div>
                <div className="text-xs text-foreground-muted uppercase tracking-wide">Statut</div>
                <div className="text-sm font-medium">
                  {status === 'created' ? 'Créé' : 'Confirmé'}
                </div>
              </div>
              {canConfirm && (
                <Button variant="secondary" size="sm" onClick={() => setStatus('confirmed')}>
                  Confirmer
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'billing' && (
        <InvoiceBillingTab
          appointment={appointment}
          clients={clients}
          selectedClients={selectedClients as Client[]}
          service={selectedService}
          professionalId={selectedProfessionalId ?? null}
          onInvoiceCreated={(invoiceId) => {
            setSelectedInvoiceId(invoiceId)
            setShowInvoiceDrawer(true)
          }}
          onViewInvoice={(invoiceId) => {
            setSelectedInvoiceId(invoiceId)
            setShowInvoiceDrawer(true)
          }}
        />
      )}

      {activeTab === 'history' && !isNew && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <History className="h-4 w-4 text-foreground-muted" />
            Historique des modifications
          </div>
          <div className="rounded-lg border border-border bg-background-secondary/30 p-3">
            <CompactCalendarHistory
              auditLog={auditLog}
              isLoading={auditLoading}
              emptyMessage="L'historique apparaîtra ici après la première modification."
            />
          </div>
        </div>
      )}

      {/* Expandable details section */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between p-3 bg-background-secondary hover:bg-background-tertiary transition-colors"
        >
          <span className="text-sm font-medium text-foreground-muted">Modifier les détails</span>
          {showDetails ? (
            <ChevronUp className="h-4 w-4 text-foreground-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 text-foreground-muted" />
          )}
        </button>

        {showDetails && (
          <div className="p-4 space-y-4 border-t border-border">
            {/* Date & Time inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="date" className="text-xs">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={isCancelled}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="startTime" className="text-xs">Heure</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={isCancelled}
                  step={1800}
                  className="h-9"
                />
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <Label htmlFor="duration" className="text-xs">Durée (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min={15}
                max={240}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 50)}
                disabled={isCancelled}
                className="h-9"
              />
            </div>

            {/* Mode selector */}
            {!isCancelled && (
              <div className="space-y-1.5">
                <Label className="text-xs">Modalité</Label>
                <div className="flex gap-2">
                  {MODE_OPTIONS.map(opt => {
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setMode(opt.value)}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all',
                          mode === opt.value
                            ? 'border-sage-400 bg-sage-50 text-sage-700'
                            : 'border-border hover:border-sage-300'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Status selector */}
            {!isCancelled && (
              <div className="space-y-1.5">
                <Label className="text-xs">Statut</Label>
                <div className="flex gap-2">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(opt.value)}
                      className={cn(
                        'flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all',
                        status === opt.value
                          ? opt.value === 'created'
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-sage-400 bg-sage-50 text-sage-700'
                          : 'border-border hover:border-sage-300'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs">Notes internes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes visibles uniquement par l'équipe..."
                rows={2}
                disabled={isCancelled}
                className="text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {!isCancelled && (
          <>
            <Button
              onClick={handleSave}
              className="flex-1"
              disabled={!clientCountValid}
            >
              {isNew ? 'Créer' : 'Enregistrer'}
            </Button>
            {!isNew && onCancelAppointment && (
              <Button
                variant="outline"
                onClick={() => setShowCancelDialog(true)}
                className="text-wine-600 hover:bg-wine-50"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Fermer
        </Button>
      </div>
      {canCancelAppointment && (
        <p className="text-xs text-foreground-muted">
          Annulation gérée par la clinique ou le professionnel.{' '}
          {isLateCancel ? 'Moins de 24 h : décider des frais d\'annulation.' : 'Annulation standard (≥ 24 h).'}
        </p>
      )}

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler ce rendez-vous ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action annule le rendez-vous. Si le rendez-vous est à moins de 24 h, choisissez si des frais s'appliquent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancelReason" className="text-xs">Raison (optionnelle)</Label>
            <Textarea
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ex: Client indisponible..."
              rows={3}
            />
          </div>
          {isLateCancel && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-background-secondary/30 p-3">
              <div className="text-xs font-medium text-foreground">Frais d'annulation</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCancelFeeApplied(false)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                    !cancelFeeApplied
                      ? 'border-sage-400 bg-sage-50 text-sage-700'
                      : 'border-border hover:border-sage-300'
                  )}
                >
                  Aucun frais
                </button>
                <button
                  type="button"
                  onClick={() => setCancelFeeApplied(true)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                    cancelFeeApplied
                      ? 'border-sage-400 bg-sage-50 text-sage-700'
                      : 'border-border hover:border-sage-300'
                  )}
                >
                  Appliquer des frais
                </button>
              </div>
              {cancelFeeApplied && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="cancelFeePercentDialog" className="text-xs">
                    Pourcentage
                  </Label>
                  <Input
                    id="cancelFeePercentDialog"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={cancelFeePercent}
                    onChange={(e) => setCancelFeePercent(Number(e.target.value))}
                    className="h-8 w-20 text-xs"
                  />
                  <span className="text-xs text-foreground-muted">%</span>
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Retour</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onCancelAppointment?.({
                  reason: cancelReason.trim() || undefined,
                  feeApplied: isLateCancel ? cancelFeeApplied : undefined,
                  feePercent: isLateCancel && cancelFeeApplied ? normalizedCancelFeePercent : undefined,
                })
                setCancelReason('')
                setShowCancelDialog(false)
              }}
            >
              Confirmer l'annulation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoice Drawer */}
      <InvoiceDrawer
        invoiceId={selectedInvoiceId}
        open={showInvoiceDrawer}
        onClose={() => {
          setShowInvoiceDrawer(false)
          setSelectedInvoiceId(null)
        }}
      />

      {/* Client Drawer */}
      <ClientDrawer
        clientId={selectedClientId}
        isOpen={showClientDrawer}
        onClose={() => {
          setShowClientDrawer(false)
          setSelectedClientId(null)
        }}
        onViewClient={(clientId) => {
          setSelectedClientId(clientId)
        }}
      />
    </div>
  )
}
