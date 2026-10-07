# Disponibilités UI v2 — Premium Calendar Upgrade

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the availability calendar into a premium SaaS-quality experience with drag interactions, sidebar navigation, and polished styling.

**Architecture:** Split layout into sidebar + main content. Introduce view switcher (Day/Week/List). Add pointer event handlers for drag-to-create, drag-to-move, and resize. Enhance appointment blocks with resize handles and hover states.

**Tech Stack:** React 18, TypeScript, Framer Motion (already installed), native PointerEvents, Tailwind CSS, Radix UI components.

---

## Task 1: Update Types for View State and Drag Interactions

**Files:**
- Modify: `src/availability/types.ts`

**Step 1: Add new types for view mode and drag state**

```typescript
// Add to existing types.ts

export type CalendarViewMode = 'day' | 'week' | 'list'

export interface DragState {
  type: 'create' | 'move' | 'resize'
  startY: number
  currentY: number
  dayIndex: number
  appointmentId?: string
  resizeEdge?: 'top' | 'bottom'
}

export interface TimeRange {
  startMinutes: number // minutes from midnight
  endMinutes: number
}
```

**Step 2: Update CalendarViewState**

```typescript
export interface CalendarViewState {
  selectedProfessionalId: string | null
  viewDate: Date // anchor date for current view
  viewMode: CalendarViewMode
}
```

**Step 3: Commit**

```bash
git add src/availability/types.ts
git commit -m "feat(availability): add types for view modes and drag interactions"
```

---

## Task 2: Create Sidebar Component with Agenda and Filters

**Files:**
- Create: `src/availability/components/calendar-sidebar.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create CalendarSidebar component**

```typescript
// src/availability/components/calendar-sidebar.tsx

import { useMemo } from 'react'
import { format, isToday, isTomorrow, startOfDay, isSameDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Service, Client, CalendarViewMode } from '../types'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'
import { t } from '@/i18n'

interface CalendarSidebarProps {
  appointments: Appointment[]
  viewDate: Date
  viewMode: CalendarViewMode
  onViewModeChange: (mode: CalendarViewMode) => void
  onAppointmentClick: (appointment: Appointment) => void
}

