import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { Blocks, Building2 } from 'lucide-react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { SettingsSection } from '@/core/modules/types'
import { SettingsLayout } from './SettingsLayout'

const page = (text: string) => lazy(async () => ({ default: () => <p>{text}</p> }))

const sections: SettingsSection[] = [
  { id: 'modules', labelKey: 'settings.sections.modules', icon: Blocks, permission: 'modules.manage', group: 'plateforme', component: page('MODULES PAGE') },
  { id: 'visible', labelKey: 'settings.title', icon: Building2, permission: 'settings.view', group: 'clinique', component: page('VISIBLE PAGE') },
]

// Mounted the way the app shell mounts it: under a `parametres/*` route, so the layout's relative
// links and nested routes resolve against /parametres.
const settingsAt = (path: string, options: Parameters<typeof renderWithContexts>[1] = {}) =>
  renderWithContexts(
    <Routes>
      <Route path="/parametres/*" element={<SettingsLayout sections={sections} />} />
    </Routes>,
    { ...options, path },
  )

describe('SettingsLayout', () => {
  it('lists only sections the user can access and opens the first one', async () => {
    render(settingsAt('/parametres'))
    expect(screen.queryByText(t('settings.sections.modules'))).not.toBeInTheDocument()
    expect(screen.queryByText(t('settings.groups.plateforme'))).not.toBeInTheDocument()
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('href', '/parametres/visible')
  })

  it('does not route to a section the user cannot access', async () => {
    render(settingsAt('/parametres/modules'))
    expect(await screen.findByText(t('common.notFound.title'))).toBeInTheDocument()
    expect(screen.queryByText('MODULES PAGE')).not.toBeInTheDocument()
  })

  it('opens an accessible section from its URL', async () => {
    render(settingsAt('/parametres/modules', { access: { can: (p) => p === 'modules.manage' } }))
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
    expect(screen.queryByText('VISIBLE PAGE')).not.toBeInTheDocument()
  })

  it('shows an empty state when no section is accessible', () => {
    render(settingsAt('/parametres', { access: { can: () => false } }))
    expect(screen.getByText(t('settings.empty'))).toBeInTheDocument()
  })
})
