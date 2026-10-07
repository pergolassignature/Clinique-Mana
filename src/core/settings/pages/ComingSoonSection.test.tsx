import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Building2 } from 'lucide-react'
import { t } from '@/i18n'
import type { SettingsSection } from '@/core/modules/types'
import { SettingsSectionContext } from '../section-context'
import { ComingSoonSection } from './ComingSoonSection'

const section: SettingsSection = {
  id: 'identity',
  path: 'identite',
  labelKey: 'settings.sections.identity',
  icon: Building2,
  permission: 'settings.view',
  editPermission: 'settings.manage',
  group: 'clinique',
  component: ComingSoonSection as unknown as SettingsSection['component'],
}

const renderAs = (readOnly: boolean) =>
  render(
    <SettingsSectionContext.Provider value={{ section, readOnly }}>
      <ComingSoonSection />
    </SettingsSectionContext.Provider>,
  )

describe('ComingSoonSection', () => {
  it('titles the pane with the section and says it is coming', () => {
    renderAs(false)
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.comingSoon'))).toBeInTheDocument()
    expect(screen.queryByText(t('settings.readOnly.title'))).not.toBeInTheDocument()
  })

  it('shows the read-only notice to a user who may only read the section', () => {
    renderAs(true)
    expect(screen.getByText(t('settings.readOnly.title'))).toBeInTheDocument()
    expect(screen.getByText(t('settings.readOnly.body'))).toBeInTheDocument()
  })
})
