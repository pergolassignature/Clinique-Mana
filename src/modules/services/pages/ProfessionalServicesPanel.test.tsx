import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import { ProfessionalServicesPanel } from './ProfessionalServicesPanel'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../api/offered', async (o) => ({ ...(await o<typeof import('../api/offered')>()), fetchOfferedServices: mocks.fetch }))

const O = 'modules.services.offered'

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="professionnels/:id/:onglet" element={<ProfessionalServicesPanel />} />
        </Routes>,
        { path: '/professionnels/p1/jumelage' },
      )}
    </QueryClientProvider>,
  )
}

const row = { forTwo: false, taxRule: 'exempt', titleIds: ['psy'] } as const

describe('« Services offerts » on a professional’s record (L26)', () => {
  it('her services by code, with the duration and pause and her price today; « À confirmer » without a grid', async () => {
    mocks.fetch.mockResolvedValue([
      { ...row, id: 's1', code: 10150, name: 'Consultation individuelle 50 min', durationMinutes: 50, bufferAfterMinutes: 10, priceSource: 'grid', priceCents: 17500 },
      { ...row, id: 's2', code: 20170, name: 'Thérapie de couple', durationMinutes: 80, bufferAfterMinutes: 10, priceSource: 'grid', priceCents: null, forTwo: true },
    ])
    renderPanel()
    const table = await screen.findByRole('table', { name: t(`${O}.title`) })
    const session = within(table).getByText('Consultation individuelle 50 min').closest('tr') as HTMLElement
    expect(session).toHaveTextContent('10150')
    expect(session).toHaveTextContent('175,00')
    const couple = within(table).getByText('Thérapie de couple').closest('tr') as HTMLElement
    expect(couple).toHaveTextContent(t(`${O}.toConfirm`))
    expect(couple).toHaveTextContent(t(`${O}.forTwo`))
    expect(mocks.fetch).toHaveBeenCalledWith('p1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('none for her titles: says so', async () => {
    mocks.fetch.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText(t(`${O}.empty`))).toBeInTheDocument()
  })
})
