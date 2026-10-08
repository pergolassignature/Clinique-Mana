import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalsSettings } from '../../api/parse'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { FicheSettingsPage } from './FicheSettingsPage'

const mocks = vi.hoisted(() => ({
  settings: { fetchProfessionalsSettings: vi.fn(), saveProfessionalsSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/settings', () => mocks.settings)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const N = 'modules.professionals.settings.fiche'
const DEFAULTS: ProfessionalsSettings = { collectSin: false, ficheShowProContact: true, ficheShowClinicFooter: true, ficheShowClosing: true }

beforeEach(() => {
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue(DEFAULTS)
  mocks.settings.saveProfessionalsSettings.mockImplementation(async (patch: Partial<ProfessionalsSettings>) => ({ ...DEFAULTS, ...patch }))
})
afterEach(() => vi.resetAllMocks())

const render = (readOnly = false) => renderProfessionalsSettingsPage(<FicheSettingsPage />, { sectionId: 'fiche', readOnly })
const card = () => screen.findByRole('region', { name: t(`${N}.cardTitle`) })
const toggle = (scope: HTMLElement, label: string) => within(scope).getByRole('switch', { name: t(`${N}.${label}` as Parameters<typeof t>[0]) })

describe('FicheSettingsPage (P4-353)', () => {
  it('shows the three options, all on by default, each with its help text', async () => {
    render()
    expect(await screen.findByRole('heading', { name: t(`${N}.title`) })).toBeInTheDocument()
    const region = await card()
    for (const [label, help] of [
      ['showProContact', 'showProContactHelp'],
      ['showClinicFooter', 'showClinicFooterHelp'],
      ['showClosing', 'showClosingHelp'],
    ] as const) {
      const option = toggle(region, label)
      await waitFor(() => expect(option).toBeChecked())
      expect(option).toHaveAccessibleDescription(t(`${N}.${help}`))
    }
  })

  it('saves a switch at once, that key only', async () => {
    render()
    const region = await card()
    const closing = toggle(region, 'showClosing')
    await waitFor(() => expect(closing).not.toHaveAttribute('aria-disabled'))
    await userEvent.click(closing)
    await waitFor(() => expect(mocks.settings.saveProfessionalsSettings).toHaveBeenCalledExactlyOnceWith({ ficheShowClosing: false }))
    await waitFor(() => expect(closing).not.toBeChecked())
    expect(toggle(region, 'showProContact')).toBeChecked()
    expect(mocks.toast.success).toHaveBeenCalled()
  })

  it('shows a refusal under the switches and keeps the stored value', async () => {
    mocks.settings.saveProfessionalsSettings.mockRejectedValue(Object.assign(new Error('Permission refusée : professionals.settings'), { code: '42501' }))
    render()
    const region = await card()
    const footer = toggle(region, 'showClinicFooter')
    await waitFor(() => expect(footer).not.toHaveAttribute('aria-disabled'))
    await userEvent.click(footer)
    expect(await within(region).findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(footer).toBeChecked())
  })

  it('is read-only for the adjointe: the notice, switches that do not change', async () => {
    render(true)
    const region = await card()
    const contact = toggle(region, 'showProContact')
    await waitFor(() => expect(contact).toBeChecked())
    expect(contact).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(contact)
    expect(contact).toBeChecked()
    expect(mocks.settings.saveProfessionalsSettings).not.toHaveBeenCalled()
  })

  it('offers « Réessayer » when the settings cannot be read, never switches reading « on » without knowing', async () => {
    mocks.settings.fetchProfessionalsSettings.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ...DEFAULTS, ficheShowClosing: false })
    render()
    const region = await card()
    expect(await within(region).findByRole('alert')).toHaveTextContent(t(`${N}.loadError`))
    expect(within(region).queryByRole('switch')).not.toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(toggle(region, 'showClosing')).not.toBeChecked())
  })
})
