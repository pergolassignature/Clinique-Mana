import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { HomeImportantNotices } from './HomeImportantNotices'

const mocks = vi.hoisted(() => ({
  api: {
    countMyUnreadNotifications: vi.fn(),
    listMyNotifications: vi.fn(),
    listImportantUnreadNotifications: vi.fn(),
    markNotificationsRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    NOTIFICATIONS_PAGE_SIZE: 20,
    IMPORTANT_NOTICES_LIMIT: 5,
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/notifications/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

const notice = (overrides: Partial<Notice>): Notice => ({
  id: 'n1',
  module_key: 'professionals',
  kind: 'professionals.insurance_expiring',
  importance: 'important',
  title: 'Assurance de Sophie Lavoie',
  body: "L'assurance responsabilité expire le 19 octobre.",
  link_path: '/professionnels/p1',
  subject_type: 'professional',
  subject_id: 'p1',
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  is_read: false,
  ...overrides,
})

beforeEach(() => {
  mocks.api.listImportantUnreadNotifications.mockResolvedValue([])
  mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 0, important: 0 })
  mocks.api.markNotificationsRead.mockResolvedValue(undefined)
})

afterEach(() => vi.resetAllMocks())

function renderBlock() {
  render(
    renderWithContexts(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnsavedChangesProvider>
        <HomeImportantNotices />
        <LocationProbe />
      </UnsavedChangesProvider>
    </QueryClientProvider>,
      { path: '/accueil' },
    ),
  )
}

const section = () => screen.queryByRole('region', { name: t('notifications.watch.title') })

describe('HomeImportantNotices', () => {
  it('shows nothing at all without important unread notices', async () => {
    renderBlock()
    await waitFor(() => expect(mocks.api.listImportantUnreadNotifications).toHaveBeenCalledOnce())
    expect(section()).toBeNull()
    expect(screen.queryByText(t('notifications.watch.title'))).toBeNull()
  })

  it('lists the important unread notices', async () => {
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([
      notice({ id: 'n1' }),
      notice({ id: 'n2', title: 'Assurance de Marc Roy', link_path: null, body: null }),
    ])
    renderBlock()
    const block = await screen.findByRole('region', { name: t('notifications.watch.title') })
    const rows = within(block).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Assurance de Sophie Lavoie')).toBeInTheDocument()
    expect(within(rows[0]!).getByText("L'assurance responsabilité expire le 19 octobre.")).toBeInTheDocument()
    expect(within(rows[0]!).getByText('il y a 5 min')).toBeInTheDocument()
    expect(within(rows[0]!).getByRole('button', { name: t('notifications.watch.open') })).toBeInTheDocument()
    // Without a link, the row can only be dismissed.
    expect(within(rows[1]!).queryByRole('button', { name: t('notifications.watch.open') })).toBeNull()
    expect(within(rows[1]!).getByRole('button', { name: t('notifications.watch.dismiss') })).toBeInTheDocument()
  })

  it('« Ouvrir » marks the notice read and goes to its page', async () => {
    mocks.api.listImportantUnreadNotifications.mockResolvedValueOnce([notice({ id: 'n1' })]).mockResolvedValue([])
    renderBlock()
    const block = await screen.findByRole('region', { name: t('notifications.watch.title') })
    await userEvent.click(within(block).getByRole('button', { name: t('notifications.watch.open') }))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n1'])
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/professionnels/p1'))
    // Reloaded after the change: the block goes away with its last notice.
    await waitFor(() => expect(section()).toBeNull())
  })

  it('« Marquer comme lu » dismisses a notice without a link', async () => {
    mocks.api.listImportantUnreadNotifications.mockResolvedValueOnce([notice({ id: 'n2', link_path: null })]).mockResolvedValue([])
    renderBlock()
    const block = await screen.findByRole('region', { name: t('notifications.watch.title') })
    await userEvent.click(within(block).getByRole('button', { name: t('notifications.watch.dismiss') }))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n2'])
    expect(screen.getByTestId('location').textContent).toBe('/accueil')
    await waitFor(() => expect(section()).toBeNull())
  })

  it('stays quiet when the list cannot load (the bell still works)', async () => {
    mocks.api.listImportantUnreadNotifications.mockRejectedValue({ code: 'XX000', message: 'boom' })
    renderBlock()
    await waitFor(() => expect(mocks.api.listImportantUnreadNotifications).toHaveBeenCalled())
    expect(section()).toBeNull()
  })
})
