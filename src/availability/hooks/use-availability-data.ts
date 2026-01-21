// src/availability/hooks/use-availability-data.ts
// Centralized hook for fetching all data needed by the availability page

import { useMemo } from 'react'
import { useProfessionals } from '@/professionals/hooks'
import { useActiveServices } from '@/services-catalog/hooks'
import { useClients } from '@/clients/hooks'
import {
  mapProfessionalsForAvailability,
  mapClientsForAvailability,
  mapServicesForAvailability,
} from '../mappers'
import type { Professional, Client, BookableService } from '../types'

export interface AvailabilityData {
  /** Active professionals only */
  professionals: Professional[]
  /** Active services with duration (bookable) */
  bookableServices: BookableService[]
  /** Active (non-archived) clients */
  clients: Client[]
  /** True while any data is loading */
  isLoading: boolean
  /** Error if any query failed */
  error: Error | null
}

/**
 * Centralized hook that fetches and transforms all data needed by the availability page.
 * - Filters professionals to only include those with status='active'
 * - Filters services to only include those with a duration (bookable services)
 * - Filters clients to only include active (non-archived) clients
 */
export function useAvailabilityData(): AvailabilityData {
  // Fetch all required data
  const {
    data: rawProfessionals = [],
    isLoading: loadingProfessionals,
    error: professionalsError,
  } = useProfessionals({ status: 'active' })

  const {
    data: rawServices = [],
    isLoading: loadingServices,
    error: servicesError,
  } = useActiveServices()

  const {
    data: rawClients = [],
    isLoading: loadingClients,
    error: clientsError,
  } = useClients({ status: 'active' })

  // Map and filter professionals (only active ones from the filter above)
  const professionals: Professional[] = useMemo(() => {
    return mapProfessionalsForAvailability(rawProfessionals)
  }, [rawProfessionals])

  // Map services to bookable format (only those with duration)
  const bookableServices: BookableService[] = useMemo(() => {
    return mapServicesForAvailability(rawServices)
  }, [rawServices])

  // Map clients to availability format
  const clients: Client[] = useMemo(() => {
    return mapClientsForAvailability(rawClients)
  }, [rawClients])

  // Combine loading states
  const isLoading = loadingProfessionals || loadingServices || loadingClients

  // Get first error if any
  const error = professionalsError || servicesError || clientsError || null

  return {
    professionals,
    bookableServices,
    clients,
    isLoading,
    error,
  }
}