function getDateLabel(date: Date): string {
  if (isToday(date)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return format(date, 'EEEE d MMMM', { locale: fr })
}

export function CalendarSidebar({
  appointments,
  viewDate,
  viewMode,
  onViewModeChange,
  onAppointmentClick,
}: CalendarSidebarProps) {
  // Get upcoming appointments (today + next 7 days)
  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date())
    return appointments
      .filter(apt => {
        const aptDate = new Date(apt.startTime)
        return aptDate >= today && apt.status === 'scheduled'
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 10)
  }, [appointments])

  // Group by day
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    upcomingAppointments.forEach(apt => {
      const dayKey = format(new Date(apt.startTime), 'yyyy-MM-dd')
      if (!groups.has(dayKey)) groups.set(dayKey, [])
      groups.get(dayKey)!.push(apt)
    })
    return groups
  }, [upcomingAppointments])

  const getService = (id: string) => MOCK_SERVICES.find(s => s.id === id)
  const getClient = (id: string) => MOCK_CLIENTS.find(c => c.id === id)

  return (
    <aside className="w-72 border-r border-border bg-background-secondary/30 flex flex-col h-full">
      {/* View mode toggle */}
      <div className="p-4 border-b border-border">
        <div className="flex rounded-lg bg-background-tertiary/50 p-1">
          {(['day', 'week', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                viewMode === mode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {mode === 'day' && 'Jour'}
              {mode === 'week' && 'Semaine'}
              {mode === 'list' && 'Liste'}
            </button>
          ))}
        </div>
      </div>

      {/* Agenda list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          À venir
        </h3>

        {upcomingAppointments.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun rendez-vous à venir</p>
        ) : (
          <div className="space-y-4">
            {Array.from(groupedByDay.entries()).map(([dayKey, dayApts]) => (
              <div key={dayKey}>
                <div className="text-xs font-medium text-foreground-secondary mb-2">
                  {getDateLabel(new Date(dayApts[0].startTime))}
                </div>
                <div className="space-y-1.5">
                  {dayApts.map(apt => {
                    const service = getService(apt.serviceId)
                    const client = getClient(apt.clientId)
                    return (
                      <button
                        key={apt.id}
                        onClick={() => onAppointmentClick(apt)}
                        className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full"
                            style={{ backgroundColor: service?.colorHex || '#888' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {client ? `${client.firstName} ${client.lastName}` : 'Client'}
                            </div>
                            <div className="text-xs text-foreground-muted">
                              {format(new Date(apt.startTime), 'HH:mm')} · {service?.nameFr}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="p-4 border-t border-border bg-background-tertiary/30">
        <div className="text-xs text-foreground-muted">
          {upcomingAppointments.length} rendez-vous à venir
        </div>
      </div>
    </aside>
  )
}
```

**Step 2: Export from index**

Add to `src/availability/components/index.ts`:
```typescript
export { CalendarSidebar } from './calendar-sidebar'
```

**Step 3: Commit**

```bash
git add src/availability/components/calendar-sidebar.tsx src/availability/components/index.ts
git commit -m "feat(availability): add sidebar with agenda list and view toggle"
```

---

## Task 3: Create "Now" Line Indicator Component

**Files:**
- Create: `src/availability/components/now-line.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create NowLine component**

```typescript
// src/availability/components/now-line.tsx

import { useEffect, useState } from 'react'
import { isToday } from 'date-fns'

interface NowLineProps {
  dayDate: Date
  startHour: number
  slotHeight: number
  intervalMinutes: number
}

export function NowLine({ dayDate, startHour, slotHeight, intervalMinutes }: NowLineProps) {
  const [position, setPosition] = useState<number | null>(null)

  useEffect(() => {
    if (!isToday(dayDate)) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const now = new Date()
      const currentMinutes = now.getHours() * 60 + now.getMinutes()
      const startMinutes = startHour * 60
      const minutesFromStart = currentMinutes - startMinutes

      if (minutesFromStart < 0 || minutesFromStart > 16 * 60) {
        setPosition(null)
        return
      }

      const pos = (minutesFromStart / intervalMinutes) * slotHeight
      setPosition(pos)
    }

    updatePosition()
    const interval = setInterval(updatePosition, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [dayDate, startHour, slotHeight, intervalMinutes])

  if (position === null) return null

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
      style={{ top: `${position}px` }}
    >
      <div className="w-2 h-2 rounded-full bg-wine-500 -ml-1" />
      <div className="flex-1 h-0.5 bg-wine-500" />
    </div>
  )
}
```

**Step 2: Export from index**

Add to `src/availability/components/index.ts`:
```typescript
export { NowLine } from './now-line'
```

**Step 3: Commit**

```bash
git add src/availability/components/now-line.tsx src/availability/components/index.ts
git commit -m "feat(availability): add 'now' time indicator line"
```

---

## Task 4: Create Drag Interaction Hook

**Files:**
- Create: `src/availability/hooks/use-calendar-drag.ts`
- Modify: `src/availability/hooks/index.ts`

**Step 1: Create the drag hook**

```typescript
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

      const { type, startY, currentY, dayIndex, appointmentId, resizeEdge } = dragState

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
```

**Step 2: Export from index**

Add to `src/availability/hooks/index.ts`:
```typescript
export { useCalendarDrag } from './use-calendar-drag'
```

**Step 3: Commit**

```bash
git add src/availability/hooks/use-calendar-drag.ts src/availability/hooks/index.ts
git commit -m "feat(availability): add drag interaction hook for create/move/resize"
```

---

## Task 5: Upgrade AppointmentBlock with Resize Handles

**Files:**
- Modify: `src/availability/components/appointment-block.tsx`

**Step 1: Add resize handles and drag cursor**

Replace the entire file with:

```typescript
// src/availability/components/appointment-block.tsx

import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Service, Client } from '../types'

interface AppointmentBlockProps {
  appointment: Appointment
  service?: Service
  client?: Client
  onClick: () => void
  onDragStart?: (e: React.PointerEvent) => void
  onResizeStart?: (e: React.PointerEvent, edge: 'top' | 'bottom') => void
  isDragging?: boolean
}

export function AppointmentBlock({
  appointment,
  service,
  client,
  onClick,
  onDragStart,
  onResizeStart,
  isDragging,
}: AppointmentBlockProps) {
  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)
  const isCancelled = appointment.status === 'cancelled'

  const clientName = client
    ? `${client.firstName} ${client.lastName}`
    : 'Client inconnu'

  // Calculate if we have enough height for full display
  const isCompact = appointment.durationMinutes <= 30
  const showResizeHandles = !isCancelled && appointment.durationMinutes > 30

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger click if we just finished dragging
    if (isDragging) {
      e.preventDefault()
      return
    }
    onClick()
  }

  return (
    <div
      className={cn(
        'group w-full h-full rounded-lg text-left transition-all relative',
        'border shadow-sm hover:shadow-md',
        isDragging && 'shadow-lg ring-2 ring-sage-400 opacity-90',
        isCancelled
          ? 'bg-background-tertiary/60 border-border-light opacity-60 cursor-default'
          : 'cursor-grab active:cursor-grabbing'
      )}
      style={{
        backgroundColor: isCancelled ? undefined : `${service?.colorHex}15`,
        borderColor: isCancelled ? undefined : `${service?.colorHex}30`,
      }}
      onPointerDown={!isCancelled ? onDragStart : undefined}
      onClick={handleClick}
    >
      {/* Top resize handle */}
      {showResizeHandles && (
        <div
          className="absolute top-0 left-2 right-2 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart?.(e, 'top')
          }}
        >
          <div className="w-8 h-1 bg-foreground-muted/40 rounded-full mx-auto mt-0.5" />
        </div>
      )}

      {/* Content */}
      <div className="flex flex-col h-full overflow-hidden px-2 py-1.5">
        {/* Client name */}
        <div
          className={cn(
            'text-xs font-medium truncate',
            isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
          )}
        >
          {clientName}
        </div>

        {!isCompact && (
          <>
            {/* Service name */}
            <div
              className={cn(
                'text-[10px] truncate mt-0.5',
                isCancelled ? 'text-foreground-muted' : 'text-foreground-secondary'
              )}
            >
              {service?.nameFr || 'Service'}
            </div>

            {/* Time range */}
            <div className="text-[10px] text-foreground-muted mt-auto">
              {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
            </div>
          </>
        )}

        {/* Cancelled badge for compact view */}
        {isCancelled && isCompact && (
          <div className="text-[9px] text-wine-600 font-medium">
            Annulé
          </div>
        )}
      </div>

      {/* Bottom resize handle */}
      {showResizeHandles && (
        <div
          className="absolute bottom-0 left-2 right-2 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart?.(e, 'bottom')
          }}
        >
          <div className="w-8 h-1 bg-foreground-muted/40 rounded-full mx-auto mb-0.5" />
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/appointment-block.tsx
git commit -m "feat(availability): add resize handles and drag cursor to appointment block"
```

---

## Task 6: Create Day View Component

**Files:**
- Create: `src/availability/components/day-view.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create DayView component**

```typescript
// src/availability/components/day-view.tsx

import { useMemo } from 'react'
import { format, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment } from '../types'
import { AppointmentBlock } from './appointment-block'
import { NowLine } from './now-line'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface DayViewProps {
  date: Date
  appointments: Appointment[]
  onSlotClick: (date: Date, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
  onCreateDragStart?: (e: React.PointerEvent, dayIndex: number) => void
  onAppointmentDragStart?: (e: React.PointerEvent, appointmentId: string, dayIndex: number) => void
  onAppointmentResizeStart?: (e: React.PointerEvent, appointmentId: string, dayIndex: number, edge: 'top' | 'bottom') => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  createPreview?: { top: number; height: number; dayIndex: number } | null
  isDragging?: boolean
}

const START_HOUR = 6
const END_HOUR = 22
const INTERVAL_MINUTES = 30
const SLOT_HEIGHT = 48

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`)
    slots.push(`${hour.toString().padStart(2, '0')}:30`)
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

