import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { ClientNumber } from '../api/sms'
import { ClientSmsPanel } from './ClientSmsPanel'

const mocks = vi.hoisted(() => ({
  api: { listClientSms: vi.fn(), listSmsThread: vi.fn(), sendSms: vi.fn(), setSmsThreadLink: vi.fn(), getSmsThreadLink: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/sms', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/sms')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.communications.clientSms'
const S = 'modules.communications.sms'

const number = (over: Partial<ClientNumber> = {}): ClientNumber => ({
  phone: '+15145550101',
  kind: 'mobile',
  consent: 'opted_in',
  messageCount: 0,
  lastMessageAt: null,
  linkStatus: 'unlinked',
  ...over,
})

function open() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/clients/:id/:onglet" element={<ClientSmsPanel />} />
        </Routes>,
        { path: '/clients/c1/courriels', access: { access: accessForRole('counselor', { modules: ['communications', 'clients'] }) } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.api.listClientSms.mockResolvedValue([number(), number({ phone: '+15145550188', kind: 'linked', consent: null, messageCount: 2, linkStatus: 'linked' })])
  mocks.api.listSmsThread.mockResolvedValue({ messages: [], truncated: false })
  mocks.api.sendSms.mockResolvedValue({ id: 'm1' })
  mocks.api.setSmsThreadLink.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('ClientSmsPanel (SM-16)', () => {
  it('the file’s numbers with their kind and consent; a first text links the number to the file, then goes', async () => {
    const user = userEvent.setup()
    open()
    const list = await screen.findByRole('list', { name: t(`${P}.numbers`) })
    expect(within(list).getByText(t(`${P}.kinds.mobile`))).toBeInTheDocument()
    expect(within(list).getByText(t(`${P}.kinds.linked`))).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: t(`${P}.open`, { phone: '514 555-0101' }) }))
    await user.type(await screen.findByPlaceholderText(t(`${S}.composer.label`)), 'Bonjour, votre rendez-vous est confirmé.')
    await user.click(screen.getByRole('button', { name: t(`${S}.composer.send`) }))
    await waitFor(() => expect(mocks.api.sendSms).toHaveBeenCalledWith({ to: '+15145550101', body: 'Bonjour, votre rendez-vous est confirmé.' }))
    expect(mocks.api.setSmsThreadLink).toHaveBeenCalledWith('+15145550101', 'c1')
    expect(mocks.api.setSmsThreadLink.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.sendSms.mock.invocationCallOrder[0]!)
  })

  it('a linked number: no link again; without a consent, no reply box', async () => {
    const user = userEvent.setup()
    open()
    const list = await screen.findByRole('list', { name: t(`${P}.numbers`) })
    await user.click(within(list).getByRole('button', { name: t(`${P}.open`, { phone: '514 555-0188' }) }))
    expect(await screen.findByText(t(`${S}.composer.noConsent`))).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: t('modules.communications.inbox.link.label') })).not.toBeInTheDocument()
  })

  it('no number on the file: says where to add one', async () => {
    mocks.api.listClientSms.mockResolvedValue([])
    open()
    expect(await screen.findByText(t(`${P}.empty`))).toBeInTheDocument()
  })
})
