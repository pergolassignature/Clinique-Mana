import { lazy } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { Blocks, Building2, Bug } from 'lucide-react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { SettingsSection } from '@/core/modules/types'
import { SettingsLayout } from './SettingsLayout'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

const page = (text: string) => lazy(async () => ({ default: () => <p>{text}</p> }))
const crashingPage = () =>
  lazy(async () => ({
    default: () => {
      throw new Error('boom')
    },
  }))

const modulesSection: SettingsSection = { id: 'modules', labelKey: 'settings.sections.modules', icon: Blocks, permission: 'modules.manage', group: 'plateforme', component: page('MODULES PAGE') }
const visibleSection: SettingsSection = { id: 'visible', labelKey: 'settings.title', icon: Building2, permission: 'settings.view', group: 'clinique', component: page('VISIBLE PAGE') }
const sections = [modulesSection, visibleSection]

// Mounted the way the app shell mounts it: under a `parametres/*` route.
const settingsAt = (path: string, options: Parameters<typeof renderWithContexts>[1] = {}, list = sections) =>
  renderWithContexts(
    <Routes>
      <Route path="/parametres/*" element={<SettingsLayout sections={list} />} />
    </Routes>,
    { ...options, path },
  )

const canEverything = { can: () => true }

beforeEach(() => {
  // React logs caught render errors; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  mocks.captureException.mockReset()
})

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

  it('builds absolute links from basePath, whatever section is open', async () => {
    render(settingsAt('/parametres/modules', { access: canEverything }))
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('href', '/parametres/visible')
    expect(screen.getByRole('link', { name: t('settings.sections.modules') })).toHaveAttribute('href', '/parametres/modules')
  })

  it('honours a custom basePath', async () => {
    render(
      renderWithContexts(
        <Routes>
          <Route path="/admin/reglages/*" element={<SettingsLayout sections={sections} basePath="/admin/reglages" />} />
        </Routes>,
        { path: '/admin/reglages/visible' },
      ),
    )
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('href', '/admin/reglages/visible')
  })

  it.each([
    ['a core section', undefined, 'settings:crash'],
    ['a module section', 'billing', 'settings:billing:crash'],
  ])('keeps the menu working when %s crashes', async (_label, moduleKey, scope) => {
    const crash: SettingsSection = { id: 'crash', labelKey: 'nav.home', icon: Bug, permission: 'settings.view', group: 'clinique', moduleKey, component: crashingPage() }
    render(settingsAt('/parametres/crash', {}, [crash, visibleSection]))

    expect(await screen.findByRole('alert')).toHaveTextContent(t('common.moduleError.title'))
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { scope } }))

    await userEvent.click(screen.getByRole('link', { name: t('settings.title') }))
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an empty state when no section is accessible', () => {
    render(settingsAt('/parametres', { access: { can: () => false } }))
    expect(screen.getByText(t('settings.empty'))).toBeInTheDocument()
  })
})
