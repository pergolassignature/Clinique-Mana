import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import type { BookingSettings } from '../../api/booking'
import { demandesManifest } from '../../manifest'
import { BookingSettingsPage } from './BookingSettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchBookingSettings: vi.fn(), saveBookingSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/booking', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

const S = 'modules.demandes.booking.settings'
const SETTINGS: BookingSettings = {
  enabled: false,
  slotMinutes: 15,
  noticeHours: 4,
  horizonDays: 14,
  capacity: 1,
  weekly: [{ day: 1, start: '09:00', end: '12:00' }],
}

beforeEach(() => {
  mocks.api.fetchBookingSettings.mockResolvedValue(SETTINGS)
  mocks.api.saveBookingSettings.mockImplementation(async (s: BookingSettings) => s)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false } = {}) {
  const section = demandesManifest.settingsSections.find((s) => s.id === 'booking')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { modules: ['clients', 'professionals', 'demandes'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<BookingSettingsPage />, { readOnly, section, access: { access }, path: '/parametres/appels-decouverte' })}
    </QueryClientProvider>,
  )
  return access
}

describe('BookingSettingsPage', () => {
  it('the page’s address for the website, and « ouverte » switched on at once', async () => {
    const access = renderPage()
    expect(await screen.findByDisplayValue(`${window.location.origin}/appel-decouverte?clinique=${access.org_id}`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: t(`${S}.page.enabled`) }))
    await waitFor(() => expect(mocks.api.saveBookingSettings).toHaveBeenCalledExactlyOnceWith({ ...SETTINGS, enabled: true }))
  })

  it('adds a range to a day and saves the whole rule; a number out of bounds is refused first', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.slots.addFor`, { day: 'Mardi' }) }))
    const capacity = screen.getByRole('textbox', { name: new RegExp(`^${t(`${S}.slots.capacity`)}`) })
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '9')
    const form = capacity.closest('form')!
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    expect(within(form).getByText(t(`${S}.slots.invalid`))).toBeInTheDocument()
    expect(mocks.api.saveBookingSettings).not.toHaveBeenCalled()
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '2')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveBookingSettings).toHaveBeenCalledExactlyOnceWith({
        ...SETTINGS,
        capacity: 2,
        weekly: [{ day: 1, start: '09:00', end: '12:00' }, { day: 2, start: '09:00', end: '12:00' }],
      }),
    )
  })

  it('read-only: no add nor remove, no save', async () => {
    renderPage({ readOnly: true })
    await screen.findByDisplayValue(/appel-decouverte/)
    expect(screen.queryByRole('button', { name: t(`${S}.slots.addFor`, { day: 'Mardi' }) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })
})
