import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Notice, NoticesPage } from '@/core/notifications/api'
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

const page = (notices: Notice[], hasMore = false): NoticesPage => ({ notices, hasMore })

const IMPORTANT = notice({ id: 'n1', importance: 'important', title: 'Assurance expirée' })
const UNREAD = notice({ id: 'n2', title: 'Nouvelle soumission', link_path: '/professionnels/p2' })
const READ = notice({ id: 'n3', title: 'Contrat signé', is_read: true, link_path: '/professionnels/p3' })

beforeEach(() => {
  mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 0, important: 0 })
  mocks.api.listMyNotifications.mockResolvedValue(page([]))
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
    mocks.api.listMyNotifications.mockResolvedValue(page([IMPORTANT, READ]))
    renderBell()
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalled())
    expect(mocks.api.listMyNotifications).not.toHaveBeenCalled()

    const panel = await openPanel()
    expect(mocks.api.listMyNotifications).toHaveBeenCalledExactlyOnceWith(null)
    const items = await within(panel).findAllByRole('button', { name: /Assurance expirée|Contrat signé/ })
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText(t('notifications.important'))).toBeInTheDocument()
    expect(within(items[0]!).getByText('Il y a 5 min')).toBeInTheDocument()
    expect(within(items[1]!).queryByText(t('notifications.important'))).toBeNull()
  })

  it('names each row by its title and status; the body and the age describe it', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([IMPORTANT, UNREAD, READ]))
    renderBell()
    const panel = await openPanel()
    const important = await within(panel).findByRole('button', { name: 'Assurance expirée, non lue, importante' })
    expect(important).toHaveAccessibleDescription("L'assurance responsabilité expire le 19 octobre. Il y a 5 min")
    expect(within(panel).getByRole('button', { name: 'Nouvelle soumission, non lue' })).toBeInTheDocument()
    const read = within(panel).getByRole('button', { name: 'Contrat signé' })
    expect(read).toHaveAccessibleDescription("L'assurance responsabilité expire le 19 octobre. Il y a 5 min")
  })

  it('describes a row without a body by its age alone', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([notice({ id: 'n5', title: 'Sans détail', body: null })]))
    renderBell()
    const panel = await openPanel()
    expect(await within(panel).findByRole('button', { name: 'Sans détail, non lue' })).toHaveAccessibleDescription('Il y a 5 min')
  })

  it('says when there is nothing', async () => {
    renderBell()
    const panel = await openPanel()
    expect(await within(panel).findByText(t('notifications.empty'))).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: t('notifications.markAllRead') })).toBeNull()
  })

  it('shows « Charger plus » only when the page says more follow', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([IMPORTANT, UNREAD]))
    renderBell()
    const panel = await openPanel()
    await within(panel).findByRole('button', { name: /Nouvelle soumission/ })
    expect(within(panel).queryByRole('button', { name: t('notifications.loadMore') })).toBeNull()
  })

  it('« Charger plus » asks for the next page with both cursor fields, then focuses its first row', async () => {
    mocks.api.listMyNotifications.mockResolvedValueOnce(page([IMPORTANT, UNREAD], true)).mockResolvedValueOnce(page([READ]))
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: t('notifications.loadMore') }))
    const first = await within(panel).findByRole('button', { name: /Contrat signé/ })
    expect(mocks.api.listMyNotifications).toHaveBeenLastCalledWith({ before: UNREAD.created_at, beforeId: UNREAD.id })
    expect(mocks.api.listMyNotifications).toHaveBeenCalledTimes(2)
    // The last page said nothing follows: no empty third page, no button.
    expect(within(panel).queryByRole('button', { name: t('notifications.loadMore') })).toBeNull()
    await waitFor(() => expect(first).toHaveFocus())
  })

  it('says when the next page cannot load, and lets the user try again', async () => {
    mocks.api.listMyNotifications
      .mockResolvedValueOnce(page([IMPORTANT, UNREAD], true))
      .mockRejectedValueOnce({ code: 'XX000', message: 'boom' })
      .mockResolvedValueOnce(page([READ]))
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: t('notifications.loadMore') }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(t('notifications.loadMoreError'))
    // The rows already loaded stay.
    expect(within(panel).getByRole('button', { name: /Nouvelle soumission/ })).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: t('notifications.loadMore') }))
    const first = await within(panel).findByRole('button', { name: /Contrat signé/ })
    expect(within(panel).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(first).toHaveFocus())
  })

  it('loads one fresh first page each time it opens', async () => {
    mocks.api.listMyNotifications
      .mockResolvedValueOnce(page([IMPORTANT, UNREAD], true))
      .mockResolvedValueOnce(page([READ]))
      .mockResolvedValueOnce(page([notice({ id: 'n7', title: 'Toute nouvelle' }), IMPORTANT], true))
    renderBell()
    let panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: t('notifications.loadMore') }))
    await within(panel).findByRole('button', { name: /Contrat signé/ })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    panel = await openPanel()
    expect(await within(panel).findByRole('button', { name: /Toute nouvelle/ })).toBeInTheDocument()
    expect(mocks.api.listMyNotifications).toHaveBeenCalledTimes(3)
    expect(mocks.api.listMyNotifications).toHaveBeenLastCalledWith(null)
    // Only the first page: not the second page seen before.
    expect(within(panel).queryByRole('button', { name: /Contrat signé/ })).toBeNull()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('NotificationBell: focus', () => {
  it('keeps Tab inside the open panel', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 2, important: 1 })
    mocks.api.listMyNotifications.mockResolvedValue(page([IMPORTANT, UNREAD], true))
    renderBell()
    const panel = await openPanel()
    await within(panel).findByRole('button', { name: /Nouvelle soumission/ })
    await waitFor(() => expect(panel).toHaveFocus())

    const markAll = within(panel).getByRole('button', { name: t('notifications.markAllRead') })
    const loadMore = within(panel).getByRole('button', { name: t('notifications.loadMore') })
    await userEvent.tab()
    expect(markAll).toHaveFocus()
    await userEvent.tab()
    expect(within(panel).getByRole('button', { name: /Assurance expirée/ })).toHaveFocus()
    await userEvent.tab()
    await userEvent.tab()
    expect(loadMore).toHaveFocus()
    // From the last control back to the first, never out to the page.
    await userEvent.tab()
    expect(markAll).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(loadMore).toHaveFocus()
  })

  it('gives focus back to the bell on Escape', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([UNREAD]))
    renderBell()
    const panel = await openPanel()
    await within(panel).findByRole('button', { name: /Nouvelle soumission/ })
    await userEvent.tab()
    await userEvent.tab()
    expect(within(panel).getByRole('button', { name: /Nouvelle soumission/ })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(bell()).toHaveFocus())
  })
})

