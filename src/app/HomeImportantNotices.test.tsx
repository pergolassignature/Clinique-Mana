import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import { notificationKeys } from '@/core/notifications/hooks'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { HomeImportantNotices } from './HomeImportantNotices'
import { NotificationBell } from './shell/NotificationBell'

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

function DirtyForm() {
  useUnsavedChanges(true)
  return null
}

/** Accueil as in the app: under the shell, whose bell polls the count. */
function renderBlock({ dirty = false }: { dirty?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <UnsavedChangesProvider>
          {dirty && <DirtyForm />}
          <NotificationBell />
          <HomeImportantNotices />
          <LocationProbe />
        </UnsavedChangesProvider>
      </QueryClientProvider>,
      { path: '/accueil' },
    ),
  )
  return queryClient
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
    expect(within(rows[0]!).getByText('Il y a 5 min')).toBeInTheDocument()
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

  it('« Ouvrir » then « Rester »: the notice stays unread and listed', async () => {
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([notice({ id: 'n1' })])
    renderBlock({ dirty: true })
    const block = await screen.findByRole('region', { name: t('notifications.watch.title') })
    await userEvent.click(within(block).getByRole('button', { name: t('notifications.watch.open') }))
    const confirm = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.stay') }))

    expect(screen.getByTestId('location').textContent).toBe('/accueil')
    expect(mocks.api.markNotificationsRead).not.toHaveBeenCalled()
    expect(within(block).getByRole('button', { name: t('notifications.watch.open') })).toBeInTheDocument()
  })

  it('« Ouvrir » then « Quitter sans enregistrer »: marked read once the user leaves', async () => {
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([notice({ id: 'n1' })])
    renderBlock({ dirty: true })
    const block = await screen.findByRole('region', { name: t('notifications.watch.title') })
    await userEvent.click(within(block).getByRole('button', { name: t('notifications.watch.open') }))
    const confirm = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    expect(mocks.api.markNotificationsRead).not.toHaveBeenCalled()
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.leave') }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/professionnels/p1'))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n1'])
  })

  it('a button waits while its notice is being marked: a second press does nothing', async () => {
    let finish!: () => void
    mocks.api.markNotificationsRead.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([
      notice({ id: 'n1', link_path: null }),
      notice({ id: 'n2', title: 'Assurance de Marc Roy', link_path: null }),
    ])
    renderBlock()
    const block = await screen.findByRole('region', { name: t('notifications.watch.title') })
    const [first, second] = within(block).getAllByRole('button', { name: t('notifications.watch.dismiss') })
    await userEvent.click(first!)
    await waitFor(() => expect(first).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(first!)
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n1'])
    // Still focusable, and only its own row waits.
    expect(first).not.toBeDisabled()
    expect(second).not.toHaveAttribute('aria-disabled')

    await act(async () => finish())
    await waitFor(() => expect(first).not.toHaveAttribute('aria-disabled'))
  })

  it('has no timer of its own: it reloads when the polled count of important notices changes', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 3, important: 1 })
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([notice({ id: 'n1' })])
    const queryClient = renderBlock()
    await screen.findByRole('region', { name: t('notifications.watch.title') })
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalledOnce())
    expect(mocks.api.listImportantUnreadNotifications).toHaveBeenCalledOnce()
    const list = queryClient.getQueryCache().find({ queryKey: notificationKeys.important() })
    expect(list?.observers).toHaveLength(1)
    expect(list?.observers[0]?.options.refetchInterval).toBeFalsy()
    expect(list?.observers[0]?.options.refetchOnWindowFocus).toBe(false)

    // A poll with the same number of important notices (one more ordinary one): no reload.
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 4, important: 1 })
    await act(() => queryClient.refetchQueries({ queryKey: notificationKeys.count() }))
    expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalledTimes(2)
    expect(mocks.api.listImportantUnreadNotifications).toHaveBeenCalledOnce()

    // A new important notice: one reload.
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 5, important: 2 })
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([
      notice({ id: 'n3', title: 'Assurance de Marc Roy' }),
      notice({ id: 'n1' }),
    ])
    await act(() => queryClient.refetchQueries({ queryKey: notificationKeys.count() }))
    const block = screen.getByRole('region', { name: t('notifications.watch.title') })
    expect(await within(block).findByText('Assurance de Marc Roy')).toBeInTheDocument()
    expect(mocks.api.listImportantUnreadNotifications).toHaveBeenCalledTimes(2)
  })

  it('goes away when the polled count says nothing important is left', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 1, important: 1 })
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([notice({ id: 'n1' })])
    const queryClient = renderBlock()
    await screen.findByRole('region', { name: t('notifications.watch.title') })
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalledOnce())

    // Read elsewhere (another tab): the next poll finds none.
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 0, important: 0 })
    mocks.api.listImportantUnreadNotifications.mockResolvedValue([])
    await act(() => queryClient.refetchQueries({ queryKey: notificationKeys.count() }))
    await waitFor(() => expect(section()).toBeNull())
  })

  it('stays quiet when the list cannot load (the bell still works)', async () => {
    mocks.api.listImportantUnreadNotifications.mockRejectedValue({ code: 'XX000', message: 'boom' })
    renderBlock()
    await waitFor(() => expect(mocks.api.listImportantUnreadNotifications).toHaveBeenCalled())
    expect(section()).toBeNull()
  })
})
