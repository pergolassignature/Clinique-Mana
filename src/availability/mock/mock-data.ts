// src/availability/mock/mock-data.ts

import type { Professional, Client, Service, BookableService, Appointment, AvailabilityBlock } from '../types'

// =============================================================================
// Date Helpers
// =============================================================================

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

// =============================================================================
// Professionals
// =============================================================================

export const MOCK_PROFESSIONALS: Professional[] = [
  { id: 'pro-1', displayName: 'Dre Marie Tremblay', professionKeys: ['psychologue'] },
  { id: 'pro-2', displayName: 'Jean-Philippe Bouchard', professionKeys: ['psychotherapeute', 'travailleur_social'] },
  { id: 'pro-3', displayName: 'Sophie Gagnon', professionKeys: ['psychologue', 'neuropsychologue'] },
]

// =============================================================================
// Clients
// =============================================================================

export const MOCK_CLIENTS: Client[] = [
  { id: 'cli-1', firstName: 'Luc', lastName: 'Côté', dateOfBirth: '1989-06-14', email: 'luc.cote@example.com', phone: '514-555-0101' },
  { id: 'cli-2', firstName: 'Anne', lastName: 'Roy', dateOfBirth: '1991-11-02', email: 'anne.roy@example.com', phone: '514-555-0102' },
  { id: 'cli-3', firstName: 'Michel', lastName: 'Lavoie', dateOfBirth: '1984-01-22', email: 'michel.lavoie@example.com', phone: '514-555-0103' },
  { id: 'cli-4', firstName: 'Julie', lastName: 'Bergeron', dateOfBirth: '1996-03-08', email: 'julie.bergeron@example.com' },
  { id: 'cli-5', firstName: 'Pierre', lastName: 'Morin', dateOfBirth: '1979-09-30', phone: '514-555-0105' },
]

// =============================================================================
// Services (deprecated - kept for backward compatibility)
// =============================================================================

/** @deprecated Use MOCK_BOOKABLE_SERVICES instead */
export const MOCK_SERVICES: Service[] = [
  { id: 'svc-1', nameFr: 'Consultation individuelle', durationMinutes: 50, colorHex: '#7FAE9D' },
  { id: 'svc-2', nameFr: 'Consultation couple', durationMinutes: 75, colorHex: '#D4A5A5' },
  { id: 'svc-3', nameFr: 'Ouverture de dossier', durationMinutes: 60, colorHex: '#B4C7DC' },
  { id: 'svc-4', nameFr: 'Appel découverte', durationMinutes: 15, colorHex: '#E8D4B8' },
]

// =============================================================================
// Bookable Services (v3)
// =============================================================================

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
    compatibleProfessionKeys: ['psychologue', 'psychotherapeute', 'travailleur_social'],
  },
  {
    id: 'svc-3',
    nameFr: 'Thérapie familiale',
    durationMinutes: 90,
    colorHex: '#B4C7DC',
    clientType: 'family',
    minClients: 2,
    maxClients: 6,
    compatibleProfessionKeys: ['psychologue', 'psychotherapeute', 'travailleur_social'],
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

// =============================================================================
// Availability Blocks (v3)
// =============================================================================

const now = new Date().toISOString()

export const MOCK_AVAILABILITY_BLOCKS: AvailabilityBlock[] = [
  // Pro-1 Monday
  {
    id: 'avail-1',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(monday, 8, 0),
    endTime: formatDateTime(monday, 12, 0),
    isRecurring: true,
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
    isRecurring: true,
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
    isRecurring: true,
    allowedServiceIds: ['svc-1', 'svc-4'],
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Pro-1 Tuesday
  {
    id: 'avail-4',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 1), 9, 0),
    endTime: formatDateTime(addDays(monday, 1), 17, 0),
    isRecurring: true,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Pro-1 Wednesday
  {
    id: 'avail-5',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 2), 8, 0),
    endTime: formatDateTime(addDays(monday, 2), 12, 0),
    isRecurring: true,
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
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Pro-1 Thursday
  {
    id: 'avail-7',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 3), 10, 0),
    endTime: formatDateTime(addDays(monday, 3), 18, 0),
    isRecurring: true,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
  // Pro-1 Friday
  {
    id: 'avail-8',
    professionalId: 'pro-1',
    type: 'available',
    startTime: formatDateTime(addDays(monday, 4), 8, 0),
    endTime: formatDateTime(addDays(monday, 4), 15, 0),
    isRecurring: true,
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
    isRecurring: true,
    visibleToClients: true,
    createdAt: now,
    updatedAt: now,
  },
]

// =============================================================================
// Appointments (v3 - with clientIds array)
// =============================================================================

export const MOCK_APPOINTMENTS: Appointment[] = [
  // Monday - apt-1: confirmed individual
  {
    id: 'apt-1',
    professionalId: 'pro-1',
    clientIds: ['cli-1'],
    serviceId: 'svc-1',
    startTime: formatDateTime(monday, 9, 0),
    durationMinutes: 50,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  },
  // Monday - apt-2: confirmed individual
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
  // Monday - apt-3: cancelled couple
  {
    id: 'apt-3',
    professionalId: 'pro-1',
    clientIds: ['cli-3', 'cli-4'],
    serviceId: 'svc-2',
    startTime: formatDateTime(monday, 14, 0),
    durationMinutes: 75,
    status: 'cancelled',
    notesInternal: 'Client a annulé - maladie',
    cancelledAt: now,
    cancellationReason: 'Maladie',
    createdAt: now,
    updatedAt: now,
  },
  // Tuesday - apt-4: draft with no client
  {
    id: 'apt-4',
    professionalId: 'pro-1',
    clientIds: [],
    serviceId: 'svc-1',
    startTime: formatDateTime(addDays(monday, 1), 9, 30),
    durationMinutes: 50,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  },
  // Tuesday - apt-5: confirmed individual
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
  // Wednesday - apt-6: confirmed discovery call
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
  // Thursday - apt-7: confirmed (pro-2)
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
  // Friday - apt-8: confirmed individual
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
