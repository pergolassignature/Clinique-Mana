# Disponibilités UI Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully interactive 7-day calendar UI for viewing and managing professional appointments using mock data only (no database).

**Architecture:** Create a self-contained `src/availability/` module with types, mock data, hooks for local state management, and components. The calendar grid is custom-built with Tailwind (no external calendar library). State is managed via React hooks - appointments array initialized from mock data and mutated locally.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Radix Dialog/Popover, Lucide icons, date-fns for date manipulation.

---

## Task 1: Create Types

**Files:**
- Create: `src/availability/types.ts`

**Step 1: Write the type definitions**

```typescript
// src/availability/types.ts

export interface Professional {
  id: string
  displayName: string
  avatarUrl?: string
}

export interface Client {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
}

export interface Service {
  id: string
  nameFr: string
  durationMinutes: number
  colorHex: string
}

export type AppointmentStatus = 'scheduled' | 'cancelled'

export interface Appointment {
  id: string
  professionalId: string
  clientId: string
  serviceId: string
  /** ISO 8601 datetime string */
  startTime: string
  /** Duration in minutes (default from service, can be overridden) */
  durationMinutes: number
  status: AppointmentStatus
  notesInternal?: string
  createdAt: string
  updatedAt: string
}

// Form data for create/edit
export interface AppointmentFormData {
  professionalId: string
  clientId: string
  serviceId: string
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  durationMinutes: number
  notesInternal?: string
}

// Calendar view state
export interface CalendarViewState {
  selectedProfessionalId: string | null
  weekStartDate: Date // Monday of the current view week
}
```

**Step 2: Commit**

```bash
git add src/availability/types.ts
git commit -m "feat(availability): add TypeScript types for appointments module

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Mock Data

**Files:**
- Create: `src/availability/mock/mock-data.ts`
- Create: `src/availability/mock/index.ts`

**Step 1: Write the mock data**

```typescript
// src/availability/mock/mock-data.ts

import type { Professional, Client, Service, Appointment } from '../types'

// Get the start of the current week (Monday)
function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const monday = getMonday(new Date())

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function formatDateTime(date: Date, hours: number, minutes: number): string {
  const d = new Date(date)
  d.setHours(hours, minutes, 0, 0)
  return d.toISOString()
}

export const MOCK_PROFESSIONALS: Professional[] = [
  { id: 'pro-1', displayName: 'Dre Marie Tremblay' },
  { id: 'pro-2', displayName: 'Jean-Philippe Bouchard' },
  { id: 'pro-3', displayName: 'Sophie Gagnon' },
]

export const MOCK_CLIENTS: Client[] = [
  { id: 'cli-1', firstName: 'Luc', lastName: 'Côté', email: 'luc.cote@example.com', phone: '514-555-0101' },
  { id: 'cli-2', firstName: 'Anne', lastName: 'Roy', email: 'anne.roy@example.com', phone: '514-555-0102' },
  { id: 'cli-3', firstName: 'Michel', lastName: 'Lavoie', email: 'michel.lavoie@example.com', phone: '514-555-0103' },
  { id: 'cli-4', firstName: 'Julie', lastName: 'Bergeron', email: 'julie.bergeron@example.com' },
  { id: 'cli-5', firstName: 'Pierre', lastName: 'Morin', phone: '514-555-0105' },
]

export const MOCK_SERVICES: Service[] = [
  { id: 'svc-1', nameFr: 'Consultation individuelle', durationMinutes: 50, colorHex: '#7FAE9D' },
  { id: 'svc-2', nameFr: 'Consultation couple', durationMinutes: 75, colorHex: '#D4A5A5' },
  { id: 'svc-3', nameFr: 'Ouverture de dossier', durationMinutes: 60, colorHex: '#B4C7DC' },
  { id: 'svc-4', nameFr: 'Appel découverte', durationMinutes: 15, colorHex: '#E8D4B8' },
]

