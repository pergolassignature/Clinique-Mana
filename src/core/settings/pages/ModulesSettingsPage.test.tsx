import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { ModuleRow } from '@/core/modules/api'
import type { OrgUser } from '@/core/users/api'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { ModulesSettingsPage } from './ModulesSettingsPage'

const mocks = vi.hoisted(() => ({
  fetchModules: vi.fn(),
  setModuleEnabled: vi.fn(),
  testers: { fetchModuleTesters: vi.fn(), setModuleTestersOnly: vi.fn(), addModuleTester: vi.fn(), removeModuleTester: vi.fn() },
  fetchOrgUsers: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/modules/api', () => ({ fetchModules: mocks.fetchModules, setModuleEnabled: mocks.setModuleEnabled }))
vi.mock('@/core/modules/testers-api', () => mocks.testers)
vi.mock('@/core/users/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/users/api')>()), fetchOrgUsers: mocks.fetchOrgUsers }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const rows: ModuleRow[] = [
  { key: 'professionals', name: 'Professionnels', depends_on: [], enabled: true },
  { key: 'billing', name: 'Facturation', depends_on: ['professionals', 'ghost'], enabled: false },
]

const user = (id: string, name: string, role: string): OrgUser => ({
  user_id: id,
  display_name: name,
  email: `${id}@mana.test`,
  status: 'active',
  role,
  role_name: role === 'admin' ? 'Administrateur' : 'Conseillère',
  last_sign_in_at: null,
  override_count: 0,
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>{renderWithContexts(<ModulesSettingsPage />, { access: { access: accessForRole('admin') } })}</QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.testers.fetchModuleTesters.mockResolvedValue([])
  mocks.fetchOrgUsers.mockResolvedValue([user('u-admin', 'Jonathan', 'admin'), user('u-cons', 'Rachel', 'counselor')])
})
afterEach(() => vi.clearAllMocks())

describe('ModulesSettingsPage', () => {
  it('lists the modules with their state and dependency names (key when unknown)', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    renderPage()
    expect(await screen.findByRole('switch', { name: 'Professionnels' })).toBeChecked()
    const billing = screen.getByRole('switch', { name: 'Facturation' })
    expect(billing).not.toBeChecked()
    const requires = `${t('settings.modules.dependsOn')} Professionnels, ghost`
    // getByText normalizes the DOM text (U+00A0 becomes a space) but not the expected string.
    expect(screen.getByText(requires.replace(/\s+/g, ' '))).toBeInTheDocument()
    expect(billing).toHaveAccessibleDescription(requires)
    expect(t('settings.modules.dependsOn')).toBe('Requiert :')
  })

  it('toggles a module, confirms with a toast and shows the refreshed state', async () => {
    mocks.fetchModules.mockResolvedValueOnce(rows).mockResolvedValue(rows.map((r) => ({ ...r, enabled: true })))
    mocks.setModuleEnabled.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Facturation' }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.modules.saved')))
    expect(mocks.setModuleEnabled).toHaveBeenCalledWith('billing', true)
    expect(screen.getByRole('switch', { name: 'Facturation' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Facturation' })).not.toHaveAttribute('aria-disabled')
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('the module name is the switch label: clicking it toggles the module (larger target)', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('switch', { name: 'Facturation' })
    await userEvent.click(screen.getByText('Facturation', { selector: 'label' }))
    await waitFor(() => expect(mocks.setModuleEnabled).toHaveBeenCalledWith('billing', true))
  })

  it('shows the database message when the change is refused and reverts the switch', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockRejectedValue({ message: "Désactivez d'abord : Facturation", code: 'P0001' })
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Professionnels' }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Désactivez d'abord : Facturation"))
    expect(mocks.setModuleEnabled).toHaveBeenCalledWith('professionals', false)
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Professionnels' })).toBeChecked()
  })

  it('falls back to a generic message for network errors', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockRejectedValue({ message: 'TypeError: Failed to fetch', code: '' })
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Professionnels' }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('settings.modules.error')))
  })

  it('shows a load error with a retry instead of an empty list', async () => {
    mocks.fetchModules.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(rows)
    renderPage()
    expect(await screen.findByText(t('settings.modules.loadError'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('switch', { name: 'Professionnels' })).toBeInTheDocument()
  })

  it('shows the requested state at once and makes every switch inactive while saving, keeping focus', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockReturnValue(new Promise(() => {}))
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Facturation' }))
    const billing = screen.getByRole('switch', { name: 'Facturation' })
    const professionals = screen.getByRole('switch', { name: 'Professionnels' })
    await waitFor(() => expect(billing).toHaveAttribute('aria-disabled', 'true'))
    expect(billing).toBeChecked()
    expect(billing).toHaveFocus()
    expect(professionals).toHaveAttribute('aria-disabled', 'true')
    // A press while saving changes nothing.
    await userEvent.click(professionals)
    expect(professionals).toBeChecked()
    expect(mocks.setModuleEnabled).toHaveBeenCalledTimes(1)
  })

  it('titles the page with the section name', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t('settings.sections.modules') })).toHaveAttribute('tabindex', '-1')
  })

  it('reserves a module for its testers, names them and adds one (R-72)', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.testers.fetchModuleTesters.mockResolvedValue([{ key: 'professionals', testersOnly: true, testerIds: ['u-admin'] }])
    mocks.testers.addModuleTester.mockResolvedValue(undefined)
    renderPage()
    const reserved = await screen.findByRole('switch', { name: t('settings.modules.testers.switchLabel', { module: 'Professionnels' }) })
    expect(reserved).toBeChecked()
    const list = await screen.findByRole('list', { name: t('settings.modules.testers.listLabel', { module: 'Professionnels' }) })
    expect(within(list).getByText('Jonathan')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: t('settings.modules.testers.switchLabel', { module: 'Facturation' }) })).not.toBeChecked()
    await userEvent.selectOptions(screen.getByLabelText(t('settings.modules.testers.add')), 'u-cons')
    await waitFor(() => expect(mocks.testers.addModuleTester).toHaveBeenCalledWith('professionals', 'u-cons'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.modules.testers.added'))
  })

  it('switches the reservation and removes a tester; warns when nobody is listed', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.testers.fetchModuleTesters
      .mockResolvedValueOnce([{ key: 'professionals', testersOnly: true, testerIds: ['u-admin'] }])
      .mockResolvedValueOnce([{ key: 'professionals', testersOnly: true, testerIds: [] }])
      .mockResolvedValue([
        { key: 'billing', testersOnly: true, testerIds: [] },
        { key: 'professionals', testersOnly: true, testerIds: [] },
      ])
    mocks.testers.setModuleTestersOnly.mockResolvedValue(undefined)
    mocks.testers.removeModuleTester.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t('settings.modules.testers.remove', { name: 'Jonathan' }) }))
    await waitFor(() => expect(mocks.testers.removeModuleTester).toHaveBeenCalledWith('professionals', 'u-admin'))
    await userEvent.click(screen.getByRole('switch', { name: t('settings.modules.testers.switchLabel', { module: 'Facturation' }) }))
    await waitFor(() => expect(mocks.testers.setModuleTestersOnly).toHaveBeenCalledWith('billing', true))
    expect(await screen.findAllByText(t('settings.modules.testers.none'))).toHaveLength(2)
  })

  it('asks before reserving an enabled module, which everyone else loses at once', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.testers.setModuleTestersOnly.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: t('settings.modules.testers.switchLabel', { module: 'Professionnels' }) }))
    const dialog = await screen.findByRole('alertdialog', { name: t('settings.modules.testers.confirm.title', { module: 'Professionnels' }) })
    expect(mocks.testers.setModuleTestersOnly).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.modules.testers.confirm.action') }))
    await waitFor(() => expect(mocks.testers.setModuleTestersOnly).toHaveBeenCalledWith('professionals', true))
  })

  it('never shows « not reserved » when the testers cannot be loaded', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.testers.fetchModuleTesters.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText(t('settings.modules.testers.loadError'))).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: t('settings.modules.testers.switchLabel', { module: 'Professionnels' }) })).not.toBeInTheDocument()
  })
})
