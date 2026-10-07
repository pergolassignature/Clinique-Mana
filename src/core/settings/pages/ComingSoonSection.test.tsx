import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { renderInSettingsSection } from '@/test/settings-section'
import { ComingSoonSection } from './ComingSoonSection'

describe('ComingSoonSection', () => {
  it('titles the pane with the section and says it is coming', () => {
    render(renderInSettingsSection(<ComingSoonSection />))
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.comingSoon'))).toBeInTheDocument()
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
  })

  it('shows the read-only notice to a user who may only read the section', () => {
    render(renderInSettingsSection(<ComingSoonSection />, { readOnly: true }))
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(screen.getByText(t('common.readOnlyNotice.body'))).toBeInTheDocument()
  })
})
