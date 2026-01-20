# Disponibilités v3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform availability module into service-first booking system with drag interactions and availability constraints.

**Architecture:** Two-mode UI (Disponibilités/Rendez-vous) with collapsible sidebar, dominant calendar grid, and overlay detail sheet. Users drag services from sidebar to create bookings within availability blocks.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui (Sheet, Command), Radix UI, date-fns, native PointerEvents.

---

## Task 1: Update Types for v3 Data Model

**Files:**
- Modify: `src/availability/types.ts`

**Step 1: Add availability types**

Add after existing types:

```typescript
// Availability block types
export type AvailabilityType = 'available' | 'blocked' | 'vacation' | 'break'

export interface AvailabilityBlock {
  id: string
  professionalId: string
  type: AvailabilityType
  label?: string
  startTime: string
  endTime: string
  isRecurring: boolean
  allowedServiceIds?: string[]
  visibleToClients: boolean
  createdAt: string
  updatedAt: string
}
```

**Step 2: Add bookable service types**

```typescript
// Service client types for booking
export type ServiceClientType = 'individual' | 'couple' | 'family'

export interface BookableService {
  id: string
  nameFr: string
  durationMinutes: number
  colorHex: string
  clientType: ServiceClientType
  minClients: number
  maxClients: number
  compatibleProfessionKeys: string[]
}
```

**Step 3: Update Appointment type**

Replace existing AppointmentStatus and Appointment:

```typescript
export type AppointmentStatus = 'draft' | 'confirmed' | 'cancelled'
export type AppointmentMode = 'in_person' | 'video' | 'phone'

export interface Appointment {
  id: string
  professionalId: string
  clientIds: string[]
  serviceId: string
  startTime: string
  durationMinutes: number
  status: AppointmentStatus
  mode?: AppointmentMode
  notesInternal?: string
  cancelledAt?: string
  cancellationReason?: string
  createdAt: string
  updatedAt: string
}
```

**Step 4: Add calendar mode type**

```typescript
export type CalendarMode = 'availability' | 'booking'
```

**Step 5: Update Professional type**

```typescript
export interface Professional {
  id: string
  displayName: string
  avatarUrl?: string
  professionKeys: string[]
}
```

**Step 6: Verify and commit**

```bash
npx tsc --noEmit
git add src/availability/types.ts
git commit -m "feat(availability): update types for v3 data model"
```

---

## Task 2: Create Extended Mock Data

**Files:**
- Modify: `src/availability/mock/mock-data.ts`

**Step 1: Update MOCK_PROFESSIONALS**

```typescript
export const MOCK_PROFESSIONALS: Professional[] = [
  { id: 'pro-1', displayName: 'Dre Marie Tremblay', professionKeys: ['psychologue'] },
  { id: 'pro-2', displayName: 'Jean-Philippe Bouchard', professionKeys: ['psychotherapeute', 'travailleur_social'] },
  { id: 'pro-3', displayName: 'Sophie Gagnon', professionKeys: ['psychologue', 'neuropsychologue'] },
]
```

**Step 2: Create MOCK_BOOKABLE_SERVICES**

```typescript
export const MOCK_BOOKABLE_SERVICES: BookableService[] = [
  {
    id: 'svc-1',
    nameFr: 'Consultation individuelle',
    durationMinutes: 50,
    colorHex: '#7FAE9D',
    clientType: 'individual',
    minClients: 1,
    maxClients: 1,
    compatibleProfessionKeys: ['psychologue', 'psychotherapeute', 'travailleur_social', 'neuropsychologue'],
  },
  {
    id: 'svc-2',
    nameFr: 'Consultation couple',
    durationMinutes: 75,
    colorHex: '#D4A5A5',
    clientType: 'couple',
    minClients: 2,
    maxClients: 2,
    compatibleProfessionKeys: ['psychologue', 'psychotherapeute'],
  },
  {
    id: 'svc-3',
    nameFr: 'Thérapie familiale',
    durationMinutes: 90,
    colorHex: '#B4C7DC',
    clientType: 'family',
    minClients: 2,
    maxClients: 6,
    compatibleProfessionKeys: ['psychologue', 'travailleur_social'],
  },
  {
    id: 'svc-4',
    nameFr: 'Appel découverte',
    durationMinutes: 15,
    colorHex: '#E8D4B8',
    clientType: 'individual',
    minClients: 1,
    maxClients: 1,
    compatibleProfessionKeys: ['psychologue', 'psychotherapeute', 'travailleur_social', 'neuropsychologue'],
  },
  {
    id: 'svc-5',
    nameFr: 'Évaluation neuropsychologique',
    durationMinutes: 120,
    colorHex: '#C9B8E8',
    clientType: 'individual',
    minClients: 1,
    maxClients: 1,
    compatibleProfessionKeys: ['neuropsychologue'],
  },
]
```

**Step 3: Create MOCK_AVAILABILITY_BLOCKS**

