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

const rows: ModuleRow[] = [
  { key: 'professionals', name: 'Professionnels', depends_on: [], enabled: true },
  { key: 'billing', name: 'Facturation', depends_on: ['professionals'], enabled: false },
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
  it('lists the modules with their state and dependencies', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    renderPage()
    expect(await screen.findByRole('switch', { name: 'Professionnels' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Facturation' })).not.toBeChecked()
    expect(screen.getByText(`${t('settings.modules.dependsOn')} professionals`)).toBeInTheDocument()
  })

  it('toggles a module and confirms with a toast', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Facturation' }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.modules.saved')))
    expect(mocks.setModuleEnabled).toHaveBeenCalledWith('billing', true)
    // The list is refetched after the change.
    expect(mocks.fetchModules).toHaveBeenCalledTimes(2)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('shows the database message when the change is refused', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockRejectedValue({ message: "Désactivez d'abord : Facturation", code: 'P0001' })
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Professionnels' }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Désactivez d'abord : Facturation"))
    expect(mocks.setModuleEnabled).toHaveBeenCalledWith('professionals', false)
    expect(mocks.toast.success).not.toHaveBeenCalled()
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

  it('disables the switches while a change is saving', async () => {
    mocks.fetchModules.mockResolvedValue(rows)
    mocks.setModuleEnabled.mockReturnValue(new Promise(() => {}))
    renderPage()
    await userEvent.click(await screen.findByRole('switch', { name: 'Facturation' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Facturation' })).toBeDisabled())
    expect(screen.getByRole('switch', { name: 'Professionnels' })).toBeDisabled()
  })
})
