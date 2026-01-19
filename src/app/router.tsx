import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
} from '@tanstack/react-router'
import { AppShell } from '@/shared/components/app-shell'
import { DashboardPage } from '@/pages/dashboard'
import { ProfessionalsPage } from '@/pages/professionals'
import { AvailabilityPage } from '@/pages/availability'
import { ReasonsPage } from '@/pages/reasons'
import { ClientsPage } from '@/pages/clients'
import { RequestsPage } from '@/pages/requests'
import { ReportsPage } from '@/pages/reports'
import { SettingsPage } from '@/pages/settings'
import { NotFoundPage } from '@/pages/not-found'

// Create root route with AppShell layout
const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
})

// Index route - redirect to dashboard
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})

// Dashboard
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardPage,
})

// Professionals
const professionalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/professionnels',
  component: ProfessionalsPage,
})

// Availability
const availabilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/disponibilites',
  component: AvailabilityPage,
})

// Reasons
const reasonsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/motifs',
  component: ReasonsPage,
})

// Clients
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: ClientsPage,
})

// Requests
const requestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demandes',
  component: RequestsPage,
})

// Reports
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rapports',
  component: ReportsPage,
})

// Settings
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parametres',
  component: SettingsPage,
})

// Build route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  professionalsRoute,
  availabilityRoute,
  reasonsRoute,
  clientsRoute,
  requestsRoute,
  reportsRoute,
  settingsRoute,
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