```typescript
const now = new Date().toISOString()

export const MOCK_AVAILABILITY_BLOCKS: AvailabilityBlock[] = [
  // Monday - pro-1
  {
    id: 'avail-1',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(monday, 8, 0),
    endTime: formatDateTime(monday, 12, 0),
    isRecurring: false,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'avail-2',
    professionalId: 'pro-1',
    type: 'break',
    label: 'Pause dîner',
    startTime: formatDateTime(monday, 12, 0),
    endTime: formatDateTime(monday, 13, 0),
    isRecurring: false,
    visibleToClients: false,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'avail-3',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(monday, 13, 0),
    endTime: formatDateTime(monday, 17, 0),
    isRecurring: false,
    allowedServiceIds: ['svc-1', 'svc-4'], // Only individual + discovery
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Tuesday - pro-1
  {
    id: 'avail-4',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 1), 9, 0),
    endTime: formatDateTime(addDays(monday, 1), 17, 0),
    isRecurring: false,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Wednesday - pro-1
  {
    id: 'avail-5',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 2), 8, 0),
    endTime: formatDateTime(addDays(monday, 2), 12, 0),
    isRecurring: false,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'avail-6',
    professionalId: 'pro-1',
    type: 'vacation',
    label: 'Congé personnel',
    startTime: formatDateTime(addDays(monday, 2), 12, 0),
    endTime: formatDateTime(addDays(monday, 2), 17, 0),
    isRecurring: false,
    visibleToClients: false,
    createdAt: now,
    updatedAt: now,
  },
  // Thursday - pro-1
  {
    id: 'avail-7',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 3), 10, 0),
    endTime: formatDateTime(addDays(monday, 3), 18, 0),
    isRecurring: false,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Friday - pro-1
  {
    id: 'avail-8',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 4), 8, 0),
    endTime: formatDateTime(addDays(monday, 4), 15, 0),
    isRecurring: false,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Pro-2 Thursday
  {
    id: 'avail-9',
    professionalId: 'pro-2',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 3), 9, 0),
    endTime: formatDateTime(addDays(monday, 3), 17, 0),
    isRecurring: false,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
]
```

**Step 4: Update MOCK_APPOINTMENTS for multi-client**

```typescript
export const MOCK_APPOINTMENTS: Appointment[] = [
  // Confirmed individual
  {
    id: 'apt-1',
    professionalId: 'pro-1',
    clientIds: ['cli-1'],
    serviceId: 'svc-1',
    startTime: formatDateTime(monday, 9, 0),
    durationMinutes: 50,
    status: 'confirmed',
    mode: 'in_person',
    createdAt: now,
    updatedAt: now,
  },
  // Confirmed individual
  {
    id: 'apt-2',
    professionalId: 'pro-1',
    clientIds: ['cli-2'],
    serviceId: 'svc-1',
    startTime: formatDateTime(monday, 10, 0),
    durationMinutes: 50,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  },
  // Cancelled couple
  {
    id: 'apt-3',
    professionalId: 'pro-1',
    clientIds: ['cli-3', 'cli-4'],
    serviceId: 'svc-2',
    startTime: formatDateTime(monday, 14, 0),
    durationMinutes: 75,
    status: 'cancelled',
    cancelledAt: now,
    cancellationReason: 'Client a annulé - maladie',
    createdAt: now,
    updatedAt: now,
  },
  // Draft (no client assigned)
  {
    id: 'apt-4',
    professionalId: 'pro-1',
    clientIds: [],
    serviceId: 'svc-4',
    startTime: formatDateTime(addDays(monday, 1), 9, 30),
    durationMinutes: 15,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  },
  // Confirmed
  {
    id: 'apt-5',
    professionalId: 'pro-1',
    clientIds: ['cli-1'],
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 1), 11, 0),
    durationMinutes: 50,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  },
  // Wednesday
  {
    id: 'apt-6',
    professionalId: 'pro-1',
    clientIds: ['cli-5'],
    serviceId: 'svc-4',
    startTime: formatDateTime(addDays(monday, 2), 8, 0),
    durationMinutes: 15,
    status: 'confirmed',
    notesInternal: 'Premier contact',
    createdAt: now,
    updatedAt: now,
  },
  // Thursday - different professional
  {
    id: 'apt-7',
    professionalId: 'pro-2',
    clientIds: ['cli-3'],
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 3), 10, 0),
    durationMinutes: 50,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  },
  // Friday
  {
    id: 'apt-8',
    professionalId: 'pro-1',
    clientIds: ['cli-4'],
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 4), 13, 0),
    durationMinutes: 50,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  },
]
```

**Step 5: Export new data**

Add exports for new constants.

**Step 6: Verify and commit**

```bash
npx tsc --noEmit
git add src/availability/mock/mock-data.ts
git commit -m "feat(availability): add v3 mock data with availability blocks"
```

---

## Task 3: Create Mode Toggle Component

**Files:**
- Create: `src/availability/components/mode-toggle.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create ModeToggle**

```typescript
// src/availability/components/mode-toggle.tsx

import { cn } from '@/shared/lib/utils'
import type { CalendarMode } from '../types'

interface ModeToggleProps {
  mode: CalendarMode
  onModeChange: (mode: CalendarMode) => void
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="flex rounded-lg bg-background-tertiary/50 p-1">
      <button
        onClick={() => onModeChange('availability')}
        className={cn(
          'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
          mode === 'availability'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-foreground-muted hover:text-foreground'
        )}
      >
        Disponibilités
      </button>
      <button
        onClick={() => onModeChange('booking')}
        className={cn(
          'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
          mode === 'booking'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-foreground-muted hover:text-foreground'
        )}
      >
        Rendez-vous
      </button>
    </div>
  )
}
```

**Step 2: Export from index**

Add: `export { ModeToggle } from './mode-toggle'`

**Step 3: Commit**

```bash
git add src/availability/components/mode-toggle.tsx src/availability/components/index.ts
git commit -m "feat(availability): add mode toggle component"
```

---

## Task 4: Create Collapsible Sidebar Shell

**Files:**
- Create: `src/availability/components/collapsible-sidebar.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create CollapsibleSidebar**

