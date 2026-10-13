import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { clinicTimeToUTC, getClinicDateString, shiftCalendarDay } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { DiscoveryCall } from '../api/calls'
import { DiscoveryCallsPage } from './DiscoveryCallsPage'

const mocks = vi.hoisted(() => ({
  calls: { listDiscoveryCalls: vi.fn(), rescheduleTask: vi.fn(), assignTask: vi.fn() },
  demandes: { completeTask: vi.fn(), cancelTask: vi.fn(), fetchReference: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/calls', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.calls }))
vi.mock('../api/demandes', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.demandes }))
vi.mock('@/core/realtime/use-org-realtime', () => ({ useOrgRealtime: () => undefined }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.demandes.calls'
const today = getClinicDateString(new Date())
const yesterday = shiftCalendarDay(today, -1)

function call(over: Partial<DiscoveryCall> = {}): DiscoveryCall {
  return {
    task_id: 't1',
    demande_id: 'd1',
    reference: 'DEM-2026-0001',
    person_name: 'Bruno Page',
    phone_e164: '+15145550122',
    language: 'fr',
    booked_online: true,
    is_urgent: false,
    demande_state: 'new',
    due_at: clinicTimeToUTC(today, '14:00'),
    state: 'open',
    outcome: null,
    assigned_to: null,
    assigned_name: null,
    done_at: null,
    done_by_name: null,
    ...over,
  }
}

beforeEach(() => {
  mocks.calls.listDiscoveryCalls.mockResolvedValue([
    call({ task_id: 't0', demande_id: 'd0', person_name: 'Chloé Hier', booked_online: false, due_at: clinicTimeToUTC(yesterday, '10:00') }),
    call(),
  ])
  mocks.calls.rescheduleTask.mockResolvedValue(undefined)
  mocks.calls.assignTask.mockResolvedValue(undefined)
  mocks.demandes.completeTask.mockResolvedValue(undefined)
  mocks.demandes.cancelTask.mockResolvedValue(undefined)
  mocks.demandes.fetchReference.mockResolvedValue({
    workers: [{ user_id: 'u2', display_name: 'Conseillère Deux' }],
    referral_sources: [],
    motifs: [],
    profession_titles: [],
    clienteles: [],
  })
})
afterEach(() => vi.clearAllMocks())

function renderPage(path = '/demandes/appels') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="demandes/appels" element={<DiscoveryCallsPage />} />
        </Routes>,
        { access: { access: accessForRole('counselor', { modules: ['demandes', 'clients', 'professionals'] }) }, path },
      )}
    </QueryClientProvider>,
  )
}

describe('DiscoveryCallsPage', () => {
  it('today: the calls not made since come first, « En retard »; the number to call; booked online', async () => {
    renderPage()
    const late = await screen.findByRole('link', { name: 'Chloé Hier' })
    const row = late.closest('li')!
    expect(within(row).getByText(t(`${C}.late`))).toBeInTheDocument()
    const bruno = screen.getByRole('link', { name: 'Bruno Page' }).closest('li')!
    expect(within(bruno).getByRole('link', { name: '514 555-0122' })).toHaveAttribute('href', 'tel:+15145550122')
    expect(within(bruno).getByText(t(`${C}.bookedOnline`))).toBeInTheDocument()
    expect(mocks.calls.listDiscoveryCalls).toHaveBeenCalledWith({ from: clinicTimeToUTC(today, '00:00'), to: clinicTimeToUTC(shiftCalendarDay(today, 1), '00:00'), overdue: true })
  })

  it('« Jointe » notes the call done; « Qui appelle » gives it to a counselor', async () => {
    const user = userEvent.setup()
    renderPage()
    const bruno = (await screen.findByRole('link', { name: 'Bruno Page' })).closest('li')!
    await user.click(within(bruno).getByRole('button', { name: t(`${C}.reached`) }))
    await waitFor(() => expect(mocks.demandes.completeTask).toHaveBeenCalledWith('d1', 't1', 'reached'))
    await user.selectOptions(await within(bruno).findByRole('combobox', { name: t(`${C}.whoFor`, { person: 'Bruno Page' }) }), 'u2')
    await waitFor(() => expect(mocks.calls.assignTask).toHaveBeenCalledWith('d1', 't1', 'u2'))
  })

  it('« Reporter… »: tomorrow at the same hour by default', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${C}.moveFor`, { person: 'Bruno Page' }) }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(t(`${C}.moveBodyOnline`))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.moveSave`) }))
    await waitFor(() => expect(mocks.calls.rescheduleTask).toHaveBeenCalledWith('d1', 't1', clinicTimeToUTC(shiftCalendarDay(today, 1), '14:00')))
  })

  it('« Annuler » asks first', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${C}.cancelFor`, { person: 'Bruno Page' }) }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.cancelAction`) }))
    await waitFor(() => expect(mocks.demandes.cancelTask).toHaveBeenCalledWith('d1', 't1'))
  })

  it('« Demain »: its own day, without the overdue', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: t(`${C}.view.tomorrow`) }))
    const tomorrow = shiftCalendarDay(today, 1)
    await waitFor(() =>
      expect(mocks.calls.listDiscoveryCalls).toHaveBeenLastCalledWith({
        from: clinicTimeToUTC(tomorrow, '00:00'),
        to: clinicTimeToUTC(shiftCalendarDay(tomorrow, 1), '00:00'),
        overdue: false,
      }),
    )
  })
})
