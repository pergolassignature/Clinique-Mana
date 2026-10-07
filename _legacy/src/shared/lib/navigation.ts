// Navigation origin types
export type NavigationOrigin = 'clients' | 'requests' | 'client' | 'request'

// Search params for detail pages
export interface DetailPageSearchParams {
  from?: NavigationOrigin
  fromId?: string
}

// Configuration for back navigation based on origin
interface BackNavConfig {
  to: string
  params?: Record<string, string>
  labelKey: string
}

/**
 * Get the back navigation configuration based on origin context
 */
export function getBackNavigation(
  searchParams: DetailPageSearchParams,
  defaultOrigin: NavigationOrigin
): BackNavConfig {
  const { from, fromId } = searchParams

  switch (from) {
    case 'client':
      // Came from a specific client profile
      if (fromId) {
        return {
          to: '/clients/$id',
          params: { id: fromId },
          labelKey: 'nav.backTo.client',
        }
      }
      return {
        to: '/clients',
        labelKey: 'nav.backTo.clients',
      }

    case 'request':
      // Came from a specific request
      if (fromId) {
        return {
          to: '/demandes/$id',
          params: { id: fromId },
          labelKey: 'nav.backTo.request',
        }
      }
      return {
        to: '/demandes',
        labelKey: 'nav.backTo.requests',
      }

    case 'clients':
      return {
        to: '/clients',
        labelKey: 'nav.backTo.clients',
      }

    case 'requests':
      return {
        to: '/demandes',
        labelKey: 'nav.backTo.requests',
      }

    default:
      // Fallback to default parent
      if (defaultOrigin === 'clients' || defaultOrigin === 'client') {
        return {
          to: '/clients',
          labelKey: 'nav.backTo.clients',
        }
      }
      return {
        to: '/demandes',
        labelKey: 'nav.backTo.requests',
      }
  }
}

/**
 * Build search params to pass when navigating to a detail page
 */
export function buildNavigationParams(
  from: NavigationOrigin,
  fromId?: string
): DetailPageSearchParams {
  return fromId ? { from, fromId } : { from }
}
