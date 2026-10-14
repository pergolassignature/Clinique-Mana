import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { ConsentsHomeCard } from './ConsentsHomeCard'

const mocks = vi.hoisted(() => ({ toObtain: vi.fn() }))
vi.mock('../api/consents', async (o) => ({ ...(await o<typeof import('../api/consents')>()), fetchConsentsToObtain: mocks.toObtain }))

const H = 'modules.clients.consents.home'

afterEach(() => vi.clearAllMocks())

describe('Accueil « Consentements à obtenir » (L29)', () => {
  it('the late ones, then the others waiting; both to « Consentements à obtenir »', async () => {
    mocks.toObtain.mockResolvedValue({ rows: [{ isOverdue: true }, { isOverdue: false }], total: 7 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}>{renderWithContexts(<ConsentsHomeCard />, { path: '/accueil' })}</QueryClientProvider>)
    await screen.findByRole('region', { name: t(`${H}.title`) })
    expect(screen.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [`1${t(`${H}.items.overdue`)}`, '/clients/consentements'],
      [`6${t(`${H}.items.waiting`)}`, '/clients/consentements'],
    ])
  })
})
