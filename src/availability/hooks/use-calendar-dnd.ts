// src/availability/hooks/use-calendar-dnd.ts

import { useState, useCallback, useMemo, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  getMinutesFromPointer,
  normalizeRange,
  DEFAULT_CONFIG,
  type TimeGridConfig,
  getMinDuration,
  getMaxAppointmentDuration,
} from '../utils/time-grid'

// =============================================================================
// Types
// =============================================================================

export type DragContext =
  | 'idle'
  | 'create-availability'
  | 'move-availability'
  | 'resize-availability'
  | 'move-appointment'
  | 'resize-appointment'
  | 'service-drop'

export interface DragPreview {
  dayIndex: number
  startMinutes: number
  endMinutes: number
}

export interface DragState {
  context: DragContext
  activeId: string | null
  overDayIndex: number | null
  anchorMinutes: number | null
  resizeEdge: 'top' | 'bottom' | null
  originalStartMinutes: number | null
  originalEndMinutes: number | null
  pointerStartY: number | null
  preview: DragPreview | null
}

export interface CalendarDndCallbacks {
  onAvailabilityCreate: (dayIndex: number, startMinutes: number, endMinutes: number) => void
  onAvailabilityMove: (blockId: string, dayIndex: number, newStartMinutes: number) => void
  onAvailabilityResize: (blockId: string, dayIndex: number, edge: 'top' | 'bottom', newMinutesAbs: number) => void
  onAppointmentMove: (aptId: string, dayIndex: number, newStartMinutes: number) => void
  onAppointmentResize: (aptId: string, dayIndex: number, edge: 'top' | 'bottom', newMinutesAbs: number) => void
  onServiceDrop: (serviceId: string, dayIndex: number, startMinutes: number) => void
}

export interface UseCalendarDndOptions {
  callbacks: CalendarDndCallbacks
  config?: TimeGridConfig
  /** Get the original block data for computing resize previews */
  getAvailabilityBlock?: (id: string) => { startMinutes: number; endMinutes: number } | null
  getAppointment?: (id: string) => { startMinutes: number; durationMinutes: number } | null
}

// =============================================================================
// ID Parsing Utilities
// =============================================================================

interface ParsedDraggableId {
  type: 'availability' | 'appointment' | 'service' | 'create-slot' | 'unknown'
  id: string
  isResize: boolean
  resizeEdge: 'top' | 'bottom' | null
}

function parseDraggableId(id: string): ParsedDraggableId {
  // Format: avail-{id}, avail-{id}:resize-top, avail-{id}:resize-bottom
  // Format: apt-{id}, apt-{id}:resize-top, apt-{id}:resize-bottom
  // Format: service-{id}
  // Format: create-slot-{dayIndex}

  if (id.startsWith('avail-')) {
    const rest = id.slice(6) // Remove 'avail-'
    if (rest.includes(':resize-top')) {
      return { type: 'availability', id: rest.replace(':resize-top', ''), isResize: true, resizeEdge: 'top' }
    }
    if (rest.includes(':resize-bottom')) {
      return { type: 'availability', id: rest.replace(':resize-bottom', ''), isResize: true, resizeEdge: 'bottom' }
    }
    return { type: 'availability', id: rest, isResize: false, resizeEdge: null }
  }

  if (id.startsWith('apt-')) {
    const rest = id.slice(4) // Remove 'apt-'
    if (rest.includes(':resize-top')) {
      return { type: 'appointment', id: rest.replace(':resize-top', ''), isResize: true, resizeEdge: 'top' }
    }
    if (rest.includes(':resize-bottom')) {
      return { type: 'appointment', id: rest.replace(':resize-bottom', ''), isResize: true, resizeEdge: 'bottom' }
    }
    return { type: 'appointment', id: rest, isResize: false, resizeEdge: null }
  }

  if (id.startsWith('service-')) {
    return { type: 'service', id: id.slice(8), isResize: false, resizeEdge: null }
  }

  if (id.startsWith('create-slot-')) {
    return { type: 'create-slot', id: id.slice(12), isResize: false, resizeEdge: null }
  }

  return { type: 'unknown', id, isResize: false, resizeEdge: null }
}

function parseDroppableId(id: string | null): number | null {
  if (!id) return null
  // Format: day-{index}
  if (id.startsWith('day-')) {
    const index = parseInt(id.slice(4), 10)
    return isNaN(index) ? null : index
  }
  return null
}

// =============================================================================
// Hook
// =============================================================================

const INITIAL_STATE: DragState = {
  context: 'idle',
  activeId: null,
  overDayIndex: null,
  anchorMinutes: null,
  resizeEdge: null,
  originalStartMinutes: null,
  originalEndMinutes: null,
  pointerStartY: null,
  preview: null,
}