```typescript
// src/availability/components/collapsible-sidebar.tsx

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface CollapsibleSidebarProps {
  children: React.ReactNode
  collapsedContent?: React.ReactNode
}

export function CollapsibleSidebar({ children, collapsedContent }: CollapsibleSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <aside
      className={cn(
        'relative border-r border-border bg-background-secondary/30 flex flex-col transition-all duration-200',
        isExpanded ? 'w-60' : 'w-14'
      )}
    >
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="absolute -right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-background-secondary transition-colors"
        aria-label={isExpanded ? 'Réduire le panneau' : 'Agrandir le panneau'}
      >
        {isExpanded ? (
          <ChevronLeft className="h-3.5 w-3.5 text-foreground-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-foreground-muted" />
        )}
      </button>

      {/* Content */}
      <div className={cn('flex-1 overflow-hidden', isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        {children}
      </div>

      {/* Collapsed content (icons only) */}
      {!isExpanded && collapsedContent && (
        <div className="flex-1 flex flex-col items-center py-4 gap-2">
          {collapsedContent}
        </div>
      )}
    </aside>
  )
}
```

**Step 2: Export and commit**

```bash
git add src/availability/components/collapsible-sidebar.tsx src/availability/components/index.ts
git commit -m "feat(availability): add collapsible sidebar shell"
```

---

## Task 5: Create Availability Sidebar Content

**Files:**
- Create: `src/availability/components/availability-sidebar.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create AvailabilitySidebar**

```typescript
// src/availability/components/availability-sidebar.tsx

import { useMemo } from 'react'
import { format, isSameDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Plus, Ban, Clock } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import type { AvailabilityBlock } from '../types'

interface AvailabilitySidebarProps {
  availabilityBlocks: AvailabilityBlock[]
  weekStartDate: Date
  onCreateAvailability: (type: 'available' | 'blocked') => void
  onBlockClick: (block: AvailabilityBlock) => void
}

const TYPE_LABELS: Record<string, string> = {
  available: 'Disponible',
  blocked: 'Bloqué',
  vacation: 'Vacances',
  break: 'Pause',
}

const TYPE_COLORS: Record<string, string> = {
  available: 'bg-sage-100 text-sage-700',
  blocked: 'bg-wine-100 text-wine-700',
  vacation: 'bg-amber-100 text-amber-700',
  break: 'bg-slate-100 text-slate-600',
}

