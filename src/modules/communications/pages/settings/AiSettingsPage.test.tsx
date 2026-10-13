import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { communicationsManifest } from '../../manifest'
import { AiSettingsPage } from './AiSettingsPage'

const mocks = vi.hoisted(() => ({
  ai: { fetchAiSettings: vi.fn(), saveAiSettings: vi.fn() },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/ai')>()), ...mocks.ai }))
vi.mock('@/core/settings/secrets/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.secrets }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.communications.ai.settings'
const SAVED = {
  enabled: false,
  model: 'gpt-5.4',
  monthly_cap_cents: 5000,
  input_cents_per_mtok: 125,
  output_cents_per_mtok: 1000,
  key_configured: true,
  month_requests: 12,
  month_spent_cents: 340,
  updated_at: null,
}

beforeEach(() => {
  mocks.ai.fetchAiSettings.mockResolvedValue(SAVED)
  mocks.ai.saveAiSettings.mockResolvedValue(undefined)
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([{ key: 'openai_api_key', updated_at: '2027-03-01T15:00:00Z' }])
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false } = {}) {
  const section = communicationsManifest.settingsSections.find((s) => s.id === 'ai')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { modules: ['communications'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<AiSettingsPage />, { readOnly, section, access: { access }, path: '/parametres/ia' })}
    </QueryClientProvider>,
  )
}

describe('AiSettingsPage', () => {
  it('the key (write-only), the settings and the month’s use', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: t(`${S}.keyTitle`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${S}.usage`, { count: '12', spent: '3,40 $', cap: '50 $' }))).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: new RegExp(`^${t(`${S}.model`)}`) })).toHaveValue('gpt-5.4')
  })

  it('switched on with a cap in dollars: saved in cents', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: t(`${S}.formTitle`) })
    await user.click(screen.getByRole('checkbox', { name: t(`${S}.enabled`) }))
    const cap = screen.getByRole('textbox', { name: new RegExp(`^${t(`${S}.cap`).replace(/[()$]/g, '\\$&')}`) })
    await user.clear(cap)
    await user.type(cap, '25,50')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.ai.saveAiSettings).toHaveBeenCalledWith({ enabled: true, model: 'gpt-5.4', monthlyCapCents: 2550, inputCentsPerMtok: 125, outputCentsPerMtok: 1000 }),
    )
  })

  it('an unreadable cap is refused under its field', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: t(`${S}.formTitle`) })
    const cap = screen.getByRole('textbox', { name: new RegExp(`^${t(`${S}.cap`).replace(/[()$]/g, '\\$&')}`) })
    await user.clear(cap)
    await user.type(cap, 'beaucoup')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${S}.capInvalid`))).toBeInTheDocument()
    expect(mocks.ai.saveAiSettings).not.toHaveBeenCalled()
  })
})