export function useCalendarDnd({
  callbacks,
  config = DEFAULT_CONFIG,
  getAvailabilityBlock,
  getAppointment,
}: UseCalendarDndOptions) {
  const [state, setState] = useState<DragState>(INITIAL_STATE)

  // Store refs to day column elements for position calculations
  const dayColumnRefs = useRef<Map<number, HTMLElement>>(new Map())

  // Register a day column ref
  const registerDayColumn = useCallback((dayIndex: number, element: HTMLElement | null) => {
    if (element) {
      dayColumnRefs.current.set(dayIndex, element)
    } else {
      dayColumnRefs.current.delete(dayIndex)
    }
  }, [])

  // Sensors configuration - 6px activation threshold
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  )

  // =============================================================================
  // Event Handlers
  // =============================================================================

  const getSnappedDeltaMinutes = useCallback(
    (deltaY: number) => {
      const slots = deltaY / config.slotHeight
      const snappedSlots = slots >= 0 ? Math.floor(slots) : Math.ceil(slots)
      return snappedSlots * config.intervalMinutes
    },
    [config]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const parsed = parseDraggableId(active.id as string)

      // Determine context based on what's being dragged
      let context: DragContext = 'idle'
      let originalStartMinutes: number | null = null
      let originalEndMinutes: number | null = null
      let anchorMinutes: number | null = null
      let pointerStartY: number | null = null
      const pointerClientY =
        event.activatorEvent && 'clientY' in event.activatorEvent
          ? (event.activatorEvent as MouseEvent).clientY
          : null
      pointerStartY = pointerClientY

      if (parsed.type === 'create-slot') {
        context = 'create-availability'
        // Capture the initial pointer position from the activator event
        const dayIndex = parseInt(parsed.id, 10)
        const column = dayColumnRefs.current.get(dayIndex)
        if (column && pointerClientY !== null) {
          const rect = column.getBoundingClientRect()
          anchorMinutes = getMinutesFromPointer(pointerClientY, rect, config)
        }
      } else if (parsed.type === 'availability') {
        if (parsed.isResize) {
          context = 'resize-availability'
          const block = getAvailabilityBlock?.(parsed.id)
          if (block) {
            originalStartMinutes = block.startMinutes
            originalEndMinutes = block.endMinutes
          }
        } else {
          context = 'move-availability'
          const block = getAvailabilityBlock?.(parsed.id)
          if (block) {
            originalStartMinutes = block.startMinutes
            originalEndMinutes = block.endMinutes
          }
        }
      } else if (parsed.type === 'appointment') {
        if (parsed.isResize) {
          context = 'resize-appointment'
          const apt = getAppointment?.(parsed.id)
          if (apt) {
            originalStartMinutes = apt.startMinutes
            originalEndMinutes = apt.startMinutes + apt.durationMinutes
          }
        } else {
          context = 'move-appointment'
          const apt = getAppointment?.(parsed.id)
          if (apt) {
            originalStartMinutes = apt.startMinutes
            originalEndMinutes = apt.startMinutes + apt.durationMinutes
          }
        }
      } else if (parsed.type === 'service') {
        context = 'service-drop'
      }

      setState({
        context,
        activeId: parsed.id,
        overDayIndex: null,
        anchorMinutes,
        resizeEdge: parsed.resizeEdge,
        originalStartMinutes,
        originalEndMinutes,
        pointerStartY,
        preview: null,
      })
    },
    [getAvailabilityBlock, getAppointment, config]
  )

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event
      const dayIndex = parseDroppableId(over?.id as string)

      if (dayIndex === null) {
        // Not over a valid day column
        setState(prev => ({ ...prev, overDayIndex: null, preview: null }))
        return
      }

      // Use delta to calculate current position
      const delta = event.delta
      const initialRect = active.rect.current.initial
      if (!initialRect) return

      // Calculate current pointer Y position
      // We need to get the actual clientY from the event
      // Since dnd-kit doesn't give us direct access, we use a workaround
      const column = dayColumnRefs.current.get(dayIndex)
      if (!column) return

      const rect = column.getBoundingClientRect()

      setState(prev => {
        let preview: DragPreview | null = null

        if (prev.context === 'create-availability') {
          const anchorY = prev.pointerStartY ?? initialRect.top
          const anchor = prev.anchorMinutes ?? getMinutesFromPointer(anchorY, rect, config)
          const currentMinutes = getMinutesFromPointer(anchorY + delta.y, rect, config)
          const range = normalizeRange(anchor, currentMinutes, config)
          // Ensure minimum duration
          const minDuration = getMinDuration('availability')
          if (range.endMinutes - range.startMinutes < minDuration) {
            range.endMinutes = range.startMinutes + minDuration
          }
          preview = { dayIndex, ...range }
          return { ...prev, overDayIndex: dayIndex, preview }
        }

        if (prev.context === 'move-availability' || prev.context === 'move-appointment') {
          // For moves, use the delta to shift from original position
          const duration = (prev.originalEndMinutes ?? 0) - (prev.originalStartMinutes ?? 0)
          const deltaMinutes = getSnappedDeltaMinutes(delta.y)
          const newStart = (prev.originalStartMinutes ?? 0) + deltaMinutes
          const newEnd = newStart + duration
          preview = { dayIndex, startMinutes: newStart, endMinutes: newEnd }
          return { ...prev, overDayIndex: dayIndex, preview }
        }

        if (prev.context === 'resize-availability' || prev.context === 'resize-appointment') {
          const minDuration = getMinDuration(prev.context === 'resize-availability' ? 'availability' : 'appointment')
          const maxDuration = prev.context === 'resize-appointment' ? getMaxAppointmentDuration() : Infinity

          let newStart = prev.originalStartMinutes ?? 0
          let newEnd = prev.originalEndMinutes ?? 0

          // Use delta to calculate the change in minutes
          const deltaMinutes = getSnappedDeltaMinutes(delta.y)

          if (prev.resizeEdge === 'top') {
            // Moving start time, end stays fixed
            newStart = Math.min((prev.originalStartMinutes ?? 0) + deltaMinutes, newEnd - minDuration)
          } else {
            // Moving end time, start stays fixed
            newEnd = Math.max((prev.originalEndMinutes ?? 0) + deltaMinutes, newStart + minDuration)
            // Apply max duration for appointments
            if (newEnd - newStart > maxDuration) {
              newEnd = newStart + maxDuration
            }
          }

          preview = { dayIndex, startMinutes: newStart, endMinutes: newEnd }
          return { ...prev, overDayIndex: dayIndex, preview }
        }

        if (prev.context === 'service-drop') {
          // Service drop preview - align to pointer position
          const currentY = (prev.pointerStartY ?? initialRect.top) + delta.y
          const minutes = getMinutesFromPointer(currentY, rect, config)
          const serviceDuration = (active.data.current as { service?: { durationMinutes?: number } } | undefined)
            ?.service?.durationMinutes
          const duration = serviceDuration ?? 60
          preview = { dayIndex, startMinutes: minutes, endMinutes: minutes + duration }
          return { ...prev, overDayIndex: dayIndex, preview }
        }

        return { ...prev, overDayIndex: dayIndex }
      })
    },
    [config, getSnappedDeltaMinutes]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      const parsed = parseDraggableId(active.id as string)
      const dayIndex = parseDroppableId(over?.id as string)

      // Get final state before resetting
      const { context, preview, resizeEdge } = state

      // Reset state
      setState(INITIAL_STATE)

      // No valid drop target
      if (dayIndex === null || !preview) return

      // Call appropriate callback
      switch (context) {
        case 'create-availability':
          if (preview.endMinutes > preview.startMinutes) {
            callbacks.onAvailabilityCreate(dayIndex, preview.startMinutes, preview.endMinutes)
          }
          break

        case 'move-availability':
          callbacks.onAvailabilityMove(parsed.id, dayIndex, preview.startMinutes)
          break

        case 'resize-availability':
          if (resizeEdge) {
            const newMinutes = resizeEdge === 'top' ? preview.startMinutes : preview.endMinutes
            callbacks.onAvailabilityResize(parsed.id, dayIndex, resizeEdge, newMinutes)
          }
          break

        case 'move-appointment':
          callbacks.onAppointmentMove(parsed.id, dayIndex, preview.startMinutes)
          break

        case 'resize-appointment':
          if (resizeEdge) {
            const newMinutes = resizeEdge === 'top' ? preview.startMinutes : preview.endMinutes
            callbacks.onAppointmentResize(parsed.id, dayIndex, resizeEdge, newMinutes)
          }
          break

        case 'service-drop':
          callbacks.onServiceDrop(parsed.id, dayIndex, preview.startMinutes)
          break
      }
    },
    [state, callbacks]
  )

  const handleDragCancel = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  // =============================================================================
  // Return Value
  // =============================================================================

  return useMemo(
    () => ({
      // State
      dragState: state,
      isDragging: state.context !== 'idle',

      // Sensors
      sensors,

      // Event handlers for DndContext
      onDragStart: handleDragStart,
      onDragMove: handleDragMove,
      onDragEnd: handleDragEnd,
      onDragCancel: handleDragCancel,

      // Day column registration
      registerDayColumn,

      // Preview for overlay
      preview: state.preview,
    }),
    [state, sensors, handleDragStart, handleDragMove, handleDragEnd, handleDragCancel, registerDayColumn]
  )
}

// Re-export DndContext for convenience
export { DndContext }