describe('NotificationBell: opening a notice', () => {
  it('closes the panel, focuses the bell, marks the notice read and goes to its page', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 1, important: 0 })
    mocks.api.listMyNotifications.mockResolvedValue(page([UNREAD]))
    renderBell()
    const panel = await openPanel()
    const row = await within(panel).findByRole('button', { name: /Nouvelle soumission/ })
    row.focus()
    await userEvent.keyboard('{Enter}')

    // All at once, in the same press: the panel is gone and the bell has focus before the notice opens.
    expect(screen.queryByRole('dialog', { name: t('notifications.title') })).toBeNull()
    expect(bell()).toHaveFocus()
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n2'])
    expect(location()).toBe('/professionnels/p2')
    // The panel's late close focus does not move it elsewhere.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(bell()).toHaveFocus()
    // The count and the list reload after the change.
    await waitFor(() => expect(mocks.api.countMyUnreadNotifications).toHaveBeenCalledTimes(2))
  })

  it('asks before leaving a page with unsaved changes, and marks nothing until the user leaves', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([UNREAD]))
    renderBell({ dirty: true })
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))

    const confirm = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    // The confirmation keeps focus (the panel's close does not take it back to the bell).
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(confirm).toContainElement(document.activeElement as HTMLElement)
    expect(mocks.api.markNotificationsRead).not.toHaveBeenCalled()
    expect(location()).toBe('/accueil')

    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.leave') }))
    await waitFor(() => expect(location()).toBe('/professionnels/p2'))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n2'])
  })

  it('« Rester » keeps the notice unread and gives focus back to the bell', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([UNREAD]))
    renderBell({ dirty: true })
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))

    const confirm = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.stay') }))
    expect(location()).toBe('/accueil')
    // Focus came back to the bell, not to <body>.
    await waitFor(() => expect(bell()).toHaveFocus())
    expect(mocks.api.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('marks a notice linking to the current page at once', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([UNREAD]))
    renderBell({ dirty: true, path: '/professionnels/p2' })
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n2'])
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(location()).toBe('/professionnels/p2')
  })

  it('does not mark a read notice again', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([READ]))
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Contrat signé/ }))
    await waitFor(() => expect(location()).toBe('/professionnels/p3'))
    expect(mocks.api.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('never follows a link that is not an app path, and marks the notice read at once', async () => {
    mocks.api.listMyNotifications.mockResolvedValue(page([notice({ id: 'n9', title: 'Lien externe', link_path: '//evil.test/x' })]))
    renderBell({ dirty: true })
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Lien externe/ }))
    expect(mocks.api.markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n9'])
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(location()).toBe('/accueil')
  })

  it('shows a toast when marking fails', async () => {
    mocks.api.markNotificationsRead.mockRejectedValue({ code: 'XX000', message: 'boom' })
    mocks.api.listMyNotifications.mockResolvedValue(page([UNREAD]))
    renderBell()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /Nouvelle soumission/ }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('notifications.markError')))
  })
})