export const MOCK_APPOINTMENTS: Appointment[] = [
  // Monday
  {
    id: 'apt-1',
    professionalId: 'pro-1',
    clientId: 'cli-1',
    serviceId: 'svc-1',
    startTime: formatDateTime(monday, 9, 0),
    durationMinutes: 50,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'apt-2',
    professionalId: 'pro-1',
    clientId: 'cli-2',
    serviceId: 'svc-1',
    startTime: formatDateTime(monday, 10, 0),
    durationMinutes: 50,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'apt-3',
    professionalId: 'pro-1',
    clientId: 'cli-3',
    serviceId: 'svc-2',
    startTime: formatDateTime(monday, 14, 0),
    durationMinutes: 75,
    status: 'cancelled',
    notesInternal: 'Client a annulé - maladie',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // Tuesday
  {
    id: 'apt-4',
    professionalId: 'pro-1',
    clientId: 'cli-4',
    serviceId: 'svc-3',
    startTime: formatDateTime(addDays(monday, 1), 9, 30),
    durationMinutes: 60,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'apt-5',
    professionalId: 'pro-1',
    clientId: 'cli-1',
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 1), 11, 0),
    durationMinutes: 50,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // Wednesday
  {
    id: 'apt-6',
    professionalId: 'pro-1',
    clientId: 'cli-5',
    serviceId: 'svc-4',
    startTime: formatDateTime(addDays(monday, 2), 8, 0),
    durationMinutes: 15,
    status: 'scheduled',
    notesInternal: 'Premier contact',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'apt-7',
    professionalId: 'pro-1',
    clientId: 'cli-2',
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 2), 15, 0),
    durationMinutes: 50,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // Thursday - different professional
  {
    id: 'apt-8',
    professionalId: 'pro-2',
    clientId: 'cli-3',
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 3), 10, 0),
    durationMinutes: 50,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // Friday
  {
    id: 'apt-9',
    professionalId: 'pro-1',
    clientId: 'cli-4',
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 4), 13, 0),
    durationMinutes: 50,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
```

```typescript
// src/availability/mock/index.ts

export {
  MOCK_PROFESSIONALS,
  MOCK_CLIENTS,
  MOCK_SERVICES,
  MOCK_APPOINTMENTS,
} from './mock-data'
```

**Step 2: Commit**

```bash
git add src/availability/mock/
git commit -m "feat(availability): add mock data for professionals, clients, services, appointments

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Appointments State Hook

**Files:**
- Create: `src/availability/hooks/use-appointments.ts`
- Create: `src/availability/hooks/index.ts`

**Step 1: Write the hook**

```typescript
// src/availability/hooks/use-appointments.ts

import { useState, useCallback, useMemo } from 'react'
import type { Appointment, AppointmentFormData } from '../types'
import { MOCK_APPOINTMENTS, MOCK_SERVICES } from '../mock'

function generateId(): string {
  return `apt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>(MOCK_APPOINTMENTS)

  const createAppointment = useCallback((data: AppointmentFormData) => {
    const service = MOCK_SERVICES.find(s => s.id === data.serviceId)
    const startDateTime = new Date(`${data.startDate}T${data.startTime}:00`)

    const newAppointment: Appointment = {
      id: generateId(),
      professionalId: data.professionalId,
      clientId: data.clientId,
      serviceId: data.serviceId,
      startTime: startDateTime.toISOString(),
      durationMinutes: data.durationMinutes || service?.durationMinutes || 50,
      status: 'scheduled',
      notesInternal: data.notesInternal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setAppointments(prev => [...prev, newAppointment])
    return newAppointment
  }, [])

  const updateAppointment = useCallback((id: string, data: Partial<AppointmentFormData>) => {
    setAppointments(prev =>
      prev.map(apt => {
        if (apt.id !== id) return apt

        const updates: Partial<Appointment> = {
          updatedAt: new Date().toISOString(),
        }

        if (data.professionalId) updates.professionalId = data.professionalId
        if (data.clientId) updates.clientId = data.clientId
        if (data.serviceId) updates.serviceId = data.serviceId
        if (data.durationMinutes) updates.durationMinutes = data.durationMinutes
        if (data.notesInternal !== undefined) updates.notesInternal = data.notesInternal

        if (data.startDate && data.startTime) {
          const startDateTime = new Date(`${data.startDate}T${data.startTime}:00`)
          updates.startTime = startDateTime.toISOString()
        }

        return { ...apt, ...updates }
      })
    )
  }, [])

  const cancelAppointment = useCallback((id: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? { ...apt, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
          : apt
      )
    )
  }, [])

  const restoreAppointment = useCallback((id: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? { ...apt, status: 'scheduled' as const, updatedAt: new Date().toISOString() }
          : apt
      )
    )
  }, [])

  return {
    appointments,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  }
}

export function useAppointmentsByProfessional(
  appointments: Appointment[],
  professionalId: string | null
) {
  return useMemo(() => {
    if (!professionalId) return []
    return appointments.filter(apt => apt.professionalId === professionalId)
  }, [appointments, professionalId])
}

export function useAppointmentsForWeek(
  appointments: Appointment[],
  weekStartDate: Date
) {
  return useMemo(() => {
    const weekStart = new Date(weekStartDate)
    weekStart.setHours(0, 0, 0, 0)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    return appointments.filter(apt => {
      const aptDate = new Date(apt.startTime)
      return aptDate >= weekStart && aptDate < weekEnd
    })
  }, [appointments, weekStartDate])
}
```

```typescript
// src/availability/hooks/index.ts

export {
  useAppointments,
  useAppointmentsByProfessional,
  useAppointmentsForWeek,
} from './use-appointments'
```

**Step 2: Commit**

```bash
git add src/availability/hooks/
git commit -m "feat(availability): add useAppointments hook for local state management

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Calendar Grid Component

