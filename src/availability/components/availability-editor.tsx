// src/availability/components/availability-editor.tsx

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Checkbox } from '@/shared/ui/checkbox'
import { cn } from '@/shared/lib/utils'
import type { AvailabilityBlock, AvailabilityType } from '../types'

interface AvailabilityEditorProps {
  block: AvailabilityBlock | null
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
  onSave,
  onDelete,
  onCancel,
  onDirtyChange,
}: AvailabilityEditorProps) {
  const isNew = !block?.id || block.id.startsWith('new-')

  const [type, setType] = useState<AvailabilityType>(block?.type || 'available')
  const [label, setLabel] = useState(block?.label || '')
  const [date, setDate] = useState(
    block ? format(new Date(block.startTime), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  )
  const [startTime, setStartTime] = useState(
    block ? format(new Date(block.startTime), 'HH:mm') : '09:00'
  )
  const [endTime, setEndTime] = useState(
    block ? format(new Date(block.endTime), 'HH:mm') : '17:00'
  )
  const [visibleToClients, setVisibleToClients] = useState(block?.visibleToClients ?? true)

  // Track dirty state
  useEffect(() => {
    if (!block) {
      onDirtyChange(true)
      return
    }

    const isDirty =
      type !== block.type ||
      label !== (block.label || '') ||
      date !== format(new Date(block.startTime), 'yyyy-MM-dd') ||
      startTime !== format(new Date(block.startTime), 'HH:mm') ||
      endTime !== format(new Date(block.endTime), 'HH:mm') ||
      visibleToClients !== block.visibleToClients

    onDirtyChange(isDirty)
  }, [type, label, date, startTime, endTime, visibleToClients, block, onDirtyChange])

  const handleSave = () => {
    const startDateTime = new Date(`${date}T${startTime}:00`)
    const endDateTime = new Date(`${date}T${endTime}:00`)

    onSave({
      type,
      label: label || undefined,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
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
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime">Fin</Label>
          <Input
            id="endTime"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
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

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-border">
        <Button onClick={handleSave} className="flex-1">
          {isNew ? 'Creer' : 'Enregistrer'}
        </Button>
        {!isNew && onDelete && (
          <Button variant="outline" onClick={onDelete} className="text-wine-600">
            Supprimer
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  )
}
