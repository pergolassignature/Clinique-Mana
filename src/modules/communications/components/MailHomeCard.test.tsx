import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { MailHomeCard } from './MailHomeCard'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../api/mailboxes', async (o) => ({ ...(await o<typeof import('../api/mailboxes')>()), listMailConnections: mocks.list }))

const H = 'modules.communications.home'

afterEach(() => vi.clearAllMocks())

describe('Accueil « Courriels non lus » (L29)', () => {
  it('each connected mailbox with unread threads, to its « Non lus »; never a disconnected one', async () => {
    mocks.list.mockResolvedValue([
      { id: 'm1', email_address: 'info@clinique.test', status: 'connected', unread_count: 4 },
      { id: 'm2', email_address: 'admin@clinique.test', status: 'connected', unread_count: 0 },
      { id: 'm3', email_address: 'old@clinique.test', status: 'disconnected', unread_count: 9 },
    ])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}>{renderWithContexts(<MailHomeCard />, { path: '/accueil' })}</QueryClientProvider>)
    await screen.findByRole('region', { name: t(`${H}.title`) })
    expect(screen.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [`4${t(`${H}.unreadIn`, { mailbox: 'info@clinique.test' })}`, '/courriels?boite=m1&vue=unread'],
    ])
  })
})
