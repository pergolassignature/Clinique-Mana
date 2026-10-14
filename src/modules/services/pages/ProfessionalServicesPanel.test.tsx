import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { ProfessionalServicesPanel } from './ProfessionalServicesPanel'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/offered', async (o) => ({ ...(await o<typeof import('../api/offered')>()), fetchOfferedServices: mocks.fetch, setServiceExclusions: mocks.save }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

const O = 'modules.services.offered'

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

function renderPanel(permissions: string[] = ['services.view']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="professionnels/:id/:onglet" element={<ProfessionalServicesPanel />} />
        </Routes>,
        { path: '/professionnels/p1/jumelage', access: { access: { ...testAccess, permissions } } },
      )}
    </QueryClientProvider>,
  )
}

const row = { forTwo: false, taxRule: 'exempt', titleIds: ['psy'], excludedProfessionalIds: [], offered: true } as const
const SESSION = { ...row, id: 's1', code: 10150, name: 'Consultation individuelle 50 min', durationMinutes: 50, bufferAfterMinutes: 10, priceSource: 'grid', priceCents: 17500 }
const COUPLE = { ...row, id: 's2', code: 20170, name: 'Thérapie de couple', durationMinutes: 80, bufferAfterMinutes: 10, priceSource: 'grid', priceCents: null, forTwo: true }

describe('« Services offerts » on a professional’s record (L26, R-83)', () => {
  it('her services by code, with the duration and pause and her price today; « À confirmer » without a grid', async () => {
    mocks.fetch.mockResolvedValue([SESSION, COUPLE])
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

  it('read-only without professionals.manage: no box, « Non offert » on a service she does not offer', async () => {
    mocks.fetch.mockResolvedValue([SESSION, { ...COUPLE, offered: false }])
    renderPanel(['services.view', 'professionals.view'])
    const table = await screen.findByRole('table', { name: t(`${O}.title`) })
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(table).getByText('Thérapie de couple').closest('tr')).toHaveTextContent(t(`${O}.notOffered`))
    expect(within(table).getByText('Consultation individuelle 50 min').closest('tr')).not.toHaveTextContent(t(`${O}.notOffered`))
  })

  it('with professionals.manage: a box per service, all checked by default; unchecking one saves the list she does not offer', async () => {
    mocks.fetch.mockResolvedValue([SESSION, COUPLE])
    mocks.save.mockResolvedValue(1)
    renderPanel([...accessForRole('admin_assistant').permissions])
    const couple = await screen.findByRole('checkbox', { name: t(`${O}.offerLabel`, { service: '20170 Thérapie de couple' }) })
    expect(screen.getByRole('checkbox', { name: t(`${O}.offerLabel`, { service: '10150 Consultation individuelle 50 min' }) })).toBeChecked()
    expect(couple).toBeChecked()
    expect(screen.getByText(t(`${O}.allOffered`))).toBeInTheDocument()
    // Nothing to save yet.
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()

    await userEvent.click(couple)
    expect(couple).not.toBeChecked()
    expect(screen.getByText(t(`${O}.someNotOffered.one`, { count: '1' }))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith('p1', ['s2']))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${O}.saved`))
  })

  it('a service unchecked before: checking it again saves an empty list', async () => {
    mocks.fetch.mockResolvedValue([SESSION, { ...COUPLE, offered: false }])
    mocks.save.mockResolvedValue(0)
    renderPanel([...accessForRole('admin_assistant').permissions])
    const couple = await screen.findByRole('checkbox', { name: t(`${O}.offerLabel`, { service: '20170 Thérapie de couple' }) })
    expect(couple).not.toBeChecked()
    await userEvent.click(couple)
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith('p1', []))
  })

  it('none for her titles: says so', async () => {
    mocks.fetch.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText(t(`${O}.empty`))).toBeInTheDocument()
  })
})
