# Disponibilités v3 — Availability + Service-Driven Booking

## Overview

Transform the Disponibilités module into an availability-first, service-driven booking system. Users drag services onto the calendar to create bookings, with availability blocks acting as constraints.

**Core Mental Model:**
1. Professional availability defines WHERE bookings CAN exist
2. User drags a SERVICE onto the calendar
3. Booking is created as a draft
4. Client(s) are assigned afterward

## Scope

- UI only
- Mock data only
- NO Supabase / NO migrations
- NO email / billing logic

---

## Data Model

### AvailabilityBlock

```typescript
export type AvailabilityType = 'available' | 'blocked' | 'vacation' | 'break'

export interface AvailabilityBlock {
  id: string
  professionalId: string
  type: AvailabilityType
  label?: string                    // "Pause dîner", "Formation", etc.
  startTime: string                 // ISO datetime
  endTime: string                   // ISO datetime
  isRecurring: boolean
  allowedServiceIds?: string[]      // undefined = all services allowed
  visibleToClients: boolean
  createdAt: string
  updatedAt: string
}
```

### BookableService

```typescript
export type ServiceClientType = 'individual' | 'couple' | 'family'

export interface BookableService {
  id: string
  nameFr: string
  durationMinutes: number
  colorHex: string
  clientType: ServiceClientType
  minClients: number        // 1 for individual, 2 for couple
  maxClients: number        // 1, 2, or 6+ for family
  compatibleProfessionKeys: string[]
}
```

### Appointment (Updated)

```typescript
export type AppointmentStatus = 'draft' | 'confirmed' | 'cancelled'
export type AppointmentMode = 'in_person' | 'video' | 'phone'

export interface Appointment {
  id: string
  professionalId: string
  clientIds: string[]               // Multi-client support
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

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  TopBar: Professional | View (Jour/Semaine/Liste) | Mode | CTA     │
├──────────┬──────────────────────────────────────────────────────────┤
│          │                                                          │
│  Left    │              Calendar Grid                               │
│  Rail    │              (flex-1, dominates ~70-80%)                 │
│  (56px)  │                                                          │
│  or      │              Week nav above                              │
│  Sidebar │              Availability layer (soft)                   │
│  (240px) │              Appointment layer (strong)                  │
│          │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
                                                    ┌─────────────────┐
                                                    │  Detail Sheet   │
                                                    │  (480px overlay)│
                                                    │  slides in      │
                                                    └─────────────────┘
```

**Sizing:**
- Left rail: 56px collapsed / 240px expanded
- Calendar grid: flex-1 (always largest)
- Right sheet: 480px overlay (does NOT shrink grid)

---

## Modes

### Disponibilités Mode
- Primary CTA: "Ajouter disponibilité"
- Sidebar content: Quick actions + availability blocks list
- Grid interaction: Drag to create/move/resize availability blocks
- Availability layer: Strong visual
- Appointment layer: Visible but muted

### Rendez-vous Mode
- Primary CTA: "Nouveau rendez-vous" (optional shortcut)
- Sidebar content:
  - Services palette (draggable, filtered by professional's professions)
  - Upcoming appointments list (optional tab)
- Grid interaction: Drag services to create appointments, drag/move/resize appointments
- Availability layer: Soft visual (constraint)
- Appointment layer: Strong visual

---

## Components

| Component | Purpose |
|-----------|---------|
| `ModeToggle` | Disponibilités ↔ Rendez-vous segmented control |
| `CollapsibleSidebar` | Left rail/sidebar with expand/collapse |
| `AvailabilitySidebar` | Quick actions + blocks list (Dispo mode) |
| `BookingSidebar` | Services palette + upcoming list (RDV mode) |
| `ServiceDragItem` | Draggable service chip |
| `AvailabilityBlockVisual` | Visual block for availability on grid |
| `CalendarGrid` | Extended to render both layers |
| `DetailSheet` | shadcn Sheet (right overlay, 480px) |
| `AvailabilityEditor` | Form inside sheet |
| `AppointmentEditor` | Service-first form inside sheet |
| `UnsavedChangesDialog` | "Quitter sans enregistrer ?" confirmation |

---

## Drag System

### Service Drag (sidebar → grid)
- Source: ServiceDragItem in sidebar
- Target: CalendarGrid day columns
- Validation:
  - Must land inside an 'available' AvailabilityBlock
  - Service must be in allowedServiceIds (or block allows all)
  - No overlap with existing appointments
  - Snap to 30-min grid
- Result: Creates draft appointment at drop position

### Appointment Drag (grid → grid)
- Source: AppointmentBlock on grid
- Target: Same or different day column
- Validation:
  - Must stay inside availability
  - No overlap with other appointments
  - Same service constraints apply
- Result: Moves appointment to new time

### Availability Drag (grid → grid, Dispo mode)
- Source: AvailabilityBlock or empty slot
- Target: Day columns
- Validation:
  - Can overlap cancelled appointments
  - Cannot overlap confirmed appointments
- Result: Creates/moves availability block

### Visual Feedback
- Preview shows during drag
- Green outline = valid drop
- Red outline = invalid drop

---

## Detail Sheet

**Requirements:**
- shadcn Sheet (Radix Dialog-based)
- Focus trap, Esc closes, click-outside closes
- Slides from right, 480px width
- Overlay mode (grid unaffected)
- Unsaved changes guard

**Availability Editor:**
- Type selector (Disponible/Pause/Vacances/Autre)
- Label (optional)
- Day + start + end time
- Visible to clients toggle
- Allowed services multi-select

**Appointment Editor:**
- Service (pre-filled from drag, changeable)
- Duration (locked to service default, editable if allowed)
- Client assignment (single or multi based on service type)
- Status (Brouillon/Confirmé/Annulé)
- Mode (En personne/Vidéo/Téléphone)
- Notes
- Actions: Save, Cancel appointment, Restore

---

## Mock Data Requirements

### BookableServices
- Individual (50 min, 1 client)
- Couple (75 min, 2 clients)
- Family (90 min, 2-6 clients)
- Discovery call (15 min, 1 client)
- Each with compatibleProfessionKeys

### Professionals
- With professionKeys array

### AvailabilityBlocks
- Morning block (08:00-12:00)
- Break block with label ("Pause dîner")
- Afternoon block with allowedServiceIds restriction
- Full coverage for testing drag scenarios

### Appointments
- Draft (clientIds: [], status: 'draft')
- Confirmed individual (1 client)
- Confirmed couple (2 clients)
- Cancelled (remains visible)

---

## Implementation Order

1. Types + mock data
2. Collapsible sidebar shell
3. Mode toggle + state management
4. Availability layer on grid
5. AvailabilitySidebar content
6. Availability drag interactions
7. Detail sheet + AvailabilityEditor
8. BookingSidebar with services palette
9. Service drag from sidebar to grid
10. AppointmentEditor (service-first)
11. Appointment drag/move/resize within constraints
12. Validation + visual feedback
13. Unsaved changes guard
14. Polish + build verification
