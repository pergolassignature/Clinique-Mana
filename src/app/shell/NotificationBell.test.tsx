import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import { notificationKeys } from '@/core/notifications/hooks'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { NotificationBell } from './NotificationBell'

const mocks = vi.hoisted(() => ({
  api: {
    countMyUnreadNotifications: vi.fn(),
    listMyNotifications: vi.fn(),
    listImportantUnreadNotifications: vi.fn(),
    markNotificationsRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    NOTIFICATIONS_PAGE_SIZE: 2,
    IMPORTANT_NOTICES_LIMIT: 5,
  },
  toast: { success: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn() },
}))
vi.mock('@/core/notifications/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => mocks.sentry)

const notice = (overrides: Partial<Notice>): Notice => ({
  id: 'n1',
  module_key: 'professionals',
  kind: 'professionals.insurance_expiring',
  importance: 'normal',
  title: 'Assurance de Sophie Lavoie',
  body: "L'assurance responsabilité expire le 19 octobre.",
  link_path: '/professionnels/p1',
  subject_type: 'professional',
  subject_id: 'p1',
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  is_read: false,
  ...overrides,
})

const IMPORTANT = notice({ id: 'n1', importance: 'important', title: 'Assurance expirée' })
const UNREAD = notice({ id: 'n2', title: 'Nouvelle soumission', link_path: '/professionnels/p2' })
const READ = notice({ id: 'n3', title: 'Contrat signé', is_read: true, link_path: '/professionnels/p3' })

beforeEach(() => {
  mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 0, important: 0 })
  mocks.api.listMyNotifications.mockResolvedValue([])
  mocks.api.markNotificationsRead.mockResolvedValue(undefined)
  mocks.api.markAllNotificationsRead.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.resetAllMocks()
  mocks.api.NOTIFICATIONS_PAGE_SIZE = 2
})

function DirtyForm() {
  useUnsavedChanges(true)
  return null
}

function renderBell({ dirty = false, path = '/accueil' }: { dirty?: boolean; path?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    renderWithContexts(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        {dirty && <DirtyForm />}
        <NotificationBell />
        <LocationProbe />
      </UnsavedChangesProvider>
    </QueryClientProvider>,
      { path },
    ),
  )
  return queryClient
}

const bell = (name: string | RegExp = /^Notifications/) => screen.getByRole('button', { name })
const dot = () => screen.queryByTestId('notification-dot')
const location = () => screen.getByTestId('location').textContent
const openPanel = async () => {
  await userEvent.click(bell())
  return screen.findByRole('dialog', { name: t('notifications.title') })
}

describe('NotificationBell: the dot and the label', () => {
  it('shows no dot when nothing is unread', async () => {
    renderBell()
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalled())
    expect(bell(t('notifications.bell'))).toBeInTheDocument()
    expect(dot()).toBeNull()
  })

  it('shows a teal dot and the count for unread notices', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 1, important: 0 })
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications, 1 non lue' })).toBeInTheDocument()
    expect(dot()).toHaveAttribute('data-tone', 'unread')
  })

  it('turns the dot red when one of them is important, and says so', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 3, important: 1 })
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications, 3 non lues, dont 1 importante' })).toBeInTheDocument()
    expect(dot()).toHaveAttribute('data-tone', 'important')
  })

  it('polls the count every 60 s, on focus, never in a background tab', async () => {
    const queryClient = renderBell()
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalled())
    const query = queryClient.getQueryCache().find({ queryKey: notificationKeys.count() })
    expect(query?.observers[0]?.options).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })
  })
})

describe('NotificationBell: the list', () => {
  it('loads the list only once opened', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 2, important: 1 })
    mocks.api.listMyNotifications.mockResolvedValue([IMPORTANT, READ])
    renderBell()
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalled())
    expect(mocks.api.listMyNotifications).not.toHaveBeenCalled()

    const panel = await openPanel()
    expect(mocks.api.listMyNotifications).toHaveBeenCalledExactlyOnceWith(null)
    const items = await within(panel).findAllByRole('button', { name: /Assurance expirée|Contrat signé/ })
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText(t('notifications.important'))).toBeInTheDocument()
    expect(within(items[0]!).getByText('il y a 5 min')).toBeInTheDocument()
    expect(within(items[1]!).queryByText(t('notifications.important'))).toBeNull()
  })

  it('says when there is nothing', async () => {
    renderBell()
    const panel = await openPanel()
    expect(await within(panel).findByText(t('notifications.empty'))).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: t('notifications.markAllRead') })).toBeNull()
  })

  it('« Charger plus » asks for the next page with both cursor fields', async () => {
    mocks.api.listMyNotifications.mockResolvedValueOnce([IMPORTANT, UNREAD]).mockResolvedValueOnce([READ])
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: t('notifications.loadMore') }))
    expect(await within(panel).findByRole('button', { name: /Contrat signé/ })).toBeInTheDocument()
    expect(mocks.api.listMyNotifications).toHaveBeenLastCalledWith({ before: UNREAD.created_at, beforeId: UNREAD.id })
    expect(within(panel).queryByRole('button', { name: t('notifications.loadMore') })).toBeNull()
  })
})

describe('NotificationBell: opening a notice', () => {
  it('marks it read, then goes to its page', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 1, important: 0 })
    mocks.api.listMyNotifications.mockResolvedValue([UNREAD])
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))

    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n2'])
    await waitFor(() => expect(location()).toBe('/professionnels/p2'))
    expect(screen.queryByRole('dialog', { name: t('notifications.title') })).toBeNull()
    // The count and the list reload after the change.
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalledTimes(2))
  })

  it('asks before leaving a page with unsaved changes', async () => {
    mocks.api.listMyNotifications.mockResolvedValue([UNREAD])
    renderBell({ dirty: true })
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))

    const confirm = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n2'])
    expect(location()).toBe('/accueil')
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.stay') }))
    expect(location()).toBe('/accueil')
    // Focus came back to the bell, not to <body>.
    await waitFor(() => expect(bell()).toHaveFocus())
  })

  it('does not mark a read notice again', async () => {
    mocks.api.listMyNotifications.mockResolvedValue([READ])
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Contrat signé/ }))
    await waitFor(() => expect(location()).toBe('/professionnels/p3'))
    expect(mocks.api.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('never follows a link that is not an app path', async () => {
    mocks.api.listMyNotifications.mockResolvedValue([notice({ id: 'n9', title: 'Lien externe', link_path: '//evil.test/x' })])
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Lien externe/ }))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n9'])
    expect(location()).toBe('/accueil')
  })

  it('shows a toast when marking fails', async () => {
    mocks.api.markNotificationsRead.mockRejectedValue({ code: 'XX000', message: 'boom' })
    mocks.api.listMyNotifications.mockResolvedValue([UNREAD])
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('notifications.markError')))
  })
})

describe('NotificationBell: « Tout marquer comme lu »', () => {
  it('marks everything read and reloads the count', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValueOnce({ total: 2, important: 1 }).mockResolvedValue({ total: 0, important: 0 })
    mocks.api.listMyNotifications.mockResolvedValue([IMPORTANT, UNREAD])
    renderBell()
    await screen.findByRole('button', { name: 'Notifications, 2 non lues, dont 1 importante' })
    const panel = await openPanel()
    await userEvent.click(within(panel).getByRole('button', { name: t('notifications.markAllRead') }))

    expect(mocks.api.markAllNotificationsRead).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: t('notifications.bell') })).toBeInTheDocument()
    expect(dot()).toBeNull()
  })
})
