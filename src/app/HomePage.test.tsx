import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import type { ModuleHomeCard } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'
import { renderWithContexts } from '@/test/contexts'
import { HomePage } from './HomePage'

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
}))
vi.mock('@/core/notifications/api', () => mocks.api)

const notice: Notice = {
  id: 'n1',
  module_key: 'professionals',
  kind: 'professionals.insurance_expiring',
  importance: 'important',
  title: 'Assurance de Sophie Lavoie',
  body: null,
  link_path: null,
  subject_type: 'professional',
  subject_id: 'p1',
  created_at: new Date().toISOString(),
  is_read: false,
}

const SHORTCUTS = [{ path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users }] as const

/** Waits past the settle delay of useNothingShown (150 ms). */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)))

function renderHome(cards: readonly ModuleHomeCard[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(<HomePage cards={cards} shortcuts={SHORTCUTS} />, { path: '/accueil' })}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.api.listImportantUnreadNotifications.mockResolvedValue([])
  mocks.api.markNotificationsRead.mockResolvedValue(undefined)
})
afterEach(() => vi.resetAllMocks())

describe('HomePage when nothing needs attention', () => {
  it('says so once everything has loaded, with the shortcuts', async () => {
    renderHome()
    expect(await screen.findByText(t('home.empty.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('modules.professionals.name') })).toHaveAttribute('href', '/professionnels')
  })

  it('says nothing while the notices are still loading', async () => {
    mocks.api.listImportantUnreadNotifications.mockReturnValue(new Promise(() => {}))
    renderHome()
    await settle()
    expect(screen.queryByText(t('home.empty.title'))).not.toBeInTheDocument()
  })

  it('says nothing while a card’s code is still loading, nor when the card has something to say', async () => {
    let resolve: (module: { default: () => ReactElement }) => void = () => {}
    const card: ModuleHomeCard = {
      id: 'test-card',
      permission: 'settings.view',
      component: lazyPage(() => new Promise((r) => (resolve = r))),
    }
    renderHome([card])
    await settle()
    expect(screen.queryByText(t('home.empty.title'))).not.toBeInTheDocument()

    await act(async () => resolve({ default: () => <p>CARTE</p> }))
    expect(await screen.findByText('CARTE')).toBeInTheDocument()
    await settle()
    expect(screen.queryByText(t('home.empty.title'))).not.toBeInTheDocument()
  })

  it('shows up once a card that loaded has nothing to say', async () => {
    const card: ModuleHomeCard = { id: 'silent', permission: 'settings.view', component: lazyPage(async () => ({ default: () => null })) }
    renderHome([card])
    expect(await screen.findByText(t('home.empty.title'))).toBeInTheDocument()
  })

  it('stays hidden while a notice shows, and appears once it is dismissed', async () => {
    mocks.api.listImportantUnreadNotifications.mockResolvedValueOnce([notice]).mockResolvedValue([])
    mocks.api.countMyUnreadNotifications.mockResolvedValue({ total: 0, important: 0 })
    renderHome()
    expect(await screen.findByText(notice.title)).toBeInTheDocument()
    await settle()
    expect(screen.queryByText(t('home.empty.title'))).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: t('notifications.watch.dismiss') }))
    expect(await screen.findByText(t('home.empty.title'), {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.queryByText(notice.title)).not.toBeInTheDocument()
  })
})