export function AvailabilitySidebar({
  availabilityBlocks,
  weekStartDate,
  onCreateAvailability,
  onBlockClick,
}: AvailabilitySidebarProps) {
  // Filter blocks for current week
  const weekBlocks = useMemo(() => {
    const weekEnd = new Date(weekStartDate)
    weekEnd.setDate(weekEnd.getDate() + 7)

    return availabilityBlocks
      .filter(block => {
        const blockStart = new Date(block.startTime)
        return blockStart >= weekStartDate && blockStart < weekEnd
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [availabilityBlocks, weekStartDate])

  return (
    <div className="flex flex-col h-full p-4">
      {/* Quick actions */}
      <div className="space-y-2 mb-6">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Actions rapides
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onCreateAvailability('available')}
        >
          <Plus className="h-4 w-4 text-sage-600" />
          Disponible
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onCreateAvailability('blocked')}
        >
          <Ban className="h-4 w-4 text-wine-600" />
          Bloquer temps
        </Button>
      </div>

      {/* Blocks list */}
      <div className="flex-1 overflow-y-auto">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Blocs cette semaine
        </h3>

        {weekBlocks.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun bloc défini</p>
        ) : (
          <div className="space-y-2">
            {weekBlocks.map(block => {
              const startDate = new Date(block.startTime)
              const endDate = new Date(block.endTime)

              return (
                <button
                  key={block.id}
                  onClick={() => onBlockClick(block)}
                  className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded', TYPE_COLORS[block.type])}>
                      {TYPE_LABELS[block.type]}
                    </span>
                    {block.label && (
                      <span className="text-xs text-foreground-muted truncate">{block.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                    <Clock className="h-3 w-3" />
                    {format(startDate, 'EEE d', { locale: fr })} · {format(startDate, 'HH:mm')}–{format(endDate, 'HH:mm')}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Export and commit**

```bash
git add src/availability/components/availability-sidebar.tsx src/availability/components/index.ts
git commit -m "feat(availability): add availability sidebar content"
```

---

## Task 6: Create Booking Sidebar with Services Palette

**Files:**
- Create: `src/availability/components/booking-sidebar.tsx`
- Create: `src/availability/components/service-drag-item.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create ServiceDragItem**

```typescript
// src/availability/components/service-drag-item.tsx

import { GripVertical, User, Users } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { BookableService } from '../types'

interface ServiceDragItemProps {
  service: BookableService
  onDragStart: (e: React.DragEvent, service: BookableService) => void
  disabled?: boolean
}

const CLIENT_TYPE_ICONS = {
  individual: User,
  couple: Users,
  family: Users,
}

const CLIENT_TYPE_LABELS = {
  individual: 'Individuel',
  couple: 'Couple',
  family: 'Famille',
}

export function ServiceDragItem({ service, onDragStart, disabled }: ServiceDragItemProps) {
  const Icon = CLIENT_TYPE_ICONS[service.clientType]

  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, service)}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg border transition-all',
        disabled
          ? 'opacity-50 cursor-not-allowed border-border-light bg-background-tertiary/30'
          : 'cursor-grab active:cursor-grabbing hover:shadow-md hover:border-sage-300 border-border bg-background'
      )}
    >
      <GripVertical className="h-4 w-4 text-foreground-muted flex-shrink-0" />

      <div
        className="w-2 h-8 rounded-full flex-shrink-0"
        style={{ backgroundColor: service.colorHex }}
      />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {service.nameFr}
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <span>{service.durationMinutes} min</span>
          <span className="flex items-center gap-0.5">
            <Icon className="h-3 w-3" />
            {CLIENT_TYPE_LABELS[service.clientType]}
          </span>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Create BookingSidebar**

```typescript
// src/availability/components/booking-sidebar.tsx

import { useMemo } from 'react'
import { format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Appointment, BookableService, Professional } from '../types'
import { ServiceDragItem } from './service-drag-item'
import { MOCK_BOOKABLE_SERVICES, MOCK_CLIENTS } from '../mock'

interface BookingSidebarProps {
  professional: Professional | null
  appointments: Appointment[]
  onServiceDragStart: (e: React.DragEvent, service: BookableService) => void
  onAppointmentClick: (appointment: Appointment) => void
}

function getDateLabel(date: Date): string {
  if (isToday(date)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return format(date, 'EEEE d MMMM', { locale: fr })
}

export function BookingSidebar({
  professional,
  appointments,
  onServiceDragStart,
  onAppointmentClick,
}: BookingSidebarProps) {
  // Filter services compatible with professional
  const availableServices = useMemo(() => {
    if (!professional) return []
    return MOCK_BOOKABLE_SERVICES.filter(service =>
      service.compatibleProfessionKeys.some(key => professional.professionKeys.includes(key))
    )
  }, [professional])

  // Get upcoming appointments (today + next 7 days)
  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date())
    return appointments
      .filter(apt => {
        const aptDate = new Date(apt.startTime)
        return aptDate >= today && apt.status !== 'cancelled'
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 8)
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

  const getService = (id: string) => MOCK_BOOKABLE_SERVICES.find(s => s.id === id)
  const getClientNames = (ids: string[]) => {
    if (ids.length === 0) return 'Client à assigner'
    return ids
      .map(id => MOCK_CLIENTS.find(c => c.id === id))
      .filter(Boolean)
      .map(c => `${c!.firstName} ${c!.lastName}`)
      .join(', ')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Services palette */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Services disponibles
        </h3>

        {!professional ? (
          <p className="text-sm text-foreground-muted">Sélectionnez un professionnel</p>
        ) : availableServices.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun service compatible</p>
        ) : (
          <div className="space-y-2">
            {availableServices.map(service => (
              <ServiceDragItem
                key={service.id}
                service={service}
                onDragStart={onServiceDragStart}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upcoming list */}
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
                    const isDraft = apt.status === 'draft'
                    return (
                      <button
                        key={apt.id}
                        onClick={() => onAppointmentClick(apt)}
                        className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full"
                            style={{ backgroundColor: service?.colorHex || '#888' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className={cn(
                              'text-sm font-medium truncate',
                              isDraft ? 'text-foreground-muted italic' : 'text-foreground'
                            )}>
                              {getClientNames(apt.clientIds)}
                            </div>
                            <div className="text-xs text-foreground-muted">
                              {format(new Date(apt.startTime), 'HH:mm')} · {service?.nameFr}
                              {isDraft && ' · Brouillon'}
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
    </div>
  )
}
```

**Step 3: Export and commit**

```bash
git add src/availability/components/service-drag-item.tsx src/availability/components/booking-sidebar.tsx src/availability/components/index.ts
git commit -m "feat(availability): add booking sidebar with services palette"
```

---

## Task 7: Create Availability Block Visual Component

**Files:**
- Create: `src/availability/components/availability-block-visual.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create AvailabilityBlockVisual**

```typescript
// src/availability/components/availability-block-visual.tsx

import { format } from 'date-fns'
import { cn } from '@/shared/lib/utils'
import type { AvailabilityBlock } from '../types'

interface AvailabilityBlockVisualProps {
  block: AvailabilityBlock
  onClick: () => void
  isAvailabilityMode: boolean
}

const TYPE_STYLES = {
  available: {
    bg: 'bg-sage-50/60',
    border: 'border-sage-200',
    text: 'text-sage-700',
  },
  blocked: {
    bg: 'bg-wine-50/40',
    border: 'border-wine-200',
    text: 'text-wine-600',
  },
  vacation: {
    bg: 'bg-amber-50/40',
    border: 'border-amber-200',
    text: 'text-amber-700',
  },
  break: {
    bg: 'bg-slate-50/40',
    border: 'border-slate-200',
    text: 'text-slate-600',
  },
}

export function AvailabilityBlockVisual({
  block,
  onClick,
  isAvailabilityMode,
}: AvailabilityBlockVisualProps) {
  const styles = TYPE_STYLES[block.type]
  const startTime = new Date(block.startTime)
  const endTime = new Date(block.endTime)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full h-full rounded-md border transition-all text-left overflow-hidden',
        styles.bg,
        styles.border,
        isAvailabilityMode
          ? 'opacity-100 hover:shadow-sm cursor-pointer'
          : 'opacity-40 cursor-default pointer-events-none'
      )}
    >
      <div className="p-1.5">
        <div className={cn('text-[10px] font-medium uppercase tracking-wide', styles.text)}>
          {block.type === 'available' ? 'Dispo' : block.label || block.type}
        </div>
        {isAvailabilityMode && (
          <div className="text-[10px] text-foreground-muted">
            {format(startTime, 'HH:mm')}–{format(endTime, 'HH:mm')}
          </div>
        )}
      </div>
    </button>
  )
}
```

**Step 2: Export and commit**

```bash
git add src/availability/components/availability-block-visual.tsx src/availability/components/index.ts
git commit -m "feat(availability): add availability block visual component"
```

---

## Task 8: Create Detail Sheet Component

**Files:**
- Create: `src/availability/components/detail-sheet.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create DetailSheet wrapper**

```typescript
// src/availability/components/detail-sheet.tsx

import { useState, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'
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

interface DetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  hasUnsavedChanges?: boolean
}

export function DetailSheet({
  open,
  onOpenChange,
  title,
  children,
  hasUnsavedChanges = false,
}: DetailSheetProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && hasUnsavedChanges) {
        setShowConfirmDialog(true)
      } else {
        onOpenChange(newOpen)
      }
    },
    [hasUnsavedChanges, onOpenChange]
  )

  const handleConfirmClose = useCallback(() => {
    setShowConfirmDialog(false)
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">{children}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
            <AlertDialogDescription>
              Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer l'édition</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>
              Quitter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

**Step 2: Export and commit**

```bash
git add src/availability/components/detail-sheet.tsx src/availability/components/index.ts
git commit -m "feat(availability): add detail sheet with unsaved changes guard"
```

---

## Task 9: Create Availability Editor

**Files:**
- Create: `src/availability/components/availability-editor.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create AvailabilityEditor**

```typescript
// src/availability/components/availability-editor.tsx

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
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
  { value: 'blocked', label: 'Bloqué' },
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
          <Label htmlFor="label">Libellé (optionnel)</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Pause dîner, Formation..."
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
          <Label htmlFor="startTime">Début</Label>
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
        <input
          type="checkbox"
          id="visibleToClients"
          checked={visibleToClients}
          onChange={(e) => setVisibleToClients(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <Label htmlFor="visibleToClients" className="text-sm font-normal">
          Visible aux clients
        </Label>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-border">
        <Button onClick={handleSave} className="flex-1">
          {isNew ? 'Créer' : 'Enregistrer'}
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
```

**Step 2: Export and commit**

```bash
git add src/availability/components/availability-editor.tsx src/availability/components/index.ts
git commit -m "feat(availability): add availability editor form"
```

---

## Task 10: Create Appointment Editor

**Files:**
- Create: `src/availability/components/appointment-editor.tsx`
- Modify: `src/availability/components/index.ts`

**Step 1: Create AppointmentEditor**

```typescript
// src/availability/components/appointment-editor.tsx

import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { User, Users, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/lib/utils'
import type { Appointment, AppointmentStatus, AppointmentMode, BookableService } from '../types'
import { MOCK_BOOKABLE_SERVICES, MOCK_CLIENTS } from '../mock'

interface AppointmentEditorProps {
  appointment: Appointment | null
  onSave: (data: Partial<Appointment>) => void
  onCancel: () => void
  onCancelAppointment?: () => void
  onRestoreAppointment?: () => void
  onDirtyChange: (dirty: boolean) => void
}

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'confirmed', label: 'Confirmé' },
]

const MODE_OPTIONS: { value: AppointmentMode; label: string }[] = [
  { value: 'in_person', label: 'En personne' },
  { value: 'video', label: 'Vidéo' },
  { value: 'phone', label: 'Téléphone' },
]

export function AppointmentEditor({
  appointment,
  onSave,
  onCancel,
  onCancelAppointment,
  onRestoreAppointment,
  onDirtyChange,
}: AppointmentEditorProps) {
  const isNew = !appointment?.id || appointment.id.startsWith('new-')
  const isCancelled = appointment?.status === 'cancelled'

  const service = useMemo(
    () => MOCK_BOOKABLE_SERVICES.find(s => s.id === appointment?.serviceId),
    [appointment?.serviceId]
  )

  const [serviceId, setServiceId] = useState(appointment?.serviceId || '')
  const [clientIds, setClientIds] = useState<string[]>(appointment?.clientIds || [])
  const [date, setDate] = useState(
    appointment ? format(new Date(appointment.startTime), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  )
  const [startTime, setStartTime] = useState(
    appointment ? format(new Date(appointment.startTime), 'HH:mm') : '09:00'
  )
  const [durationMinutes, setDurationMinutes] = useState(appointment?.durationMinutes || service?.durationMinutes || 50)
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status === 'cancelled' ? 'confirmed' : (appointment?.status || 'draft'))
  const [mode, setMode] = useState<AppointmentMode>(appointment?.mode || 'in_person')
  const [notes, setNotes] = useState(appointment?.notesInternal || '')

  const selectedService = useMemo(
    () => MOCK_BOOKABLE_SERVICES.find(s => s.id === serviceId),
    [serviceId]
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
      date !== format(new Date(appointment.startTime), 'yyyy-MM-dd') ||
      startTime !== format(new Date(appointment.startTime), 'HH:mm') ||
      durationMinutes !== appointment.durationMinutes ||
      (appointment.status !== 'cancelled' && status !== appointment.status) ||
      mode !== (appointment.mode || 'in_person') ||
      notes !== (appointment.notesInternal || '')

    onDirtyChange(isDirty)
  }, [serviceId, clientIds, date, startTime, durationMinutes, status, mode, notes, appointment, onDirtyChange])

  const handleClientToggle = (clientId: string) => {
    if (!selectedService) return

    if (clientIds.includes(clientId)) {
      setClientIds(clientIds.filter(id => id !== clientId))
    } else if (clientIds.length < selectedService.maxClients) {
      setClientIds([...clientIds, clientId])
    }
  }

  const handleSave = () => {
    const startDateTime = new Date(`${date}T${startTime}:00`)

    onSave({
      serviceId,
      clientIds,
      startTime: startDateTime.toISOString(),
      durationMinutes,
      status,
      mode,
      notesInternal: notes || undefined,
    })
  }

  const clientCountValid = selectedService
    ? clientIds.length >= selectedService.minClients && clientIds.length <= selectedService.maxClients
    : true

  return (
    <div className="space-y-6">
      {/* Cancelled banner */}
      {isCancelled && (
        <div className="p-3 rounded-lg bg-wine-50 border border-wine-200">
          <div className="text-sm font-medium text-wine-700">Rendez-vous annulé</div>
          {appointment?.cancellationReason && (
            <div className="text-sm text-wine-600 mt-1">{appointment.cancellationReason}</div>
          )}
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
        </div>
      )}

      {/* Service display */}
      <div className="space-y-2">
        <Label>Service</Label>
        <div
          className="flex items-center gap-3 p-3 rounded-lg border border-border"
          style={{ backgroundColor: `${selectedService?.colorHex}15` }}
        >
          <div
            className="w-2 h-10 rounded-full"
            style={{ backgroundColor: selectedService?.colorHex }}
          />
          <div>
            <div className="font-medium">{selectedService?.nameFr || 'Service'}</div>
            <div className="text-sm text-foreground-muted">
              {selectedService?.durationMinutes} min · {selectedService?.clientType === 'individual' ? 'Individuel' : selectedService?.clientType === 'couple' ? 'Couple' : 'Famille'}
            </div>
          </div>
        </div>
      </div>

      {/* Client selection */}
      <div className="space-y-2">
        <Label>
          Client(s)
          {selectedService && (
            <span className="text-foreground-muted font-normal ml-2">
              ({clientIds.length}/{selectedService.maxClients} sélectionné{clientIds.length > 1 ? 's' : ''})
            </span>
          )}
        </Label>
        <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
          {MOCK_CLIENTS.map(client => {
            const isSelected = clientIds.includes(client.id)
            const canSelect = isSelected || (selectedService && clientIds.length < selectedService.maxClients)

            return (
              <button
                key={client.id}
                onClick={() => handleClientToggle(client.id)}
                disabled={!canSelect && !isSelected}
                className={cn(
                  'w-full flex items-center gap-2 p-2 rounded-md transition-colors text-left',
                  isSelected
                    ? 'bg-sage-100 text-sage-800'
                    : canSelect
                    ? 'hover:bg-background-tertiary'
                    : 'opacity-50 cursor-not-allowed'
                )}
              >
                <User className="h-4 w-4" />
                <span className="text-sm">{client.firstName} {client.lastName}</span>
              </button>
            )
          })}
        </div>
        {!clientCountValid && selectedService && (
          <p className="text-xs text-wine-600">
            {selectedService.clientType === 'couple'
              ? 'Sélectionnez 2 clients pour une consultation couple'
              : `Sélectionnez entre ${selectedService.minClients} et ${selectedService.maxClients} clients`}
          </p>
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
            disabled={isCancelled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startTime">Heure</Label>
          <Input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={isCancelled}
          />
        </div>
      </div>

      {/* Duration */}
      <div className="space-y-2">
        <Label htmlFor="duration">Durée (minutes)</Label>
        <Input
          id="duration"
          type="number"
          min={15}
          max={240}
          step={5}
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 50)}
          disabled={isCancelled}
        />
      </div>

      {/* Status & Mode */}
      {!isCancelled && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Statut</Label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-all',
                    status === opt.value
                      ? 'border-sage-400 bg-sage-50 text-sage-700'
                      : 'border-border hover:border-sage-300'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Modalité</Label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as AppointmentMode)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            >
              {MODE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes internes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes visibles uniquement par l'équipe..."
          rows={3}
          disabled={isCancelled}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-border">
        {!isCancelled && (
          <>
            <Button
              onClick={handleSave}
              className="flex-1"
              disabled={!clientCountValid && status === 'confirmed'}
            >
              {isNew ? 'Créer' : 'Enregistrer'}
            </Button>
            {!isNew && onCancelAppointment && (
              <Button variant="outline" onClick={onCancelAppointment} className="text-wine-600">
                <Trash2 className="h-4 w-4 mr-1" />
                Annuler RDV
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Fermer
        </Button>
      </div>
    </div>
  )
}
```

**Step 2: Export and commit**

```bash
git add src/availability/components/appointment-editor.tsx src/availability/components/index.ts
git commit -m "feat(availability): add appointment editor with multi-client support"
```

---

## Task 11: Create State Management Hooks

**Files:**
- Create: `src/availability/hooks/use-availability-state.ts`
- Modify: `src/availability/hooks/index.ts`

**Step 1: Create useAvailabilityState hook**

```typescript
// src/availability/hooks/use-availability-state.ts

import { useState, useCallback } from 'react'
import type {
  AvailabilityBlock,
  Appointment,
  BookableService,
  CalendarMode,
} from '../types'
import { MOCK_AVAILABILITY_BLOCKS, MOCK_APPOINTMENTS } from '../mock'

export function useAvailabilityState() {
  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>(MOCK_AVAILABILITY_BLOCKS)
  const [appointments, setAppointments] = useState<Appointment[]>(MOCK_APPOINTMENTS)

  // Availability CRUD
  const createAvailabilityBlock = useCallback((block: Omit<AvailabilityBlock, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newBlock: AvailabilityBlock = {
      ...block,
      id: `avail-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setAvailabilityBlocks(prev => [...prev, newBlock])
    return newBlock
  }, [])

  const updateAvailabilityBlock = useCallback((id: string, updates: Partial<AvailabilityBlock>) => {
    setAvailabilityBlocks(prev =>
      prev.map(block =>
        block.id === id
          ? { ...block, ...updates, updatedAt: new Date().toISOString() }
          : block
      )
    )
  }, [])

  const deleteAvailabilityBlock = useCallback((id: string) => {
    setAvailabilityBlocks(prev => prev.filter(block => block.id !== id))
  }, [])

  // Appointment CRUD
  const createAppointment = useCallback((appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAppointment: Appointment = {
      ...appointment,
      id: `apt-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setAppointments(prev => [...prev, newAppointment])
    return newAppointment
  }, [])

  const updateAppointment = useCallback((id: string, updates: Partial<Appointment>) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? { ...apt, ...updates, updatedAt: new Date().toISOString() }
          : apt
      )
    )
  }, [])

  const cancelAppointment = useCallback((id: string, reason?: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? {
              ...apt,
              status: 'cancelled' as const,
              cancelledAt: new Date().toISOString(),
              cancellationReason: reason,
              updatedAt: new Date().toISOString(),
            }
          : apt
      )
    )
  }, [])

  const restoreAppointment = useCallback((id: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? {
              ...apt,
              status: 'confirmed' as const,
              cancelledAt: undefined,
              cancellationReason: undefined,
              updatedAt: new Date().toISOString(),
            }
          : apt
      )
    )
  }, [])

  return {
    availabilityBlocks,
    appointments,
    createAvailabilityBlock,
    updateAvailabilityBlock,
    deleteAvailabilityBlock,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  }
}
```

**Step 2: Export and commit**

```bash
git add src/availability/hooks/use-availability-state.ts src/availability/hooks/index.ts
git commit -m "feat(availability): add state management hook for availability and appointments"
```

---

## Task 12: Create Validation Utilities

**Files:**
- Create: `src/availability/utils/validation.ts`
- Create: `src/availability/utils/index.ts`

**Step 1: Create validation utilities**

```typescript
// src/availability/utils/validation.ts

import type { AvailabilityBlock, Appointment, BookableService, TimeRange } from '../types'

interface ValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Check if a time range is fully contained within an availability block
 */
export function isWithinAvailability(
  startTime: Date,
  endTime: Date,
  blocks: AvailabilityBlock[]
): ValidationResult {
  const availableBlocks = blocks.filter(b => b.type === 'available')

  for (const block of availableBlocks) {
    const blockStart = new Date(block.startTime)
    const blockEnd = new Date(block.endTime)

    if (startTime >= blockStart && endTime <= blockEnd) {
      return { valid: true }
    }
  }

  return { valid: false, reason: 'En dehors des disponibilités' }
}

/**
 * Check if a service is allowed in a specific availability block
 */
export function isServiceAllowed(
  service: BookableService,
  startTime: Date,
  blocks: AvailabilityBlock[]
): ValidationResult {
  const availableBlocks = blocks.filter(b => b.type === 'available')

  for (const block of availableBlocks) {
    const blockStart = new Date(block.startTime)
    const blockEnd = new Date(block.endTime)

    if (startTime >= blockStart && startTime < blockEnd) {
      // Found the containing block
      if (!block.allowedServiceIds) {
        return { valid: true } // All services allowed
      }
      if (block.allowedServiceIds.includes(service.id)) {
        return { valid: true }
      }
      return { valid: false, reason: 'Service non autorisé dans ce créneau' }
    }
  }

  return { valid: false, reason: 'En dehors des disponibilités' }
}

/**
 * Check if there's a conflict with existing appointments
 */
export function hasAppointmentConflict(
  startTime: Date,
  endTime: Date,
  appointments: Appointment[],
  excludeId?: string
): ValidationResult {
  const activeAppointments = appointments.filter(
    apt => apt.status !== 'cancelled' && apt.id !== excludeId
  )

  for (const apt of activeAppointments) {
    const aptStart = new Date(apt.startTime)
    const aptEnd = new Date(aptStart.getTime() + apt.durationMinutes * 60000)

    // Check for overlap
    if (startTime < aptEnd && endTime > aptStart) {
      return { valid: false, reason: 'Conflit avec un autre rendez-vous' }
    }
  }

  return { valid: true }
}

/**
 * Full validation for dropping a service on the calendar
 */
export function validateServiceDrop(
  service: BookableService,
  startTime: Date,
  availabilityBlocks: AvailabilityBlock[],
  appointments: Appointment[]
): ValidationResult {
  const endTime = new Date(startTime.getTime() + service.durationMinutes * 60000)

  // Check availability
  const availabilityCheck = isWithinAvailability(startTime, endTime, availabilityBlocks)
  if (!availabilityCheck.valid) return availabilityCheck

  // Check service allowed
  const serviceCheck = isServiceAllowed(service, startTime, availabilityBlocks)
  if (!serviceCheck.valid) return serviceCheck

  // Check conflicts
  const conflictCheck = hasAppointmentConflict(startTime, endTime, appointments)
  if (!conflictCheck.valid) return conflictCheck

  return { valid: true }
}

/**
 * Validate moving an appointment
 */
export function validateAppointmentMove(
  appointment: Appointment,
  newStartTime: Date,
  availabilityBlocks: AvailabilityBlock[],
  appointments: Appointment[]
): ValidationResult {
  const endTime = new Date(newStartTime.getTime() + appointment.durationMinutes * 60000)

  // Check availability
  const availabilityCheck = isWithinAvailability(newStartTime, endTime, availabilityBlocks)
  if (!availabilityCheck.valid) return availabilityCheck

  // Check conflicts (excluding self)
  const conflictCheck = hasAppointmentConflict(newStartTime, endTime, appointments, appointment.id)
  if (!conflictCheck.valid) return conflictCheck

  return { valid: true }
}
```

**Step 2: Create index export**

```typescript
// src/availability/utils/index.ts
export * from './validation'
```

**Step 3: Commit**

```bash
git add src/availability/utils/
git commit -m "feat(availability): add validation utilities for booking constraints"
```

---

## Task 13: Update CalendarGrid for Dual Layer Rendering

**Files:**
- Modify: `src/availability/components/calendar-grid.tsx`

**Step 1: Update CalendarGrid to render availability layer**

Add availability blocks rendering under appointments. Key changes:
- Accept `availabilityBlocks` prop
- Accept `calendarMode` prop
- Render availability blocks as background layer
- Adjust opacity based on mode

**Step 2: Commit**

```bash
git add src/availability/components/calendar-grid.tsx
git commit -m "feat(availability): update calendar grid for dual layer rendering"
```

---

## Task 14: Update AppointmentBlock for Multi-Client Display

**Files:**
- Modify: `src/availability/components/appointment-block.tsx`

**Step 1: Update to handle clientIds array and draft status**

Key changes:
- Accept `clients` array prop instead of single client
- Display multiple client names or "Client à assigner" for drafts
- Show draft badge styling

**Step 2: Commit**

```bash
git add src/availability/components/appointment-block.tsx
git commit -m "feat(availability): update appointment block for multi-client display"
```

---

## Task 15: Rewrite AvailabilityPage

**Files:**
- Modify: `src/pages/availability.tsx`

**Step 1: Complete page rewrite with new architecture**

- Add mode state (availability/booking)
- Add sidebar collapse state
- Wire up all new components
- Handle service drag from sidebar
- Handle detail sheet open/close
- Wire up state management hooks

**Step 2: Commit**

```bash
git add src/pages/availability.tsx
git commit -m "feat(availability): rewrite page with v3 architecture"
```

---

## Task 16: Update Module Exports

**Files:**
- Modify: `src/availability/index.ts`
- Modify: `src/availability/components/index.ts`

**Step 1: Ensure all new components and hooks are exported**

**Step 2: Commit**

```bash
git add src/availability/index.ts src/availability/components/index.ts
git commit -m "chore(availability): update module exports for v3"
```

---

## Task 17: Add i18n Keys

**Files:**
- Modify: `src/i18n/fr-CA.json`

**Step 1: Add translation keys for new features**

Add keys for:
- Mode labels
- Availability types
- Editor labels
- Validation messages

**Step 2: Commit**

```bash
git add src/i18n/fr-CA.json
git commit -m "feat(i18n): add translation keys for availability v3"
```

---

## Task 18: Build Verification

**Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

**Step 2: Lint check**

```bash
npm run lint -- src/availability/
```

**Step 3: Build**

```bash
npm run build
```

**Step 4: Fix any issues and commit**

---

## Summary

This plan implements the Disponibilités v3 system with:

1. **Types + Mock Data** (Tasks 1-2)
2. **Core Components** (Tasks 3-10)
3. **State + Validation** (Tasks 11-12)
4. **Grid Updates** (Tasks 13-14)
5. **Page Integration** (Tasks 15-17)
6. **Verification** (Task 18)

All changes are UI-only with mock data. No Supabase or database changes.
