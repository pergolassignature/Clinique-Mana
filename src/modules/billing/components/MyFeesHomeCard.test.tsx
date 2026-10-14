import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { billingManifest } from '../manifest'
import { MyFeesHomeCard } from './MyFeesHomeCard'

const mocks = vi.hoisted(() => ({ fees: vi.fn() }))
vi.mock('../api/follow-up', async (o) => ({ ...(await o<typeof import('../api/follow-up')>()), fetchFeeDecisions: mocks.fees }))

const H = 'modules.billing.home'

afterEach(() => vi.clearAllMocks())

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(<MyFeesHomeCard />, { path: '/accueil', access: { access: accessForRole('provider') } })}
    </QueryClientProvider>,
  )
}

describe('Accueil « Frais d’annulation à décider » (a professional, R-59)', () => {
  it('her fees to decide, a link to the panel under « Mon agenda »', async () => {
    mocks.fees.mockResolvedValue([{}, {}])
    renderCard()
    expect(await screen.findByRole('region', { name: t(`${H}.mineTitle`) })).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/mon-agenda#frais')
    expect(screen.getByRole('link')).toHaveTextContent(`2${t(`${H}.items.myFees`)}`)
    expect(mocks.fees).toHaveBeenCalledWith('pending')
  })

  it('nothing when there is none', async () => {
    mocks.fees.mockResolvedValue([])
    const { container } = renderCard()
    await vi.waitFor(() => expect(mocks.fees).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('is a professional’s card only (billing.self with a professional file)', () => {
    const card = billingManifest.homeCards?.find((c) => c.id === 'billing-my-fees')
    expect(card?.permission).toBe('billing.self')
    expect(card?.shownWhen?.(accessForRole('provider'))).toBe(true)
    expect(card?.shownWhen?.(accessForRole('admin'))).toBe(false)
  })
})
