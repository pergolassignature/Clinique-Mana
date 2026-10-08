import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Organization } from '@/core/settings/organization/api'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { LocationProbe } from './LocationProbe'
import { accessForRole } from './role-fixtures'
import { renderInSettingsSection } from './settings-section'

/** A fully filled organization row, as `fetchOrganization` returns it. */
export const testOrganization: Organization = {
  id: 'o1',
  name: 'Clinique MANA',
  timezone: 'America/Toronto',
  default_locale: 'fr-CA',
  currency: 'CAD',
  legal_name: '9999-9999 Québec inc.',
  neq: '1234567890',
  address_line1: '123, rue Saint-Denis',
  address_line2: 'Bureau 200',
  city: 'Montréal',
  province: 'QC',
  postal_code: 'H2X 1Y4',
  country: 'CA',
  phone: '+15145551234',
  email: 'info@cliniquemana.com',
  website: 'https://cliniquemana.com',
  gst_number: '123456789RT0001',
  qst_number: '1234567890TQ0001',
  signatory_name: 'Marie Tremblay',
  signatory_title: 'Directrice',
  signatory_email: 'direction@cliniquemana.com',
  logo_file_id: null,
  signature_file_id: null,
  privacy_officer_name: 'Julie Roy',
  privacy_officer_email: 'vie-privee@cliniquemana.com',
  privacy_policy_url: 'https://cliniquemana.com/confidentialite',
  record_retention_years: 7,
  updated_at: '2026-10-07T12:00:00Z',
}

/** The link the tests click to leave the page; GuardedNavLink asks first while a form is dirty. */
export const LEAVE_LINK = 'Quitter la page'

/**
 * Renders an organization settings page (or card) the way the app does: a query client, the
 * section context, the unsaved-changes guard, and a guarded link to leave the page.
 * Read-only renders the adjointe (settings.view); otherwise the admin (settings.manage).
 */
export function renderOrganizationPage(ui: ReactNode, { readOnly = false }: { readOnly?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole(readOnly ? 'admin_assistant' : 'admin')
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(
        <UnsavedChangesProvider>
          <GuardedNavLink to="/ailleurs">{LEAVE_LINK}</GuardedNavLink>
          <LocationProbe />
          {children}
        </UnsavedChangesProvider>,
        { readOnly, access: { access }, path: '/parametres/identite' },
      )}
    </QueryClientProvider>
  )
  const result = render(wrap(ui))
  /** Re-renders in the same providers (router, guard and query state are kept). */
  const rerender = (next: ReactNode) => result.rerender(wrap(next))
  return { ...result, rerender, queryClient }
}
