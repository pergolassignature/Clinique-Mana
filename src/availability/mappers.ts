// src/availability/mappers.ts
// Type mappers for converting between API types and availability UI types

import type { ProfessionalListItem } from '@/professionals/types'
import type { Service } from '@/services-catalog/types'
import type { ClientListItem } from '@/clients/types'
import type { Professional, Client, BookableService, ServiceClientType } from './types'

// =============================================================================
// PROFESSIONAL MAPPER
// =============================================================================

/**
 * Map a ProfessionalListItem to the simpler Professional type used in availability UI
 */
export function mapProfessionalForAvailability(
  prof: ProfessionalListItem,
  professionKeys: string[] = []
): Professional {
  return {
    id: prof.id,
    displayName: prof.display_name,
    professionKeys,
  }
}

// =============================================================================
// CLIENT MAPPER
// =============================================================================

/**
 * Map a ClientListItem to the simpler Client type used in availability UI
 */
export function mapClientForAvailability(client: ClientListItem): Client {
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    dateOfBirth: client.birthday || undefined,
    email: client.email || undefined,
    phone: client.cellPhone || undefined,
    primaryProfessionalId: client.primaryProfessionalId || undefined,
  }
}

// =============================================================================
// SERVICE MAPPER
// =============================================================================

/**
 * Derive client type from service key patterns
 * - couple → 'couple'
 * - famille/familiale → 'family'
 * - default → 'individual'
 */
function deriveClientType(key: string): ServiceClientType {
  const lowerKey = key.toLowerCase()
  if (lowerKey.includes('couple')) return 'couple'
  if (lowerKey.includes('famille') || lowerKey.includes('familiale')) return 'family'
  return 'individual'
}

/**
 * Derive min/max clients based on client type
 */
function deriveClientLimits(clientType: ServiceClientType): { min: number; max: number } {
  switch (clientType) {
    case 'couple':
      return { min: 2, max: 2 }
    case 'family':
      return { min: 2, max: 6 }
    default:
      return { min: 1, max: 1 }
  }
}

/**
 * Map a Service to the BookableService type used in availability UI
 *
 * Derives clientType from service.key patterns and uses defaults for
 * compatibleProfessionKeys (all professionals can provide all services by default)
 */
export function mapServiceForAvailability(
  service: Service,
  compatibleProfessionKeys: string[] = ['psychologue', 'psychotherapeute', 'travailleur_social']
): BookableService {
  const clientType = deriveClientType(service.key)
  const limits = deriveClientLimits(clientType)

  return {
    id: service.id,
    nameFr: service.name,
    durationMinutes: service.duration || 50,
    colorHex: service.colorHex || '#7FAE9D', // Default sage color
    clientType,
    minClients: limits.min,
    maxClients: limits.max,
    compatibleProfessionKeys,
  }
}

// =============================================================================
// BATCH MAPPERS (for convenience)
// =============================================================================

/**
 * Map array of professionals
 */
export function mapProfessionalsForAvailability(
  professionals: ProfessionalListItem[]
): Professional[] {
  return professionals.map(p => mapProfessionalForAvailability(p))
}

/**
 * Map array of clients
 */
export function mapClientsForAvailability(
  clients: ClientListItem[]
): Client[] {
  return clients.map(mapClientForAvailability)
}

/**
 * Map array of services to bookable services
 * Filters to only include services with a duration (bookable services)
 */
export function mapServicesForAvailability(
  services: Service[]
): BookableService[] {
  return services
    .filter(s => s.isActive && s.duration && s.duration > 0)
    .map(s => mapServiceForAvailability(s))
}
