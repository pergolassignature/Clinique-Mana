import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { ImportsStatus } from '@/core/settings/imports/api'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { ImportsSwitchCard } from './ImportsSwitchCard'

const mocks = vi.hoisted(() => ({
  fetchImportsStatus: vi.fn(),
  setImportsOpen: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/settings/imports/api', () => ({ fetchImportsStatus: mocks.fetchImportsStatus, setImportsOpen: mocks.setImportsOpen }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const OPEN: ImportsStatus = { open: true, closedAt: null, changedAt: null, changedByName: null }
const CLOSED: ImportsStatus = { open: false, closedAt: '2026-11-30T15:05:00Z', changedAt: '2026-11-30T15:05:00Z', changedByName: 'Jonathan' }

function renderCard(role: 'admin' | 'counselor' = 'admin') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>{renderWithContexts(<ImportsSwitchCard />, { access: { access: accessForRole(role) } })}</QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('ImportsSwitchCard', () => {
  it('shows the imports open, never closed, with « Fermer les importations »', async () => {
    mocks.fetchImportsStatus.mockResolvedValue(OPEN)
    renderCard()
    expect(screen.getByRole('region', { name: t('settings.modules.imports.title') })).toBeInTheDocument()
    expect(await screen.findByText(t('settings.modules.imports.open'))).toBeInTheDocument()
    expect(screen.getByText(t('settings.modules.imports.neverChanged'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.modules.imports.close') })).toBeInTheDocument()
  })

  it('closes the imports after the confirmation, then shows them closed, when and by whom', async () => {
    mocks.fetchImportsStatus.mockResolvedValueOnce(OPEN).mockResolvedValue(CLOSED)
    mocks.setImportsOpen.mockResolvedValue(undefined)
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: t('settings.modules.imports.close') }))
    const dialog = screen.getByRole('alertdialog', { name: t('settings.modules.imports.closeConfirm.title') })
    expect(within(dialog).getByText(t('settings.modules.imports.closeConfirm.body'))).toBeInTheDocument()
    expect(t('settings.modules.imports.closeConfirm.body')).toContain('après la bascule')
    expect(mocks.setImportsOpen).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.modules.imports.close') }))
    expect(mocks.setImportsOpen).toHaveBeenCalledWith(false)
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.modules.imports.closed')))
    expect(await screen.findByText(t('settings.modules.imports.closedState'))).toBeInTheDocument()
    expect(screen.getByText(t('settings.modules.imports.changed', { date: formatClinicDateTime(CLOSED.changedAt!), name: 'Jonathan' }))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.modules.imports.reopen') })).toBeInTheDocument()
  })

  it('cancelling the confirmation changes nothing', async () => {
    mocks.fetchImportsStatus.mockResolvedValue(OPEN)
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: t('settings.modules.imports.close') }))
    await userEvent.click(screen.getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.setImportsOpen).not.toHaveBeenCalled()
  })

  it('reopens closed imports; open again, it shows the reopen and the last close', async () => {
    const reopened: ImportsStatus = { open: true, closedAt: CLOSED.closedAt, changedAt: '2026-12-02T14:00:00Z', changedByName: 'Rachel' }
    mocks.fetchImportsStatus.mockResolvedValueOnce(CLOSED).mockResolvedValue(reopened)
    mocks.setImportsOpen.mockResolvedValue(undefined)
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: t('settings.modules.imports.reopen') }))
    const dialog = screen.getByRole('alertdialog', { name: t('settings.modules.imports.reopenConfirm.title') })
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.modules.imports.reopen') }))
    expect(mocks.setImportsOpen).toHaveBeenCalledWith(true)
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.modules.imports.reopened')))
    expect(await screen.findByText(t('settings.modules.imports.open'))).toBeInTheDocument()
    expect(screen.getByText(t('settings.modules.imports.changed', { date: formatClinicDateTime(reopened.changedAt!), name: 'Rachel' }))).toBeInTheDocument()
    expect(screen.getByText(t('settings.modules.imports.lastClosed', { date: formatClinicDateTime(CLOSED.closedAt!) }))).toBeInTheDocument()
  })

  it('says when the change has no known author', async () => {
    mocks.fetchImportsStatus.mockResolvedValue({ ...CLOSED, changedByName: null })
    renderCard()
    expect(await screen.findByText(t('settings.modules.imports.changedNoName', { date: formatClinicDateTime(CLOSED.changedAt!) }))).toBeInTheDocument()
  })

  it('a refusal is a toast; the state stays', async () => {
    mocks.fetchImportsStatus.mockResolvedValue(OPEN)
    mocks.setImportsOpen.mockRejectedValue({ code: 'P0001', message: 'Refusé.' })
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: t('settings.modules.imports.close') }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t('settings.modules.imports.close') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Refusé.'))
    expect(screen.getByText(t('settings.modules.imports.open'))).toBeInTheDocument()
  })

  it('a failed load offers « Réessayer » and no action', async () => {
    mocks.fetchImportsStatus.mockRejectedValueOnce(new Error('network')).mockResolvedValue(OPEN)
    renderCard()
    expect(await screen.findByText(t('settings.modules.imports.loadError'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.modules.imports.close') })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByText(t('settings.modules.imports.open'))).toBeInTheDocument()
  })

  it('is hidden without modules.manage, and never asks the server', () => {
    renderCard('counselor')
    expect(screen.queryByText(t('settings.modules.imports.title'))).not.toBeInTheDocument()
    expect(mocks.fetchImportsStatus).not.toHaveBeenCalled()
  })
})