describe('NotificationBell: « Tout marquer comme lu »', () => {
  it('marks everything read, then reloads the count and the list', async () => {
    mocks.api.countMyUnreadNotifications.mockResolvedValueOnce({ total: 2, important: 1 }).mockResolvedValue({ total: 0, important: 0 })
    mocks.api.listMyNotifications
      .mockResolvedValueOnce(page([IMPORTANT, UNREAD]))
      .mockResolvedValue(page([{ ...IMPORTANT, is_read: true }, { ...UNREAD, is_read: true }]))
    renderBell()
    await screen.findByRole('button', { name: 'Notifications, 2 non lues, dont 1 importante' })
    const panel = await openPanel()
    await within(panel).findByRole('button', { name: 'Assurance expirée, non lue, importante' })
    await userEvent.click(within(panel).getByRole('button', { name: t('notifications.markAllRead') }))

    expect(mocks.api.markAllNotificationsRead).toHaveBeenCalledOnce()
    // The panel is modal: the page behind it, the bell included, is hidden from the tree meanwhile.
    expect(await screen.findByRole('button', { name: t('notifications.bell'), hidden: true })).toBeInTheDocument()
    expect(dot()).toBeNull()
    // The list reloaded: the rows are read now.
    expect(await within(panel).findByRole('button', { name: 'Assurance expirée, importante' })).toBeInTheDocument()
    expect(mocks.api.listMyNotifications).toHaveBeenCalledTimes(2)
    expect(mocks.api.listMyNotifications).toHaveBeenLastCalledWith(null)
    expect(within(panel).getByRole('button', { name: t('notifications.markAllRead') })).toHaveAttribute('aria-disabled', 'true')
  })

  it('is inactive while it runs: a second press does nothing', async () => {
    let finish!: () => void
    mocks.api.markAllNotificationsRead.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 2, important: 1 })
    mocks.api.listMyNotifications.mockResolvedValue(page([IMPORTANT, UNREAD]))
    renderBell()
    await screen.findByRole('button', { name: 'Notifications, 2 non lues, dont 1 importante' })
    const panel = await openPanel()
    const markAll = await within(panel).findByRole('button', { name: t('notifications.markAllRead') })
    await userEvent.click(markAll)
    await waitFor(() => expect(markAll).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(markAll)
    expect(mocks.api.markAllNotificationsRead).toHaveBeenCalledOnce()
    // Still focusable (aria-disabled, not disabled).
    expect(markAll).not.toBeDisabled()

    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 0, important: 0 })
    await act(async () => finish())
    await screen.findByRole('button', { name: t('notifications.bell'), hidden: true })
  })
})
