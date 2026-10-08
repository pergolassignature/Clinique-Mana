import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Home } from 'lucide-react'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import { notificationKeys } from '@/core/notifications/hooks'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { AppShell } from '../AppShell'
import { HomePage } from '../HomePage'

const mocks = vi.hoisted(() => ({
  countMyUnreadNotifications: vi.fn(),
  listImportantUnreadNotifications: vi.fn(),
}))
vi.mock('@/core/notifications/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/notifications/api')>()),
  countMyUnreadNotifications: mocks.countMyUnreadNotifications,
  listMyNotifications: async () => ({ notices: [], hasMore: false }),
  listImportantUnreadNotifications: mocks.listImportantUnreadNotifications,
}))
vi.mock('@/core/access/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/access/api')>()),
  fetchOrgRoles: async () => [],
}))

const IMPORTANT: Notice = {
  id: 'n1',
  module_key: 'professionals',
  kind: 'professionals.insurance_expiring',
  importance: 'important',
  title: 'Assurance de Sophie Lavoie',
  body: null,
  link_path: '/professionnels/p1',
  subject_type: 'professional',
  subject_id: 'p1',
  created_at: new Date().toISOString(),
  is_read: false,
}

/**
 * The shell with Accueil, as signed-in users first see it: the bell (in the topbar) and
 * « À surveiller » (on the page) both follow the unread count, which must be polled once.
 */
describe('Notifications in the shell', () => {
  it('on Accueil, the count has exactly one observer (one timer), and « À surveiller » none of its own', async () => {
    mocks.countMyUnreadNotifications.mockResolvedValue({ total: 1, important: 1 })
    mocks.listImportantUnreadNotifications.mockResolvedValue([IMPORTANT])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      renderWithContexts(
        <QueryClientProvider client={queryClient}>
          <UnsavedChangesProvider>
            <AppShell navItems={[{ path: '/accueil', labelKey: 'nav.home', icon: Home }]}>
              <HomePage />
            </AppShell>
          </UnsavedChangesProvider>
        </QueryClientProvider>,
        { path: '/accueil' },
      ),
    )

    expect(await screen.findByRole('region', { name: t('notifications.watch.title') })).toBeInTheDocument()
    await waitFor(() => expect(mocks.countMyUnreadNotifications).toHaveBeenCalledOnce())

    const count = queryClient.getQueryCache().find({ queryKey: notificationKeys.count() })
    expect(count?.observers).toHaveLength(1)
    expect(count?.observers[0]?.options.refetchInterval).toBe(60_000)

    const polled = queryClient
      .getQueryCache()
      .findAll({ queryKey: notificationKeys.all })
      .filter((query) => query.observers.some((observer) => observer.options.refetchInterval))
    expect(polled.map((query) => query.queryKey)).toEqual([notificationKeys.count()])
    expect(mocks.listImportantUnreadNotifications).toHaveBeenCalledOnce()
  })
})