**Files:**
- Create: `src/availability/components/calendar-grid.tsx`

**Step 1: Write the calendar grid component**

```typescript
// src/availability/components/calendar-grid.tsx

import { useMemo } from 'react'
import { format, addDays, isSameDay, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Service, Client } from '../types'
import { AppointmentBlock } from './appointment-block'
import { MOCK_SERVICES, MOCK_CLIENTS } from '../mock'

interface CalendarGridProps {
  weekStartDate: Date
  appointments: Appointment[]
  onSlotClick: (date: Date, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
}

// Time range: 06:00 to 22:00 in 30-minute intervals
const START_HOUR = 6
const END_HOUR = 22
const INTERVAL_MINUTES = 30

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`)
    slots.push(`${hour.toString().padStart(2, '0')}:30`)
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60
const SLOT_HEIGHT = 40 // pixels per 30-min slot

export function CalendarGrid({
  weekStartDate,
  appointments,
  onSlotClick,
  onAppointmentClick,
}: CalendarGridProps) {
  // Generate 7 days starting from weekStartDate
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i))
  }, [weekStartDate])

  // Group appointments by day
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
      if (existing) {
        existing.push(apt)
      }
    })

    return map
  }, [appointments, days])

  // Calculate position for an appointment
  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes() - START_HOUR * 60
    const top = (startMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    const height = (apt.durationMinutes / INTERVAL_MINUTES) * SLOT_HEIGHT
    return { top, height }
  }

  // Get service and client for an appointment
  const getAppointmentDetails = (apt: Appointment) => {
    const service = MOCK_SERVICES.find(s => s.id === apt.serviceId)
    const client = MOCK_CLIENTS.find(c => c.id === apt.clientId)
    return { service, client }
  }

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      {/* Days header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background-secondary/50 sticky top-0 z-10">
        {/* Empty corner cell */}
        <div className="border-r border-border" />

        {days.map((day) => (
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
            <div
              className={cn(
                'text-lg font-semibold mt-0.5',
                isToday(day) ? 'text-sage-700' : 'text-foreground'
              )}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] overflow-y-auto max-h-[calc(100vh-300px)]">
        {/* Time labels column */}
        <div className="border-r border-border">
          {TIME_SLOTS.map((time, index) => (
            <div
              key={time}
              className="h-10 flex items-start justify-end pr-2 -mt-2"
              style={{ height: SLOT_HEIGHT }}
            >
              {index % 2 === 0 && (
                <span className="text-xs text-foreground-muted">
                  {time}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayAppointments = appointmentsByDay.get(dayKey) || []

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'relative border-r border-border last:border-r-0',
                isToday(day) && 'bg-sage-50/30'
              )}
            >
              {/* Slot lines */}
              {TIME_SLOTS.map((time, index) => (
                <div
                  key={time}
                  onClick={() => onSlotClick(day, time)}
                  className={cn(
                    'h-10 border-b border-border-light cursor-pointer transition-colors hover:bg-sage-50/50',
                    index % 2 === 0 && 'border-b-border'
                  )}
                  style={{ height: SLOT_HEIGHT }}
                />
              ))}

              {/* Appointments overlay */}
              <div className="absolute inset-x-1 top-0 pointer-events-none">
                {dayAppointments.map((apt) => {
                  const { top, height } = getAppointmentPosition(apt)
                  const { service, client } = getAppointmentDetails(apt)

                  return (
                    <div
                      key={apt.id}
                      className="absolute left-0 right-0 pointer-events-auto"
                      style={{ top: `${top}px`, height: `${height}px` }}
                    >
                      <AppointmentBlock
                        appointment={apt}
                        service={service}
                        client={client}
                        onClick={() => onAppointmentClick(apt)}
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
git commit -m "feat(availability): add CalendarGrid component with 7-day view

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create Appointment Block Component

**Files:**
- Create: `src/availability/components/appointment-block.tsx`

**Step 1: Write the appointment block component**

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
}

export function AppointmentBlock({
  appointment,
  service,
  client,
  onClick,
}: AppointmentBlockProps) {
  const startTime = new Date(appointment.startTime)
  const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)
  const isCancelled = appointment.status === 'cancelled'

  const clientName = client
    ? `${client.firstName} ${client.lastName}`
    : 'Client inconnu'

  // Calculate if we have enough height for full display
  const isCompact = appointment.durationMinutes <= 30

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full h-full rounded-lg px-2 py-1 text-left transition-all',
        'border shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-1',
        isCancelled
          ? 'bg-background-tertiary/60 border-border-light opacity-60'
          : 'border-transparent'
      )}
      style={{
        backgroundColor: isCancelled ? undefined : `${service?.colorHex}20`,
        borderColor: isCancelled ? undefined : `${service?.colorHex}40`,
      }}
    >
      <div className="flex flex-col h-full overflow-hidden">
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
                'text-[10px] truncate',
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
    </button>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/appointment-block.tsx
git commit -m "feat(availability): add AppointmentBlock component with status styling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create Week Navigation Component

**Files:**
- Create: `src/availability/components/week-navigation.tsx`

**Step 1: Write the week navigation component**

```typescript
// src/availability/components/week-navigation.tsx

import { format, addWeeks, subWeeks, startOfWeek, isThisWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'

interface WeekNavigationProps {
  weekStartDate: Date
  onWeekChange: (newStart: Date) => void
}

export function WeekNavigation({ weekStartDate, onWeekChange }: WeekNavigationProps) {
  const weekEnd = new Date(weekStartDate)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const handlePrevWeek = () => {
    onWeekChange(subWeeks(weekStartDate, 1))
  }

  const handleNextWeek = () => {
    onWeekChange(addWeeks(weekStartDate, 1))
  }

  const handleToday = () => {
    onWeekChange(startOfWeek(new Date(), { weekStartsOn: 1 }))
  }

  const isCurrentWeek = isThisWeek(weekStartDate, { weekStartsOn: 1 })

  // Format: "13 – 19 janvier 2026"
  const sameMonth = format(weekStartDate, 'MMMM', { locale: fr }) ===
                    format(weekEnd, 'MMMM', { locale: fr })

  const dateRangeLabel = sameMonth
    ? `${format(weekStartDate, 'd')} – ${format(weekEnd, 'd MMMM yyyy', { locale: fr })}`
    : `${format(weekStartDate, 'd MMM', { locale: fr })} – ${format(weekEnd, 'd MMM yyyy', { locale: fr })}`

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background p-2">
      {/* Previous week */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevWeek}
        className="h-9 w-9"
      >
        <ChevronLeft className="h-5 w-5" />
        <span className="sr-only">Semaine précédente</span>
      </Button>

      {/* Center: Date range + Today button */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {dateRangeLabel}
        </span>

        {!isCurrentWeek && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="h-7 text-xs"
          >
            <Calendar className="h-3 w-3 mr-1" />
            Aujourd'hui
          </Button>
        )}

        {isCurrentWeek && (
          <span className="text-xs text-sage-600 font-medium px-2 py-0.5 bg-sage-50 rounded">
            Cette semaine
          </span>
        )}
      </div>

      {/* Next week */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleNextWeek}
        className="h-9 w-9"
      >
        <ChevronRight className="h-5 w-5" />
        <span className="sr-only">Semaine suivante</span>
      </Button>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/week-navigation.tsx
git commit -m "feat(availability): add WeekNavigation component

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Create Professional Selector Component

**Files:**
- Create: `src/availability/components/professional-selector.tsx`

**Step 1: Write the professional selector component**

```typescript
// src/availability/components/professional-selector.tsx

import { useState, useMemo } from 'react'
import { Check, ChevronsUpDown, User } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/shared/ui/command'
import type { Professional } from '../types'
import { MOCK_PROFESSIONALS } from '../mock'

interface ProfessionalSelectorProps {
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ProfessionalSelector({
  selectedId,
  onSelect,
}: ProfessionalSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const professionals = MOCK_PROFESSIONALS

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === selectedId),
    [professionals, selectedId]
  )

  const filteredProfessionals = useMemo(() => {
    if (!search.trim()) return professionals
    const query = search.toLowerCase()
    return professionals.filter((p) =>
      p.displayName.toLowerCase().includes(query)
    )
  }, [professionals, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[280px] justify-between"
        >
          <div className="flex items-center gap-2 truncate">
            <User className="h-4 w-4 text-foreground-muted shrink-0" />
            {selectedProfessional ? (
              <span className="truncate">{selectedProfessional.displayName}</span>
            ) : (
              <span className="text-foreground-muted">Sélectionner un professionnel...</span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Rechercher..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Aucun professionnel trouvé.</CommandEmpty>
            <CommandGroup>
              {filteredProfessionals.map((professional) => (
                <CommandItem
                  key={professional.id}
                  value={professional.id}
                  onSelect={() => {
                    onSelect(professional.id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedId === professional.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {professional.displayName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/professional-selector.tsx
git commit -m "feat(availability): add ProfessionalSelector combobox component

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Create Appointment Dialog Component

**Files:**
- Create: `src/availability/components/appointment-dialog.tsx`

**Step 1: Write the appointment dialog component**

```typescript
// src/availability/components/appointment-dialog.tsx

import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Calendar, Clock, User, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/lib/utils'
import type { Appointment, AppointmentFormData, Professional, Client, Service } from '../types'
import { MOCK_PROFESSIONALS, MOCK_CLIENTS, MOCK_SERVICES } from '../mock'

interface AppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initialData?: {
    professionalId?: string
    date?: Date
    time?: string
    appointment?: Appointment
  }
  onSubmit: (data: AppointmentFormData) => void
}

// Generate time options from 06:00 to 21:30 in 30-min intervals
function generateTimeOptions(): string[] {
  const options: string[] = []
  for (let hour = 6; hour < 22; hour++) {
    options.push(`${hour.toString().padStart(2, '0')}:00`)
    options.push(`${hour.toString().padStart(2, '0')}:30`)
  }
  return options
}

const TIME_OPTIONS = generateTimeOptions()

export function AppointmentDialog({
  open,
  onOpenChange,
  mode,
  initialData,
  onSubmit,
}: AppointmentDialogProps) {
  const [professionalId, setProfessionalId] = useState('')
  const [clientId, setClientId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(50)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Initialize form when dialog opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && initialData?.appointment) {
        const apt = initialData.appointment
        const startDate = new Date(apt.startTime)
        setProfessionalId(apt.professionalId)
        setClientId(apt.clientId)
        setServiceId(apt.serviceId)
        setDate(format(startDate, 'yyyy-MM-dd'))
        setTime(format(startDate, 'HH:mm'))
        setDurationMinutes(apt.durationMinutes)
        setNotes(apt.notesInternal || '')
      } else {
        // Create mode
        setProfessionalId(initialData?.professionalId || '')
        setClientId('')
        setServiceId('')
        setDate(initialData?.date ? format(initialData.date, 'yyyy-MM-dd') : '')
        setTime(initialData?.time || '')
        setDurationMinutes(50)
        setNotes('')
      }
      setErrors({})
    }
  }, [open, mode, initialData])

  // Update duration when service changes
  useEffect(() => {
    if (serviceId) {
      const service = MOCK_SERVICES.find(s => s.id === serviceId)
      if (service) {
        setDurationMinutes(service.durationMinutes)
      }
    }
  }, [serviceId])

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!professionalId) newErrors.professionalId = 'Requis'
    if (!clientId) newErrors.clientId = 'Requis'
    if (!serviceId) newErrors.serviceId = 'Requis'
    if (!date) newErrors.date = 'Requis'
    if (!time) newErrors.time = 'Requis'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return

    onSubmit({
      professionalId,
      clientId,
      serviceId,
      startDate: date,
      startTime: time,
      durationMinutes,
      notesInternal: notes || undefined,
    })
    onOpenChange(false)
  }

  const selectedService = MOCK_SERVICES.find(s => s.id === serviceId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Nouveau rendez-vous' : 'Modifier le rendez-vous'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Créez un nouveau rendez-vous pour ce professionnel.'
              : 'Modifiez les informations du rendez-vous.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Professional */}
          <div className="space-y-2">
            <Label htmlFor="professional">Professionnel</Label>
            <Select
              id="professional"
              value={professionalId}
              onChange={(e) => setProfessionalId(e.target.value)}
              className={cn(errors.professionalId && 'border-wine-500')}
            >
              <option value="">Sélectionner...</option>
              {MOCK_PROFESSIONALS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
            {errors.professionalId && (
              <p className="text-xs text-wine-600">{errors.professionalId}</p>
            )}
          </div>

          {/* Client */}
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            <Select
              id="client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={cn(errors.clientId && 'border-wine-500')}
            >
              <option value="">Sélectionner...</option>
              {MOCK_CLIENTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </Select>
            {errors.clientId && (
              <p className="text-xs text-wine-600">{errors.clientId}</p>
            )}
          </div>

          {/* Service */}
          <div className="space-y-2">
            <Label htmlFor="service">Service</Label>
            <Select
              id="service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={cn(errors.serviceId && 'border-wine-500')}
            >
              <option value="">Sélectionner...</option>
              {MOCK_SERVICES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameFr} ({s.durationMinutes} min)
                </option>
              ))}
            </Select>
            {errors.serviceId && (
              <p className="text-xs text-wine-600">{errors.serviceId}</p>
            )}
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={cn(errors.date && 'border-wine-500')}
              />
              {errors.date && (
                <p className="text-xs text-wine-600">{errors.date}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Heure</Label>
              <Select
                id="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cn(errors.time && 'border-wine-500')}
              >
                <option value="">Sélectionner...</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              {errors.time && (
                <p className="text-xs text-wine-600">{errors.time}</p>
              )}
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="duration">Durée (minutes)</Label>
            <Input
              id="duration"
              type="number"
              min={15}
              max={180}
              step={5}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 50)}
            />
            {selectedService && durationMinutes !== selectedService.durationMinutes && (
              <p className="text-xs text-foreground-muted">
                Durée par défaut du service : {selectedService.durationMinutes} min
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes internes (optionnel)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes visibles uniquement par l'équipe..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit}>
            {mode === 'create' ? 'Créer le rendez-vous' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/appointment-dialog.tsx
git commit -m "feat(availability): add AppointmentDialog for create/edit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Create Appointment Detail Drawer Component

**Files:**
- Create: `src/availability/components/appointment-detail-drawer.tsx`

**Step 1: Write the appointment detail drawer component**

```typescript
// src/availability/components/appointment-detail-drawer.tsx

import { useMemo } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Calendar, Clock, User, FileText, X, Edit2, XCircle, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import type { Appointment } from '../types'
import { MOCK_PROFESSIONALS, MOCK_CLIENTS, MOCK_SERVICES } from '../mock'

interface AppointmentDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  onEdit: (appointment: Appointment) => void
  onCancel: (id: string) => void
  onRestore: (id: string) => void
}

export function AppointmentDetailDrawer({
  open,
  onOpenChange,
  appointment,
  onEdit,
  onCancel,
  onRestore,
}: AppointmentDetailDrawerProps) {
  const details = useMemo(() => {
    if (!appointment) return null

    const professional = MOCK_PROFESSIONALS.find(p => p.id === appointment.professionalId)
    const client = MOCK_CLIENTS.find(c => c.id === appointment.clientId)
    const service = MOCK_SERVICES.find(s => s.id === appointment.serviceId)

    const startTime = new Date(appointment.startTime)
    const endTime = new Date(startTime.getTime() + appointment.durationMinutes * 60000)

    return {
      professional,
      client,
      service,
      startTime,
      endTime,
    }
  }, [appointment])

  if (!appointment || !details) return null

  const isCancelled = appointment.status === 'cancelled'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <span>Détails du rendez-vous</span>
              {isCancelled && (
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-wine-50 text-wine-700">
                  Annulé
                </span>
              )}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Service with color indicator */}
          <div className="flex items-start gap-3">
            <div
              className="w-3 h-3 rounded-full mt-1 shrink-0"
              style={{ backgroundColor: details.service?.colorHex }}
            />
            <div>
              <p className={cn(
                'font-medium',
                isCancelled && 'line-through text-foreground-muted'
              )}>
                {details.service?.nameFr || 'Service'}
              </p>
              <p className="text-sm text-foreground-muted">
                {appointment.durationMinutes} minutes
              </p>
            </div>
          </div>

          {/* Client */}
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-foreground-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-foreground-muted">Client</p>
              <p className={cn(
                'font-medium',
                isCancelled && 'line-through text-foreground-muted'
              )}>
                {details.client
                  ? `${details.client.firstName} ${details.client.lastName}`
                  : 'Client inconnu'}
              </p>
              {details.client?.email && (
                <p className="text-xs text-foreground-muted">{details.client.email}</p>
              )}
              {details.client?.phone && (
                <p className="text-xs text-foreground-muted">{details.client.phone}</p>
              )}
            </div>
          </div>

          {/* Date & Time */}
          <div className="flex items-start gap-3">
            <Calendar className="h-4 w-4 text-foreground-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-foreground-muted">Date et heure</p>
              <p className={cn(
                'font-medium capitalize',
                isCancelled && 'line-through text-foreground-muted'
              )}>
                {format(details.startTime, 'EEEE d MMMM yyyy', { locale: fr })}
              </p>
              <p className={cn(
                'text-sm',
                isCancelled ? 'text-foreground-muted' : 'text-foreground-secondary'
              )}>
                {format(details.startTime, 'HH:mm')} – {format(details.endTime, 'HH:mm')}
              </p>
            </div>
          </div>

          {/* Professional */}
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-foreground-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-foreground-muted">Professionnel</p>
              <p className="font-medium">
                {details.professional?.displayName || 'Professionnel inconnu'}
              </p>
            </div>
          </div>

          {/* Notes */}
          {appointment.notesInternal && (
            <div className="flex items-start gap-3">
              <FileText className="h-4 w-4 text-foreground-muted mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-foreground-muted">Notes internes</p>
                <p className="text-sm">{appointment.notesInternal}</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-border">
          {isCancelled ? (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                onRestore(appointment.id)
                onOpenChange(false)
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Restaurer
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  onEdit(appointment)
                  onOpenChange(false)
                }}
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Modifier
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-wine-600 hover:text-wine-700 hover:bg-wine-50"
                onClick={() => {
                  onCancel(appointment.id)
                  onOpenChange(false)
                }}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Annuler
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Commit**

```bash
git add src/availability/components/appointment-detail-drawer.tsx
git commit -m "feat(availability): add AppointmentDetailDrawer with edit/cancel/restore actions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Create Components Barrel Export

**Files:**
- Create: `src/availability/components/index.ts`

**Step 1: Write the barrel export**

```typescript
// src/availability/components/index.ts

export { CalendarGrid } from './calendar-grid'
export { AppointmentBlock } from './appointment-block'
export { WeekNavigation } from './week-navigation'
export { ProfessionalSelector } from './professional-selector'
export { AppointmentDialog } from './appointment-dialog'
export { AppointmentDetailDrawer } from './appointment-detail-drawer'
```

**Step 2: Commit**

```bash
git add src/availability/components/index.ts
git commit -m "feat(availability): add components barrel export

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Create Module Barrel Export

**Files:**
- Create: `src/availability/index.ts`

**Step 1: Write the module barrel export**

```typescript
// src/availability/index.ts

export * from './types'
export * from './mock'
export * from './hooks'
export * from './components'
```

**Step 2: Commit**

```bash
git add src/availability/index.ts
git commit -m "feat(availability): add module barrel export

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Update i18n Translations

**Files:**
- Modify: `src/i18n/fr-CA.json`

**Step 1: Add availability translations**

Add to `pages.availability` section (around line 593-601):

```json
"availability": {
  "title": "Disponibilités",
  "subtitle": "Gérez les rendez-vous et disponibilités des professionnels",
  "action": "Nouveau rendez-vous",
  "empty": {
    "title": "Aucun rendez-vous cette semaine",
    "description": "Les rendez-vous apparaîtront ici une fois créés."
  },
  "selectProfessional": "Sélectionnez un professionnel pour voir son calendrier",
  "weekView": "Vue 7 jours",
  "noAppointments": "Aucun rendez-vous cette semaine",
  "appointment": {
    "create": {
      "title": "Nouveau rendez-vous",
      "description": "Créez un nouveau rendez-vous pour ce professionnel."
    },
    "edit": {
      "title": "Modifier le rendez-vous",
      "description": "Modifiez les informations du rendez-vous."
    },
    "detail": {
      "title": "Détails du rendez-vous"
    },
    "fields": {
      "professional": "Professionnel",
      "client": "Client",
      "service": "Service",
      "date": "Date",
      "time": "Heure",
      "duration": "Durée (minutes)",
      "notes": "Notes internes"
    },
    "actions": {
      "create": "Créer le rendez-vous",
      "save": "Enregistrer",
      "cancel": "Annuler le rendez-vous",
      "restore": "Restaurer",
      "edit": "Modifier"
    },
    "status": {
      "scheduled": "Planifié",
      "cancelled": "Annulé"
    },
    "validation": {
      "required": "Ce champ est requis"
    }
  },
  "navigation": {
    "previousWeek": "Semaine précédente",
    "nextWeek": "Semaine suivante",
    "today": "Aujourd'hui",
    "thisWeek": "Cette semaine"
  }
}
```

**Step 2: Commit**

```bash
git add src/i18n/fr-CA.json
git commit -m "feat(availability): add i18n translations for availability module

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Rewrite AvailabilityPage

**Files:**
- Modify: `src/pages/availability.tsx`

**Step 1: Rewrite the page with full functionality**

```typescript
// src/pages/availability.tsx

import { useState, useCallback, useMemo } from 'react'
import { startOfWeek } from 'date-fns'
import { Plus, Calendar as CalendarIcon } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  CalendarGrid,
  WeekNavigation,
  ProfessionalSelector,
  AppointmentDialog,
  AppointmentDetailDrawer,
  useAppointments,
  useAppointmentsByProfessional,
  useAppointmentsForWeek,
  type Appointment,
  type AppointmentFormData,
} from '@/availability'

export function AvailabilityPage() {
  // Calendar view state
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>('pro-1')
  const [weekStartDate, setWeekStartDate] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )

  // Appointments state
  const {
    appointments,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  } = useAppointments()

  // Filter appointments for selected professional and week
  const professionalAppointments = useAppointmentsByProfessional(appointments, selectedProfessionalId)
  const weekAppointments = useAppointmentsForWeek(professionalAppointments, weekStartDate)

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [slotClickData, setSlotClickData] = useState<{ date: Date; time: string } | null>(null)

  // Handle slot click (create new appointment)
  const handleSlotClick = useCallback((date: Date, time: string) => {
    if (!selectedProfessionalId) {
      toast({
        title: 'Sélectionnez un professionnel',
        description: 'Veuillez d\'abord sélectionner un professionnel.',
        variant: 'error',
      })
      return
    }
    setSlotClickData({ date, time })
    setCreateDialogOpen(true)
  }, [selectedProfessionalId])

  // Handle appointment click (show details)
  const handleAppointmentClick = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(true)
  }, [])

  // Handle edit from detail drawer
  const handleEditFromDetail = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setEditDialogOpen(true)
  }, [])

  // Handle create submission
  const handleCreate = useCallback((data: AppointmentFormData) => {
    createAppointment(data)
    toast({ title: 'Rendez-vous créé' })
    setSlotClickData(null)
  }, [createAppointment])

  // Handle edit submission
  const handleEdit = useCallback((data: AppointmentFormData) => {
    if (!selectedAppointment) return
    updateAppointment(selectedAppointment.id, data)
    toast({ title: 'Rendez-vous modifié' })
    setSelectedAppointment(null)
  }, [selectedAppointment, updateAppointment])

  // Handle cancel
  const handleCancel = useCallback((id: string) => {
    cancelAppointment(id)
    toast({ title: 'Rendez-vous annulé' })
  }, [cancelAppointment])

  // Handle restore
  const handleRestore = useCallback((id: string) => {
    restoreAppointment(id)
    toast({ title: 'Rendez-vous restauré' })
  }, [restoreAppointment])

  // Handle new appointment button
  const handleNewAppointment = useCallback(() => {
    if (!selectedProfessionalId) {
      toast({
        title: 'Sélectionnez un professionnel',
        description: 'Veuillez d\'abord sélectionner un professionnel.',
        variant: 'error',
      })
      return
    }
    setSlotClickData(null)
    setCreateDialogOpen(true)
  }, [selectedProfessionalId])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.availability.title')}
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            {t('pages.availability.subtitle')}
          </p>
        </div>
        <Button onClick={handleNewAppointment}>
          <Plus className="h-4 w-4" />
          {t('pages.availability.action')}
        </Button>
      </div>

      {/* Controls: Professional selector + Week navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ProfessionalSelector
          selectedId={selectedProfessionalId}
          onSelect={setSelectedProfessionalId}
        />
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <span className="font-medium text-sage-700">7 jours</span>
        </div>
      </div>

      {/* Week navigation */}
      <WeekNavigation
        weekStartDate={weekStartDate}
        onWeekChange={setWeekStartDate}
      />

      {/* Content */}
      {!selectedProfessionalId ? (
        <EmptyState
          icon={<CalendarIcon className="h-8 w-8" />}
          title="Sélectionnez un professionnel"
          description={t('pages.availability.selectProfessional')}
        />
      ) : (
        <div className="relative">
          <CalendarGrid
            weekStartDate={weekStartDate}
            appointments={weekAppointments}
            onSlotClick={handleSlotClick}
            onAppointmentClick={handleAppointmentClick}
          />

          {/* Empty week indicator */}
          {weekAppointments.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-sm text-foreground-muted bg-background/80 px-4 py-2 rounded-lg">
                {t('pages.availability.noAppointments')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Create dialog */}
      <AppointmentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mode="create"
        initialData={{
          professionalId: selectedProfessionalId || undefined,
          date: slotClickData?.date,
          time: slotClickData?.time,
        }}
        onSubmit={handleCreate}
      />

      {/* Edit dialog */}
      <AppointmentDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode="edit"
        initialData={{
          appointment: selectedAppointment || undefined,
        }}
        onSubmit={handleEdit}
      />

      {/* Detail drawer */}
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
git commit -m "feat(availability): implement full AvailabilityPage with calendar and appointment management

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Verify Build and Test

**Step 1: Run type check**

```bash
npm run typecheck
```

Expected: No type errors

**Step 2: Run lint**

```bash
npm run lint
```

Expected: No lint errors (or fix any that appear)

**Step 3: Run dev server and manually test**

```bash
npm run dev
```

Manual verification checklist:
- [ ] Navigate to /disponibilites
- [ ] Professional selector works and is searchable
- [ ] Week navigation works (prev/next/today)
- [ ] Calendar grid displays 7 days, 06:00-22:00
- [ ] Mock appointments display with correct colors and status
- [ ] Click empty slot opens create dialog
- [ ] Create appointment adds it to calendar
- [ ] Click appointment opens detail drawer
- [ ] Edit from detail drawer works
- [ ] Cancel appointment shows cancelled styling
- [ ] Restore cancelled appointment works

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(availability): complete Phase 1 UI implementation

- 7-day calendar view with 30-min intervals (06:00-22:00)
- Professional selector with search
- Week navigation with today button
- Appointment blocks with service colors and status styling
- Create/edit/cancel/restore appointment flows
- All mock data, no database integration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This plan creates a complete UI-only availability module with:

1. **Types** - TypeScript interfaces for Professional, Client, Service, Appointment
2. **Mock Data** - Professionals, clients, services, and sample appointments
3. **Hooks** - Local state management for appointments CRUD
4. **Components**:
   - `CalendarGrid` - 7-day view with time slots
   - `AppointmentBlock` - Styled appointment cards
   - `WeekNavigation` - Week prev/next/today controls
   - `ProfessionalSelector` - Searchable combobox
   - `AppointmentDialog` - Create/edit form
   - `AppointmentDetailDrawer` - View/edit/cancel drawer
5. **Page** - Full availability page tying it all together
6. **i18n** - French-Canadian translations

Total: 14 tasks, each with small commits for easy rollback.
