import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import type { WaitlistSettings } from '../../api/waitlist'
import { demandesManifest } from '../../manifest'
import { WaitlistSettingsPage } from './WaitlistSettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchWaitlistSettings: vi.fn(), saveWaitlistSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/waitlist', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.demandes.waitlist.settings'
const SETTINGS: WaitlistSettings = { followupWeeks: 8, followupEmail: false, answerDays: 14 }

beforeEach(() => {
  mocks.api.fetchWaitlistSettings.mockResolvedValue(SETTINGS)
  mocks.api.saveWaitlistSettings.mockImplementation(async (s: WaitlistSettings) => s)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false } = {}) {
  const section = demandesManifest.settingsSections.find((s) => s.id === 'waitlist')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('counselor', { modules: ['clients', 'professionals', 'demandes'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<WaitlistSettingsPage />, { readOnly, section, access: { access }, path: '/parametres/liste-attente' })}
    </QueryClientProvider>,
  )
}

describe('WaitlistSettingsPage', () => {
  it('the follow-up: weeks, the email switched on, the answer days; saved together', async () => {
    const user = userEvent.setup()
    renderPage()
    const weeks = await screen.findByRole('textbox', { name: t(`${S}.followUp.weeks`) })
    await user.clear(weeks)
    await user.type(weeks, '6')
    await user.click(screen.getByRole('switch', { name: t(`${S}.followUp.email`) }))
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveWaitlistSettings).toHaveBeenCalledWith({ followupWeeks: 6, followupEmail: true, answerDays: 14 }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.saved`))
  })

  it('out of range: said in French, nothing saved', async () => {
    const user = userEvent.setup()
    renderPage()
    const days = await screen.findByRole('textbox', { name: t(`${S}.followUp.days`) })
    await user.clear(days)
    await user.type(days, '90')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${S}.daysInvalid`))).toBeInTheDocument()
    expect(mocks.api.saveWaitlistSettings).not.toHaveBeenCalled()
  })

  it('read only without demandes.waitlist', async () => {
    renderPage({ readOnly: true })
    expect(await screen.findByRole('textbox', { name: t(`${S}.followUp.weeks`) })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })
})
