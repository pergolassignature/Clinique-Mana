import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router'
import { AppShell } from '@/shared/components/app-shell'
import { ProtectedRoute } from '@/auth'
import type { NavigationOrigin, DetailPageSearchParams } from '@/shared/lib/navigation'

// Validate navigation search params for detail pages
const VALID_ORIGINS: NavigationOrigin[] = ['clients', 'requests', 'client', 'request']

function validateDetailSearchParams(search: Record<string, unknown>): DetailPageSearchParams {
  const from = VALID_ORIGINS.includes(search.from as NavigationOrigin)
    ? (search.from as NavigationOrigin)
    : undefined
  const fromId = typeof search.fromId === 'string' ? search.fromId : undefined
  return { from, fromId }
}
import { DashboardPage } from '@/pages/dashboard'
import { ProfessionalsPage } from '@/pages/professionals'
import { ProfessionalDetailPage } from '@/pages/professional-detail'
import { InvitePage } from '@/pages/invite'
import { AvailabilityPage } from '@/pages/availability'
import { MotifsPage } from '@/pages/motifs'
import { ServicesPage } from '@/pages/services'
import { ClientsPage } from '@/pages/clients'
import { ClientDetailPage } from '@/pages/client-detail'
import { RequestsPage } from '@/pages/requests'
import { RequestDetailPage } from '@/pages/request-detail'
import { RequestAnalysisPage } from '@/pages/request-analysis'
import { ReportsPage } from '@/pages/reports'
import { SettingsLayout } from '@/pages/settings-layout'
import { ClinicSettingsPage } from '@/pages/clinic-settings'
import { LoginPage } from '@/pages/login'
import { NotFoundPage } from '@/pages/not-found'

// Create root route (minimal wrapper)
const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
})

// Login route (public)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connexion',
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
})

// Public invite route (for professional onboarding)
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitation/$token',
  component: InvitePage,
})

// Protected layout route - wraps AppShell with auth check
const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: () => (
    <ProtectedRoute>
      <AppShell />
    </ProtectedRoute>
  ),
})

// Index route - redirect to dashboard
const indexRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})

// Dashboard
const dashboardRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/dashboard',
  component: DashboardPage,
})

// Professionals
const professionalsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/professionnels',
  component: ProfessionalsPage,
})

// Professional Detail
const professionalDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/professionnels/$id',
  component: ProfessionalDetailPage,
})

// Availability
const availabilityRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/disponibilites',
  component: AvailabilityPage,
})

// Legacy routes - redirect to settings
const legacyMotifsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/motifs',
  beforeLoad: () => {
    throw redirect({ to: '/parametres/motifs' })
  },
})

const legacyServicesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/services',
  beforeLoad: () => {
    throw redirect({ to: '/parametres/services' })
  },
})

// Clients
const clientsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/clients',
  component: ClientsPage,
})

// Client Detail
const clientDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/clients/$id',
  component: ClientDetailPage,
  validateSearch: validateDetailSearchParams,
})

// Requests
const requestsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/demandes',
  component: RequestsPage,
})

// Request Detail
const requestDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/demandes/$id',
  component: RequestDetailPage,
  validateSearch: validateDetailSearchParams,
})

// Request Analysis
const requestAnalysisRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/demandes/$id/analyse',
  component: RequestAnalysisPage,
})

// Reports
const reportsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/rapports',
  component: ReportsPage,
})

// Settings (parent route with layout)
const settingsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/parametres',
  component: SettingsLayout,
})

// Settings index - redirect to motifs
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/parametres/motifs' })
  },
})

// Settings > Motifs
const settingsMotifsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/motifs',
  component: MotifsPage,
})

// Settings > Services
const settingsServicesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/services',
  component: ServicesPage,
})

// Settings > Clinique (IVAC settings)
const settingsCliniqueRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/clinique',
  component: ClinicSettingsPage,
})

// Build route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  protectedLayoutRoute.addChildren([
    indexRoute,
    dashboardRoute,
    professionalsRoute,
    professionalDetailRoute,
    availabilityRoute,
    legacyMotifsRoute,
    legacyServicesRoute,
    clientsRoute,
    clientDetailRoute,
    requestsRoute,
    requestDetailRoute,
    requestAnalysisRoute,
    reportsRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      settingsMotifsRoute,
      settingsServicesRoute,
      settingsCliniqueRoute,
    ]),
  ]),
])

// Create router
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
