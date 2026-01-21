// src/availability/components/availability-editor.tsx

import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  getClinicDateString,
  getClinicTimeString,
  clinicTimeToUTC,
} from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Checkbox } from '@/shared/ui/checkbox'
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
import type { AvailabilityBlock, AvailabilityType, Appointment } from '../types'

interface AvailabilityEditorProps {
  block: AvailabilityBlock | null
  /** All appointments to check for conflicts */
  appointments?: Appointment[]
  onSave: (data: Partial<AvailabilityBlock>) => void
  onDelete?: () => void
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}

const TYPES: { value: AvailabilityType; label: string }[] = [
  { value: 'available', label: 'Disponible' },
  { value: 'break', label: 'Pause' },
  { value: 'blocked', label: 'Bloque' },
  { value: 'vacation', label: 'Vacances' },
]

export function AvailabilityEditor({
  block,
  appointments = [],
  onSave,
  onDelete,
  onCancel,
  onDirtyChange,
}: AvailabilityEditorProps) {
  const isNew = !block?.id || block.id.startsWith('new-')

  const [type, setType] = useState<AvailabilityType>(block?.type || 'available')
  const [label, setLabel] = useState(block?.label || '')
  const [date, setDate] = useState(
    block ? getClinicDateString(block.startTime) : getClinicDateString(new Date())
  )
  const [startTime, setStartTime] = useState(
    block ? getClinicTimeString(block.startTime) : '09:00'
  )
  const [endTime, setEndTime] = useState(
    block ? getClinicTimeString(block.endTime) : '17:00'
  )
  const [visibleToClients, setVisibleToClients] = useState(block?.visibleToClients ?? true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Check for appointments that overlap with this block
  const conflictingAppointments = useMemo(() => {
    if (!block) return []
    const blockStart = new Date(block.startTime).getTime()
    const blockEnd = new Date(block.endTime).getTime()

    return appointments.filter(apt => {
      if (apt.status === 'cancelled') return false
      const aptStart = new Date(apt.startTime).getTime()
      const aptEnd = aptStart + apt.durationMinutes * 60000
      // Check if appointment overlaps with block
      return aptStart < blockEnd && aptEnd > blockStart
    })
  }, [block, appointments])

  // Track dirty state
  useEffect(() => {
    if (!block) {
      onDirtyChange(true)
      return
    }

    const isDirty =
      type !== block.type ||
      label !== (block.label || '') ||
      date !== getClinicDateString(block.startTime) ||
      startTime !== getClinicTimeString(block.startTime) ||
      endTime !== getClinicTimeString(block.endTime) ||
      visibleToClients !== block.visibleToClients

    onDirtyChange(isDirty)
  }, [type, label, date, startTime, endTime, visibleToClients, block, onDirtyChange])

  const handleSave = () => {
    // Convert clinic time to UTC for storage
    const startTimeUTC = clinicTimeToUTC(date, startTime)
    const endTimeUTC = clinicTimeToUTC(date, endTime)

    onSave({
      type,
      label: label || undefined,
      startTime: startTimeUTC,
      endTime: endTimeUTC,
      visibleToClients,
    })
  }

  return (
    <div className="space-y-6">
      {/* Type selector */}
      <div className="space-y-2">
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={cn(
                'px-3 py-2 text-sm font-medium rounded-lg border transition-all',
                type === t.value
                  ? 'border-sage-400 bg-sage-50 text-sage-700'
                  : 'border-border hover:border-sage-300'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Label */}
      {type !== 'available' && (
        <div className="space-y-2">
          <Label htmlFor="label">Libelle (optionnel)</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Pause diner, Formation..."
          />
        </div>
      )}

      {/* Date */}
      <div className="space-y-2">
        <Label htmlFor="date">Date</Label>
        <Input
          id="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {/* Time range */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startTime">Debut</Label>
          <Input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            step={1800}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime">Fin</Label>
          <Input
            id="endTime"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            step={1800}
          />
        </div>
      </div>

      {/* Visible to clients */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="visibleToClients"
          checked={visibleToClients}
          onCheckedChange={(checked) => setVisibleToClients(checked === true)}
        />
        <Label htmlFor="visibleToClients" className="text-sm font-normal cursor-pointer">
          Visible aux clients
        </Label>
      </div>

      {/* Conflict warning */}
      {conflictingAppointments.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-amber-800">
              {conflictingAppointments.length} rendez-vous dans ce créneau
            </div>
            <div className="text-xs text-amber-700 mt-0.5">
              La suppression de cette disponibilité n'affectera pas les rendez-vous existants.
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-border">
        <Button onClick={handleSave} className="flex-1">
          {isNew ? 'Créer' : 'Enregistrer'}
        </Button>
        {!isNew && onDelete && (
          <Button
            variant="outline"
            onClick={() => {
              if (conflictingAppointments.length > 0) {
                setShowDeleteConfirm(true)
              } else {
                onDelete()
              }
            }}
            className="text-wine-600"
          >
            Supprimer
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette disponibilité ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Ce créneau contient <strong>{conflictingAppointments.length} rendez-vous</strong> qui
                ne seront pas supprimés.
              </span>
              <span className="block text-amber-600">
                Les rendez-vous existants resteront visibles mais ne seront plus dans une plage de disponibilité.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDeleteConfirm(false)
                onDelete?.()
              }}
              className="bg-wine-600 hover:bg-wine-700"
            >
              Supprimer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
