import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { ProfessionalRecord } from '../api/parse'
import { professionalKeys } from '../hooks/keys'
import type { CatalogView } from '../lib/catalog-view'
import { CATALOG_VIEW } from './fixtures-domain'
import { IDS } from './fixtures'
import { setupQueryClient } from './query-client'
import { RecordHarness } from './RecordHarness'

/** The link the tests click to leave the record; it asks first while a card is dirty. */
export const LEAVE_LINK = 'Quitter le dossier'

/**
 * Renders a record tab the way the record page does: the record in the query cache (the API module
 * is mocked by the test: `fetchProfessionalRecord` answers the refetches), the catalogue, the
 * role's access, the unsaved-changes guard and a guarded link to leave. Test-only.
 */
export function renderRecordTab(
  ui: ReactNode,
  { record, role = 'admin_assistant', catalog = CATALOG_VIEW }: { record: ProfessionalRecord; role?: FixtureRole; catalog?: CatalogView },
) {
  const { queryClient } = setupQueryClient()
  queryClient.setQueryData(professionalKeys.record(IDS.professional), record)
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <GuardedNavLink to="/ailleurs">{LEAVE_LINK}</GuardedNavLink>
          <LocationProbe />
          <RecordHarness catalog={catalog}>{ui}</RecordHarness>
        </UnsavedChangesProvider>,
        { access: { access: accessForRole(role) }, path: `/professionnels/${IDS.professional}/identite` },
      )}
    </QueryClientProvider>,
  )
  return { queryClient }
}
