import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { ModuleRow } from '@/core/modules/api'
import { ModulesSettingsPage } from './ModulesSettingsPage'

const mocks = vi.hoisted(() => ({
  fetchModules: vi.fn(),
  setModuleEnabled: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/modules/api', () => ({ fetchModules: mocks.fetchModules, setModuleEnabled: mocks.setModuleEnabled }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const rows: ModuleRow[] = [
  { key: 'professionals', name: 'Professionnels', depends_on: [], enabled: true },
  { key: 'billing', name: 'Facturation', depends_on: ['professionals', 'ghost'], enabled: false },
]

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ModulesSettingsPage />
    </QueryClientProvider>,
  )
}

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
    expect(screen.getByRole('switch', { name: 'Facturation' })).toBeEnabled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
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

  it('shows the requested state at once and disables the switches while saving', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockReturnValue(new Promise(() => {}))
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Facturation' }))
    const billing = screen.getByRole('switch', { name: 'Facturation' })
    await waitFor(() => expect(billing).toBeDisabled())
    expect(billing).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Professionnels' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Professionnels' })).toBeChecked()
  })
})
