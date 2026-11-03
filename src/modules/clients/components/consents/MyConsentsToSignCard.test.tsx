import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { MyConsentsToSignCard } from './MyConsentsToSignCard'

const mocks = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn() }))
vi.mock('../../api/my-consents', async (o) => ({
  ...(await o<typeof import('../../api/my-consents')>()),
  fetchMyConsentSignatures: mocks.list,
  startMyConsentSignature: mocks.start,
}))
// The embedded frame is core's; here only that it is opened with the link that came back.
vi.mock('@/core/signing/components/EmbeddedSigning', () => ({
  EmbeddedSigning: ({ link, title }: { link: { token: string }; title: string }) => (
    <div data-testid="embed" data-token={link.token} data-title={title} />
  ),
}))

const M = 'modules.clients.mine.consents'

const row = (over: Record<string, unknown> = {}) => ({
  requestId: '11111111-1111-4111-8111-111111111111',
  consentKey: 'general',
  consentName: 'Consentement général',
  language: 'fr' as const,
  clientId: '22222222-2222-4222-8222-222222222222',
  clientName: 'Alice Tremblay',
  dueAt: null,
  requestedAt: null,
  state: 'ready' as const,
  ...over,
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{renderWithContexts(<MyConsentsToSignCard />, { path: '/mes-clients' })}</QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('« Consentements à signer » (CC-22)', () => {
  it('shows nothing when none waits, so « Mes clients » is unchanged', async () => {
    mocks.list.mockResolvedValue([])
    const { container } = setup()
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled())
    expect(container.querySelector('section')).toBeNull()
  })

  it('a consent waiting for her is signable, and opens the frame with her own token', async () => {
    mocks.list.mockResolvedValue([row()])
    mocks.start.mockResolvedValue({ host: 'https://sign.test', token: 'tok-pro', signingUrl: 'https://sign.test/sign/tok-pro' })
    setup()
    await screen.findByRole('region', { name: t(`${M}.title`) })
    expect(screen.getByText('Consentement général')).toBeInTheDocument()
    expect(screen.getByText(t(`${M}.states.ready`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${M}.sign`) }))
    const embed = await screen.findByTestId('embed')
    expect(embed).toHaveAttribute('data-token', 'tok-pro')
    expect(embed).toHaveAttribute('data-title', 'Consentement général — Alice Tremblay')
    expect(mocks.start).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
  })

  it('while the client has not signed, it says so and offers no signature', async () => {
    mocks.list.mockResolvedValue([row({ state: 'waiting_client' })])
    setup()
    await screen.findByRole('region', { name: t(`${M}.title`) })
    expect(screen.getByText(t(`${M}.states.waitingClient`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${M}.sign`) })).toBeNull()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('once signed, the row stays but cannot be signed again', async () => {
    mocks.list.mockResolvedValue([row({ state: 'signed' })])
    setup()
    await screen.findByRole('region', { name: t(`${M}.title`) })
    expect(screen.getByText(t(`${M}.states.signed`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${M}.sign`) })).toBeNull()
  })

  it('a failed read says so and offers to try again', async () => {
    mocks.list.mockRejectedValue(new Error('boom'))
    setup()
    expect(await screen.findByText(t(`${M}.loadError`))).toBeInTheDocument()
  })
})
