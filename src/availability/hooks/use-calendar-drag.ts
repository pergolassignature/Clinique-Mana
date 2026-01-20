// src/availability/hooks/use-calendar-drag.ts

import { useState, useCallback, useRef } from 'react'
import type { DragState, TimeRange } from '../types'

interface UseCalendarDragOptions {
  slotHeight: number
  intervalMinutes: number
  startHour: number
  onCreateDrag: (dayIndex: number, timeRange: TimeRange) => void
  onMoveDrag: (appointmentId: string, newStartMinutes: number, dayIndex: number) => void
  onResizeDrag: (appointmentId: string, newDuration: number) => void
}

export function useCalendarDrag({
  slotHeight,
  intervalMinutes,
  startHour,
  onCreateDrag,
  onMoveDrag,
  onResizeDrag,
}: UseCalendarDragOptions) {
  const [dragState, setDragState] = useState<DragState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Convert Y position to minutes from start of day
  const yToMinutes = useCallback(
    (y: number): number => {
      const slots = y / slotHeight
      const minutes = slots * intervalMinutes + startHour * 60
      // Snap to nearest interval
      return Math.round(minutes / intervalMinutes) * intervalMinutes
    },
    [slotHeight, intervalMinutes, startHour]
  )

  // Start drag-to-create
  const startCreateDrag = useCallback(
    (e: React.PointerEvent, dayIndex: number) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const y = e.clientY - rect.top

      setDragState({
        type: 'create',
        startY: y,
        currentY: y,
        dayIndex,
      })

      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    []
  )

  // Start drag-to-move
  const startMoveDrag = useCallback(
    (e: React.PointerEvent, appointmentId: string, dayIndex: number) => {
      e.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const y = e.clientY - rect.top

      setDragState({
        type: 'move',
        startY: y,
        currentY: y,
        dayIndex,
        appointmentId,
      })
    },
    []
  )

  // Start resize
  const startResizeDrag = useCallback(
    (e: React.PointerEvent, appointmentId: string, dayIndex: number, edge: 'top' | 'bottom') => {
      e.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const y = e.clientY - rect.top

      setDragState({
        type: 'resize',
        startY: y,
        currentY: y,
        dayIndex,
        appointmentId,
        resizeEdge: edge,
      })
    },
    []
  )

  // Handle pointer move
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const y = e.clientY - rect.top

      setDragState(prev => (prev ? { ...prev, currentY: y } : null))
    },
    [dragState]
  )

  // Handle pointer up - finalize drag
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return

      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)

      const { type, startY, currentY, dayIndex, appointmentId } = dragState

      if (type === 'create') {
        const startMinutes = yToMinutes(Math.min(startY, currentY))
        const endMinutes = yToMinutes(Math.max(startY, currentY))
        const duration = endMinutes - startMinutes

        if (duration >= intervalMinutes) {
          onCreateDrag(dayIndex, { startMinutes, endMinutes })
        }
      } else if (type === 'move' && appointmentId) {
        const deltaY = currentY - startY
        const deltaMinutes = Math.round(deltaY / slotHeight) * intervalMinutes
        const newStartMinutes = yToMinutes(startY) + deltaMinutes
        onMoveDrag(appointmentId, newStartMinutes, dayIndex)
      } else if (type === 'resize' && appointmentId) {
        const deltaY = currentY - startY
        const deltaMinutes = Math.round(deltaY / slotHeight) * intervalMinutes
        // Note: actual resize logic depends on which edge and current duration
        onResizeDrag(appointmentId, Math.abs(deltaMinutes))
      }

      setDragState(null)
    },
    [dragState, yToMinutes, intervalMinutes, slotHeight, onCreateDrag, onMoveDrag, onResizeDrag]
  )

  // Get preview rectangle for create drag
  const getCreatePreview = useCallback(() => {
    if (!dragState || dragState.type !== 'create') return null

    const top = Math.min(dragState.startY, dragState.currentY)
    const height = Math.abs(dragState.currentY - dragState.startY)

    return { top, height, dayIndex: dragState.dayIndex }
  }, [dragState])

  return {
    dragState,
    containerRef,
    startCreateDrag,
    startMoveDrag,
    startResizeDrag,
    handlePointerMove,
    handlePointerUp,
    getCreatePreview,
    isDragging: dragState !== null,
  }
}
