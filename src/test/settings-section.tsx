import { lazy, type ReactNode } from 'react'
import { Building2 } from 'lucide-react'
import type { SettingsSection } from '@/core/modules/types'
import { SettingsSectionContext } from '@/core/settings/section-context'
import { renderWithContexts } from './contexts'

/** A clinic section that may be read only (Identité légale), for pages rendered outside SettingsLayout. */
export const testSettingsSection: SettingsSection = {
  id: 'identity',
  path: 'identite',
  labelKey: 'settings.sections.identity',
  icon: Building2,
  permission: 'settings.view',
  editPermission: 'settings.manage',
  group: 'clinique',
  component: lazy(async () => ({ default: () => null })),
}

/**
 * Wraps a settings page the way SettingsLayout does (section context), inside the usual test
 * contexts. Like renderWithContexts, returns the element to pass to `render`.
 */
export function renderInSettingsSection(
  ui: ReactNode,
  {
    readOnly = false,
    section = testSettingsSection,
    ...options
  }: { readOnly?: boolean; section?: SettingsSection } & Parameters<typeof renderWithContexts>[1] = {},
) {
  return renderWithContexts(
    <SettingsSectionContext.Provider value={{ section, readOnly }}>{ui}</SettingsSectionContext.Provider>,
    options,
  )
}