export function DayView({
  date,
  appointments,
  onSlotClick,
  onAppointmentClick,
  onCreateDragStart,
  onAppointmentDragStart,
  onAppointmentResizeStart,
  onPointerMove,
  onPointerUp,
  createPreview,
  isDragging,
}: DayViewProps) {
  // Filter appointments for this day
  const dayAppointments = useMemo(() => {
    const dayKey = format(date, 'yyyy-MM-dd')
    return appointments.filter(apt => {
      const aptDate = format(new Date(apt.startTime), 'yyyy-MM-dd')
      return aptDate === dayKey
    })
  }, [appointments, date])

  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes() - START_HOUR * 60
    const top = (startMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    const height = (apt.durationMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    return { top, height }
  }

  const getService = (id: string) => MOCK_SERVICES.find(s => s.id === id)
  const getClient = (id: string) => MOCK_CLIENTS.find(c => c.id === id)

  return (
    <div className="flex-1 overflow-hidden rounded-xl border border-border bg-background">
      {/* Day header */}
      <div className={cn(
        'border-b border-border px-4 py-3 text-center',
        isToday(date) && 'bg-sage-50/50'
      )}>
        <div className="text-xs font-medium text-foreground-muted uppercase">
          {format(date, 'EEEE', { locale: fr })}
        </div>
        <div className={cn(
          'text-2xl font-semibold mt-0.5',
          isToday(date) ? 'text-sage-700' : 'text-foreground'
        )}>
          {format(date, 'd MMMM', { locale: fr })}
        </div>
      </div>

      {/* Time grid */}
      <div className="flex overflow-y-auto max-h-[calc(100vh-280px)]">
        {/* Time labels */}
        <div className="w-16 border-r border-border flex-shrink-0">
          {TIME_SLOTS.map((time, index) => (
            <div
              key={time}
              className="flex items-start justify-end pr-3 -mt-2"
              style={{ height: SLOT_HEIGHT }}
            >
              {index % 2 === 0 && (
                <span className="text-xs text-foreground-muted">{time}</span>
              )}
            </div>
          ))}
        </div>

        {/* Day column */}
        <div
          className={cn(
            'flex-1 relative',
            isToday(date) && 'bg-sage-50/20'
          )}
          onPointerDown={(e) => onCreateDragStart?.(e, 0)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* Slot lines */}
          {TIME_SLOTS.map((time, index) => (
            <div
              key={time}
              onClick={() => onSlotClick(date, time)}
              className={cn(
                'border-b cursor-pointer transition-colors hover:bg-sage-50/50',
                index % 2 === 0 ? 'border-border' : 'border-border-light'
              )}
              style={{ height: SLOT_HEIGHT }}
            />
          ))}

          {/* Now line */}
          <NowLine
            dayDate={date}
            startHour={START_HOUR}
            slotHeight={SLOT_HEIGHT}
            intervalMinutes={INTERVAL_MINUTES}
          />

          {/* Create preview */}
          {createPreview && createPreview.dayIndex === 0 && (
            <div
              className="absolute left-2 right-2 rounded-lg bg-sage-200/50 border-2 border-dashed border-sage-400 pointer-events-none"
              style={{ top: createPreview.top, height: Math.max(createPreview.height, SLOT_HEIGHT) }}
            />
          )}

          {/* Appointments */}
          <div className="absolute inset-x-2 top-0 pointer-events-none">
            {dayAppointments.map(apt => {
              const { top, height } = getAppointmentPosition(apt)
              const service = getService(apt.serviceId)
              const client = getClient(apt.clientId)

              return (
                <div
                  key={apt.id}
                  className="absolute left-0 right-0 pointer-events-auto"
                  style={{ top, height }}
                >
                  <AppointmentBlock
                    appointment={apt}
                    service={service}
                    client={client}
                    onClick={() => onAppointmentClick(apt)}
                    onDragStart={(e) => onAppointmentDragStart?.(e, apt.id, 0)}
                    onResizeStart={(e, edge) => onAppointmentResizeStart?.(e, apt.id, 0, edge)}
                    isDragging={isDragging}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Export from index**

Add to `src/availability/components/index.ts`:
```typescript
export { DayView } from './day-view'
```

**Step 3: Commit**

```bash
git add src/availability/components/day-view.tsx src/availability/components/index.ts
git commit -m "feat(availability): add single-day view component with drag support"
```

---

## Task 7: Create List View Component

**Files:**
- Create: `src/availability/components/list-view.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create ListView component**

```typescript
// src/availability/components/list-view.tsx

import { useMemo } from 'react'
import { format, startOfWeek, endOfWeek, isToday, isSameDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Clock, User, FileText } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { Appointment } from '../types'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface ListViewProps {
  viewDate: Date
  appointments: Appointment[]
  onAppointmentClick: (appointment: Appointment) => void
}

export function ListView({ viewDate, appointments, onAppointmentClick }: ListViewProps) {
  // Get week range
  const weekStart = startOfWeek(viewDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(viewDate, { weekStartsOn: 1 })

  // Filter and group appointments by day
  const groupedAppointments = useMemo(() => {
    const filtered = appointments
      .filter(apt => {
        const aptDate = new Date(apt.startTime)
        return aptDate >= weekStart && aptDate <= weekEnd
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

    const groups = new Map<string, Appointment[]>()
    filtered.forEach(apt => {
      const dayKey = format(new Date(apt.startTime), 'yyyy-MM-dd')
      if (!groups.has(dayKey)) groups.set(dayKey, [])
      groups.get(dayKey)!.push(apt)
    })

    return groups
  }, [appointments, weekStart, weekEnd])

  const getService = (id: string) => MOCK_SERVICES.find(s => s.id === id)
  const getClient = (id: string) => MOCK_CLIENTS.find(c => c.id === id)

  if (groupedAppointments.size === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground-muted">
        Aucun rendez-vous cette semaine
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {Array.from(groupedAppointments.entries()).map(([dayKey, dayApts]) => {
        const dayDate = new Date(dayApts[0].startTime)
        const today = isToday(dayDate)

        return (
          <div key={dayKey}>
            {/* Day header */}
            <div className={cn(
              'flex items-center gap-3 mb-3 pb-2 border-b border-border',
              today && 'border-sage-300'
            )}>
              <div className={cn(
                'w-12 h-12 rounded-xl flex flex-col items-center justify-center',
                today ? 'bg-sage-100 text-sage-700' : 'bg-background-secondary text-foreground'
              )}>
                <span className="text-xs font-medium uppercase">
                  {format(dayDate, 'EEE', { locale: fr })}
                </span>
                <span className="text-lg font-semibold">
                  {format(dayDate, 'd')}
                </span>
              </div>
              <div>
                <div className={cn(
                  'text-sm font-medium',
                  today ? 'text-sage-700' : 'text-foreground'
                )}>
                  {today ? "Aujourd'hui" : format(dayDate, 'EEEE', { locale: fr })}
                </div>
                <div className="text-xs text-foreground-muted">
                  {dayApts.length} rendez-vous
                </div>
              </div>
            </div>

            {/* Appointments list */}
            <div className="space-y-2 ml-2">
              {dayApts.map(apt => {
                const service = getService(apt.serviceId)
                const client = getClient(apt.clientId)
                const startTime = new Date(apt.startTime)
                const endTime = new Date(startTime.getTime() + apt.durationMinutes * 60000)
                const isCancelled = apt.status === 'cancelled'

                return (
                  <button
                    key={apt.id}
                    onClick={() => onAppointmentClick(apt)}
                    className={cn(
                      'w-full text-left p-4 rounded-xl border transition-all',
                      'hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sage-400',
                      isCancelled
                        ? 'bg-background-tertiary/50 border-border-light opacity-60'
                        : 'bg-background border-border hover:border-sage-300'
                    )}
                  >
                    <div className="flex items-start gap-4">
                      {/* Service color indicator */}
                      <div
                        className="w-1 h-14 rounded-full flex-shrink-0"
                        style={{ backgroundColor: isCancelled ? '#888' : service?.colorHex }}
                      />

                      <div className="flex-1 min-w-0">
                        {/* Client name */}
                        <div className={cn(
                          'text-base font-medium',
                          isCancelled ? 'line-through text-foreground-muted' : 'text-foreground'
                        )}>
                          {client ? `${client.firstName} ${client.lastName}` : 'Client'}
                        </div>

                        {/* Service */}
                        <div className="flex items-center gap-1.5 text-sm text-foreground-secondary mt-1">
                          <FileText className="h-3.5 w-3.5" />
                          {service?.nameFr || 'Service'}
                        </div>

                        {/* Time */}
                        <div className="flex items-center gap-1.5 text-sm text-foreground-muted mt-1">
                          <Clock className="h-3.5 w-3.5" />
                          {format(startTime, 'HH:mm')} – {format(endTime, 'HH:mm')}
                          <span className="text-xs">({apt.durationMinutes} min)</span>
                        </div>
                      </div>

                      {/* Status badge */}
                      {isCancelled && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-wine-100 text-wine-700">
                          Annulé
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Export from index**

Add to `src/availability/components/index.ts`:
```typescript
export { ListView } from './list-view'
```

**Step 3: Commit**

```bash
git add src/availability/components/list-view.tsx src/availability/components/index.ts
git commit -m "feat(availability): add list view component for agenda-style display"
```

---

## Task 8: Upgrade CalendarGrid (Week View) with Drag Support

**Files:**
- Modify: `src/availability/components/calendar-grid.tsx`

**Step 1: Update CalendarGrid with drag handlers and now line**

Replace the entire file:

```typescript
// src/availability/components/calendar-grid.tsx

import { useMemo } from 'react'
import { format, addDays, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment } from '../types'
import { AppointmentBlock } from './appointment-block'
import { NowLine } from './now-line'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface CalendarGridProps {
  weekStartDate: Date
  appointments: Appointment[]
  onSlotClick: (date: Date, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
  onCreateDragStart?: (e: React.PointerEvent, dayIndex: number) => void
  onAppointmentDragStart?: (e: React.PointerEvent, appointmentId: string, dayIndex: number) => void
  onAppointmentResizeStart?: (e: React.PointerEvent, appointmentId: string, dayIndex: number, edge: 'top' | 'bottom') => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  createPreview?: { top: number; height: number; dayIndex: number } | null
  isDragging?: boolean
}

const START_HOUR = 6
const END_HOUR = 22
const INTERVAL_MINUTES = 30
const SLOT_HEIGHT = 40

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`)
    slots.push(`${hour.toString().padStart(2, '0')}:30`)
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

export function CalendarGrid({
  weekStartDate,
  appointments,
  onSlotClick,
  onAppointmentClick,
  onCreateDragStart,
  onAppointmentDragStart,
  onAppointmentResizeStart,
  onPointerMove,
  onPointerUp,
  createPreview,
  isDragging,
}: CalendarGridProps) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i))
  }, [weekStartDate])

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    days.forEach(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      map.set(dayKey, [])
    })
    appointments.forEach(apt => {
      const aptDate = new Date(apt.startTime)
      const dayKey = format(aptDate, 'yyyy-MM-dd')
      const existing = map.get(dayKey)
      if (existing) existing.push(apt)
    })
    return map
  }, [appointments, days])

  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes() - START_HOUR * 60
    const top = (startMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    const height = (apt.durationMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    return { top, height }
  }

  const getService = (id: string) => MOCK_SERVICES.find(s => s.id === id)
  const getClient = (id: string) => MOCK_CLIENTS.find(c => c.id === id)

  return (
    <div
      className="rounded-xl border border-border bg-background overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Days header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background-secondary/50 sticky top-0 z-10">
        <div className="border-r border-border" />
        {days.map(day => (
          <div
            key={day.toISOString()}
            className={cn(
              'border-r border-border last:border-r-0 px-2 py-3 text-center',
              isToday(day) && 'bg-sage-50/50'
            )}
          >
            <div className="text-xs font-medium text-foreground-muted uppercase">
              {format(day, 'EEE', { locale: fr })}
            </div>
            <div className={cn(
              'text-lg font-semibold mt-0.5',
              isToday(day) ? 'text-sage-700' : 'text-foreground'
            )}>
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] overflow-y-auto max-h-[calc(100vh-300px)]">
        {/* Time labels */}
        <div className="border-r border-border">
          {TIME_SLOTS.map((time, index) => (
            <div
              key={time}
              className="h-10 flex items-start justify-end pr-2 -mt-2"
              style={{ height: SLOT_HEIGHT }}
            >
              {index % 2 === 0 && (
                <span className="text-xs text-foreground-muted">{time}</span>
              )}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day, dayIndex) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayAppointments = appointmentsByDay.get(dayKey) || []

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'relative border-r border-border last:border-r-0',
                isToday(day) && 'bg-sage-50/30'
              )}
              onPointerDown={(e) => onCreateDragStart?.(e, dayIndex)}
            >
              {/* Slot lines */}
              {TIME_SLOTS.map((time, index) => (
                <div
                  key={time}
                  onClick={() => onSlotClick(day, time)}
                  className={cn(
                    'h-10 border-b cursor-pointer transition-colors hover:bg-sage-50/50',
                    index % 2 === 0 ? 'border-border' : 'border-border-light'
                  )}
                  style={{ height: SLOT_HEIGHT }}
                />
              ))}

              {/* Now line */}
              <NowLine
                dayDate={day}
                startHour={START_HOUR}
                slotHeight={SLOT_HEIGHT}
                intervalMinutes={INTERVAL_MINUTES}
              />

              {/* Create preview */}
              {createPreview && createPreview.dayIndex === dayIndex && (
                <div
                  className="absolute left-1 right-1 rounded-lg bg-sage-200/50 border-2 border-dashed border-sage-400 pointer-events-none z-10"
                  style={{ top: createPreview.top, height: Math.max(createPreview.height, SLOT_HEIGHT) }}
                />
              )}

              {/* Appointments */}
              <div className="absolute inset-x-1 top-0 pointer-events-none">
                {dayAppointments.map(apt => {
                  const { top, height } = getAppointmentPosition(apt)
                  const service = getService(apt.serviceId)
                  const client = getClient(apt.clientId)

                  return (
                    <div
                      key={apt.id}
                      className="absolute left-0 right-0 pointer-events-auto"
                      style={{ top, height }}
                    >
                      <AppointmentBlock
                        appointment={apt}
                        service={service}
                        client={client}
                        onClick={() => onAppointmentClick(apt)}
                        onDragStart={(e) => onAppointmentDragStart?.(e, apt.id, dayIndex)}
                        onResizeStart={(e, edge) => onAppointmentResizeStart?.(e, apt.id, dayIndex, edge)}
                        isDragging={isDragging}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/calendar-grid.tsx
git commit -m "feat(availability): upgrade week view with drag support and now line"
```

---

## Task 9: Update Hooks Index to Export New Hook

**Files:**
- Modify: `src/availability/hooks/index.ts`

**Step 1: Ensure all hooks are exported**

The file should now have:
```typescript
// src/availability/hooks/index.ts

export * from './use-appointments'
export { useCalendarDrag } from './use-calendar-drag'
```

**Step 2: Commit**

```bash
git add src/availability/hooks/index.ts
git commit -m "chore(availability): ensure all hooks are exported"
```

---

## Task 10: Update Components Index to Export All New Components

**Files:**
- Modify: `src/availability/components/index.ts`

**Step 1: Ensure all components are exported**

```typescript
// src/availability/components/index.ts

export { CalendarGrid } from './calendar-grid'
export { AppointmentBlock } from './appointment-block'
export { WeekNavigation } from './week-navigation'
export { ProfessionalSelector } from './professional-selector'
export { AppointmentDialog } from './appointment-dialog'
export { AppointmentDetailDrawer } from './appointment-detail-drawer'
export { CalendarSidebar } from './calendar-sidebar'
export { NowLine } from './now-line'
export { DayView } from './day-view'
export { ListView } from './list-view'
```

**Step 2: Commit**

```bash
git add src/availability/components/index.ts
git commit -m "chore(availability): export all new components from barrel"
```

---

## Task 11: Rewrite AvailabilityPage with New Layout

**Files:**
- Modify: `src/pages/availability.tsx`

**Step 1: Rewrite with sidebar layout and view switching**

```typescript
// src/pages/availability.tsx

import { useState, useCallback, useMemo } from 'react'
import { startOfWeek, addDays, format } from 'date-fns'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/hooks/use-toast'
import {
  useAppointments,
  useAppointmentsByProfessional,
  useCalendarDrag,
  CalendarGrid,
  CalendarSidebar,
  DayView,
  ListView,
  WeekNavigation,
  ProfessionalSelector,
  AppointmentDialog,
  AppointmentDetailDrawer,
  type Appointment,
  type AppointmentFormData,
  type CalendarViewMode,
  type TimeRange,
} from '@/availability'

interface SlotClickData {
  date: Date
  time: string
}

const SLOT_HEIGHT = 40
const INTERVAL_MINUTES = 30
const START_HOUR = 6

export function AvailabilityPage() {
  // Professional selection
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>('pro-1')

  // View state
  const [viewDate, setViewDate] = useState<Date>(() => new Date())
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [slotClickData, setSlotClickData] = useState<SlotClickData | null>(null)

  // Appointment state
  const {
    appointments,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  } = useAppointments()

  const professionalAppointments = useAppointmentsByProfessional(
    appointments,
    selectedProfessionalId
  )

  // Week start for navigation
  const weekStartDate = useMemo(() => {
    return startOfWeek(viewDate, { weekStartsOn: 1 })
  }, [viewDate])

  // Drag interaction handlers
  const handleCreateDrag = useCallback(
    (dayIndex: number, timeRange: TimeRange) => {
      const targetDate = viewMode === 'day' ? viewDate : addDays(weekStartDate, dayIndex)
      const hours = Math.floor(timeRange.startMinutes / 60)
      const minutes = timeRange.startMinutes % 60
      const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`

      setSlotClickData({ date: targetDate, time })
      setSelectedAppointment(null)
      setCreateDialogOpen(true)
    },
    [viewMode, viewDate, weekStartDate]
  )

  const handleMoveDrag = useCallback(
    (appointmentId: string, newStartMinutes: number, dayIndex: number) => {
      const apt = appointments.find(a => a.id === appointmentId)
      if (!apt) return

      const targetDate = viewMode === 'day' ? viewDate : addDays(weekStartDate, dayIndex)
      const hours = Math.floor(newStartMinutes / 60)
      const minutes = newStartMinutes % 60

      const newStartTime = new Date(targetDate)
      newStartTime.setHours(hours, minutes, 0, 0)

      updateAppointment(appointmentId, {
        professionalId: apt.professionalId,
        clientId: apt.clientId,
        serviceId: apt.serviceId,
        startDate: format(newStartTime, 'yyyy-MM-dd'),
        startTime: format(newStartTime, 'HH:mm'),
        durationMinutes: apt.durationMinutes,
        notesInternal: apt.notesInternal,
      })

      toast({
        title: 'Rendez-vous déplacé',
        description: `Déplacé au ${format(newStartTime, 'dd/MM à HH:mm')}.`,
      })
    },
    [appointments, updateAppointment, viewMode, viewDate, weekStartDate]
  )

  const handleResizeDrag = useCallback(
    (appointmentId: string, newDuration: number) => {
      const apt = appointments.find(a => a.id === appointmentId)
      if (!apt) return

      const finalDuration = Math.max(30, Math.min(newDuration, 240))

      updateAppointment(appointmentId, {
        professionalId: apt.professionalId,
        clientId: apt.clientId,
        serviceId: apt.serviceId,
        startDate: format(new Date(apt.startTime), 'yyyy-MM-dd'),
        startTime: format(new Date(apt.startTime), 'HH:mm'),
        durationMinutes: finalDuration,
        notesInternal: apt.notesInternal,
      })

      toast({
        title: 'Durée modifiée',
        description: `Nouvelle durée: ${finalDuration} minutes.`,
      })
    },
    [appointments, updateAppointment]
  )

  const {
    startCreateDrag,
    startMoveDrag,
    startResizeDrag,
    handlePointerMove,
    handlePointerUp,
    getCreatePreview,
    isDragging,
  } = useCalendarDrag({
    slotHeight: SLOT_HEIGHT,
    intervalMinutes: INTERVAL_MINUTES,
    startHour: START_HOUR,
    onCreateDrag: handleCreateDrag,
    onMoveDrag: handleMoveDrag,
    onResizeDrag: handleResizeDrag,
  })

  const createPreview = getCreatePreview()

  // Click handlers
  const handleSlotClick = useCallback((date: Date, time: string) => {
    setSlotClickData({ date, time })
    setSelectedAppointment(null)
    setCreateDialogOpen(true)
  }, [])

  const handleAppointmentClick = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(true)
  }, [])

  const handleEditFromDetail = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(false)
    setEditDialogOpen(true)
  }, [])

  const handleCreate = useCallback(
    (data: AppointmentFormData) => {
      createAppointment(data)
      toast({
        title: 'Rendez-vous créé',
        description: `Le rendez-vous a été planifié pour le ${format(new Date(`${data.startDate}T${data.startTime}`), 'dd/MM/yyyy à HH:mm')}.`,
      })
      setCreateDialogOpen(false)
      setSlotClickData(null)
    },
    [createAppointment]
  )

  const handleEdit = useCallback(
    (data: AppointmentFormData) => {
      if (!selectedAppointment) return
      updateAppointment(selectedAppointment.id, data)
      toast({
        title: 'Rendez-vous modifié',
        description: 'Les modifications ont été enregistrées.',
      })
      setEditDialogOpen(false)
      setSelectedAppointment(null)
    },
    [selectedAppointment, updateAppointment]
  )

  const handleCancel = useCallback(
    (id: string) => {
      cancelAppointment(id)
      toast({
        title: 'Rendez-vous annulé',
        description: 'Le rendez-vous a été annulé.',
      })
    },
    [cancelAppointment]
  )

  const handleRestore = useCallback(
    (id: string) => {
      restoreAppointment(id)
      toast({
        title: 'Rendez-vous restauré',
        description: 'Le rendez-vous a été restauré.',
      })
    },
    [restoreAppointment]
  )

  const handleNewAppointment = useCallback(() => {
    setSlotClickData(null)
    setSelectedAppointment(null)
    setCreateDialogOpen(true)
  }, [])

  const handleWeekChange = useCallback((newWeekStart: Date) => {
    setViewDate(newWeekStart)
  }, [])

  const handleViewModeChange = useCallback((mode: CalendarViewMode) => {
    setViewMode(mode)
  }, [])

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.availability.title')}
          </h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            {t('pages.availability.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProfessionalSelector
            selectedId={selectedProfessionalId}
            onSelect={setSelectedProfessionalId}
          />
          <Button onClick={handleNewAppointment}>
            <Plus className="h-4 w-4" />
            {t('pages.availability.action')}
          </Button>
        </div>
      </div>

      {/* Main content with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <CalendarSidebar
          appointments={professionalAppointments}
          viewDate={viewDate}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onAppointmentClick={handleAppointmentClick}
        />

        {/* Calendar area */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          {/* Week navigation (for week/day views) */}
          {viewMode !== 'list' && (
            <div className="mb-4">
              <WeekNavigation
                weekStartDate={weekStartDate}
                onWeekChange={handleWeekChange}
              />
            </div>
          )}

          {/* View content */}
          {viewMode === 'week' && (
            <CalendarGrid
              weekStartDate={weekStartDate}
              appointments={professionalAppointments}
              onSlotClick={handleSlotClick}
              onAppointmentClick={handleAppointmentClick}
              onCreateDragStart={startCreateDrag}
              onAppointmentDragStart={startMoveDrag}
              onAppointmentResizeStart={startResizeDrag}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              createPreview={createPreview}
              isDragging={isDragging}
            />
          )}

          {viewMode === 'day' && (
            <DayView
              date={viewDate}
              appointments={professionalAppointments}
              onSlotClick={handleSlotClick}
              onAppointmentClick={handleAppointmentClick}
              onCreateDragStart={startCreateDrag}
              onAppointmentDragStart={startMoveDrag}
              onAppointmentResizeStart={startResizeDrag}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              createPreview={createPreview}
              isDragging={isDragging}
            />
          )}

          {viewMode === 'list' && (
            <ListView
              viewDate={viewDate}
              appointments={professionalAppointments}
              onAppointmentClick={handleAppointmentClick}
            />
          )}
        </div>
      </div>

      {/* Dialogs */}
      <AppointmentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mode="create"
        initialData={{
          professionalId: selectedProfessionalId ?? undefined,
          date: slotClickData?.date,
          time: slotClickData?.time,
        }}
        onSubmit={handleCreate}
      />

      <AppointmentDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode="edit"
        initialData={{
          appointment: selectedAppointment ?? undefined,
        }}
        onSubmit={handleEdit}
      />

      <AppointmentDetailDrawer
        open={detailDrawerOpen}
        onOpenChange={setDetailDrawerOpen}
        appointment={selectedAppointment}
        onEdit={handleEditFromDetail}
        onCancel={handleCancel}
        onRestore={handleRestore}
      />
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/pages/availability.tsx
git commit -m "feat(availability): rewrite page with sidebar layout and view switching"
```

---

## Task 12: Update Module Barrel Export for New Types

**Files:**
- Modify: `src/availability/index.ts`

**Step 1: Ensure new types are exported**

```typescript
// src/availability/index.ts

export * from './types'
export * from './mock'
export * from './hooks'
export * from './components'
```

(No change needed if already correct)

**Step 2: Commit if changed**

```bash
git add src/availability/index.ts
git commit -m "chore(availability): ensure module barrel exports all types"
```

---

## Task 13: Add i18n Keys for New Features

**Files:**
- Modify: `src/i18n/fr-CA.json`

**Step 1: Add new translation keys**

Add/update in the `pages.availability` section:
```json
{
  "pages": {
    "availability": {
      "title": "Disponibilités",
      "subtitle": "Gérez les rendez-vous de vos professionnels",
      "action": "Nouveau rendez-vous",
      "weekView": "Vue semaine",
      "dayView": "Vue jour",
      "listView": "Vue liste",
      "selectProfessional": "Sélectionnez un professionnel",
      "upcoming": "À venir",
      "noUpcoming": "Aucun rendez-vous à venir",
      "appointmentsCount": "{{count}} rendez-vous à venir",
      "today": "Aujourd'hui",
      "tomorrow": "Demain",
      "empty": {
        "description": "Sélectionnez un professionnel pour voir son calendrier"
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/i18n/fr-CA.json
git commit -m "feat(i18n): add translation keys for availability v2 features"
```

---

## Task 14: Build Verification

**Step 1: Run TypeScript check**

```bash
npm run typecheck
```

Expected: No errors

**Step 2: Run lint**

```bash
npm run lint
```

Expected: No errors in availability module

**Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds

**Step 4: Commit any fixes if needed**

---

## Summary

This plan transforms the Disponibilités calendar from a basic grid into a premium SaaS-quality experience with:

1. **Sidebar** with view toggle (Day/Week/List) and upcoming appointments agenda
2. **Drag-to-create** appointments by clicking and dragging on empty slots
3. **Drag-to-move** appointments to new times/days
4. **Resize handles** on appointment blocks to change duration
5. **"Now" line** indicator showing current time on today's column
6. **Three view modes**: Day (single column), Week (7-column grid), List (agenda style)
7. **Enhanced styling** with better hover states, shadows, and visual hierarchy

All changes are UI-only with mock data—no Supabase/database changes required.
