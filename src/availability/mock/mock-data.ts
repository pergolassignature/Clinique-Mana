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
