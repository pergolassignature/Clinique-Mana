import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { professionalsManifest } from '../manifest'
import { setupQueryClient } from './query-client'

/**
 * Renders one of the module's settings pages the way SettingsLayout does: its section (from the
 * manifest), read-only for the adjointe (`professionals.manage` without `.settings`), editable for
 * the admin. Test-only.
 */
export function renderProfessionalsSettingsPage(ui: ReactNode, { sectionId, readOnly = false }: { sectionId: string; readOnly?: boolean }) {
  const section = professionalsManifest.settingsSections.find((s) => s.id === sectionId)
  if (!section) throw new Error(`no section ${sectionId}`)
  const client = setupQueryClient()
  const access = accessForRole(readOnly ? 'admin_assistant' : 'admin')
  render(
    <QueryClientProvider client={client.queryClient}>
      {renderInSettingsSection(ui, { readOnly, section, access: { access }, path: `/parametres/${section.path}` })}
    </QueryClientProvider>,
  )
  return client
}
