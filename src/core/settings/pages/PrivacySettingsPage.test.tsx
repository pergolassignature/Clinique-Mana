import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { LEAVE_LINK, renderOrganizationPage, testOrganization } from '@/test/organization'
import { PrivacySettingsPage } from './PrivacySettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchOrganization: vi.fn(), updateOrganization: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/organization/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const FIELDS = {
  officerName: t('settings.privacy.fields.officerName'),
  officerEmail: t('settings.privacy.fields.officerEmail'),
  policyUrl: t('settings.privacy.fields.policyUrl'),
  retentionYears: t('settings.privacy.fields.retentionYears'),
}
const RETENTION_HELP = 'Les notes cliniques ne sont pas conservées dans l\'application.'

const cardNamed = (key: 'officer' | 'policy') => screen.getByRole('form', { name: t(`settings.privacy.${key}.title`) })
const field = (key: keyof typeof FIELDS) => screen.getByRole('textbox', { name: FIELDS[key] })
const saveCard = (key: 'officer' | 'policy') => userEvent.click(within(cardNamed(key)).getByRole('button', { name: t('common.save') }))

const labelledControlsOf = (form: HTMLElement) =>
  [...form.querySelectorAll('label')].map((label) => document.getElementById(label.htmlFor) as HTMLElement)
const labelledControls = () => screen.getAllByRole('form').flatMap(labelledControlsOf)

async function edit(element: HTMLElement, value: string) {
  await userEvent.clear(element)
  if (value) await userEvent.type(element, value)
}

async function renderPage({ organization = testOrganization, readOnly = false }: { organization?: Organization; readOnly?: boolean } = {}) {
  mocks.api.fetchOrganization.mockResolvedValue(organization)
  const result = renderOrganizationPage(<PrivacySettingsPage />, { readOnly })
  await screen.findByRole('form', { name: t('settings.privacy.officer.title') })
  return result
}

function saveEchoes() {
  mocks.api.updateOrganization.mockImplementation(async (_id: string, patch: Partial<Organization>) => ({ ...testOrganization, ...patch }))
}

describe('PrivacySettingsPage', () => {
  it('shows the title and description, loads, then fills the two cards', async () => {
    mocks.api.fetchOrganization.mockResolvedValue(testOrganization)
    renderOrganizationPage(<PrivacySettingsPage />)
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.privacy') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.privacy.description'))).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))

    expect(await screen.findByRole('form', { name: t('settings.privacy.officer.title') })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Responsable de la protection des renseignements personnels',
      'Politique et conservation',
    ])
    expect(field('officerName')).toHaveValue('Julie Roy')
    expect(field('officerEmail')).toHaveValue('vie-privee@cliniquemana.com')
    expect(field('officerEmail')).toHaveAttribute('type', 'email')
    expect(field('policyUrl')).toHaveValue('https://cliniquemana.com/confidentialite')
    expect(field('policyUrl')).toHaveAttribute('placeholder', 'https://')
    expect(field('retentionYears')).toHaveValue('7')
    expect(field('retentionYears')).toHaveAttribute('inputmode', 'numeric')
    expect(field('retentionYears')).toHaveAccessibleDescription(RETENTION_HELP)
  })

  it('shows empty fields when nothing is stored', async () => {
    await renderPage({
      organization: { ...testOrganization, privacy_officer_name: null, privacy_officer_email: null, privacy_policy_url: null, record_retention_years: null },
    })
    for (const key of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) expect(field(key)).toHaveValue('')
  })

  it('refuses an invalid email without saving', async () => {
    await renderPage()
    await edit(field('officerEmail'), 'julie@')
    await saveCard('officer')
    expect(await screen.findByText(t('auth.errors.invalidEmail'))).toBeInTheDocument()
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it('refuses an http:// policy address without saving', async () => {
    await renderPage()
    await edit(field('policyUrl'), 'http://cliniquemana.com/vie-privee')
    await saveCard('policy')
    expect(await screen.findByText("L'adresse doit commencer par https://")).toBeInTheDocument()
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it.each(['0', '51', '7.5', 'sept'])('refuses a retention of « %s » years without saving', async (value) => {
    await renderPage()
    await edit(field('retentionYears'), value)
    await saveCard('policy')
    expect(await screen.findByText('Entre 1 et 50 ans.')).toBeInTheDocument()
    expect(field('retentionYears')).toHaveAccessibleDescription(`${RETENTION_HELP} Entre 1 et 50 ans.`)
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it('« Responsable »: saves its two fields only, then confirms « Responsable enregistré. »', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('officerName'), ' Luc Côté ')
    await edit(field('officerEmail'), ' confidentialite@cliniquemana.com ')
    await saveCard('officer')

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Responsable enregistré.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', {
      privacy_officer_name: 'Luc Côté',
      privacy_officer_email: 'confidentialite@cliniquemana.com',
    })
  })

  it('« Politique et conservation »: saves its two fields only, the address with https:// and the years as a number', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('policyUrl'), 'cliniquemana.com/vie-privee')
    await edit(field('retentionYears'), '10')
    await saveCard('policy')

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Politique et conservation enregistrées.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', {
      privacy_policy_url: 'https://cliniquemana.com/vie-privee',
      record_retention_years: 10,
    })
    await waitFor(() => expect(field('policyUrl')).toHaveValue('https://cliniquemana.com/vie-privee'))
  })

  it('clears the policy fields back to null', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('policyUrl'), '')
    await edit(field('retentionYears'), '')
    await saveCard('policy')
    await waitFor(() =>
      expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', { privacy_policy_url: null, record_retention_years: null }),
    )
  })

  it('shows the mapped error when the save is refused', async () => {
    mocks.api.updateOrganization.mockRejectedValue({ code: '23514', message: 'new row violates check constraint "organizations_record_retention_years_check"' })
    await renderPage()
    await edit(field('retentionYears'), '12')
    await saveCard('policy')
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.invalidValue')))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('asks before leaving with unsaved changes', async () => {
    await renderPage()
    await userEvent.type(field('officerName'), 'x')
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('follows the reading order with Tab, card by card', async () => {
    await renderPage()
    expect(labelledControls().map((c) => c.getAttribute('name'))).toEqual([
      'privacy_officer_name',
      'privacy_officer_email',
      'privacy_policy_url',
      'record_retention_years',
    ])
    const order = screen.getAllByRole('form').flatMap((form) => {
      const buttons = within(form).getAllByRole('button')
      expect(buttons.map((b) => b.textContent)).toEqual([t('common.cancel'), t('common.save')])
      return [...labelledControlsOf(form), ...buttons]
    })
    const [first, ...rest] = order
    first?.focus()
    for (const control of rest) {
      await userEvent.tab()
      expect(document.activeElement).toBe(control)
    }
  })

  describe('read-only (settings.view without settings.manage)', () => {
    it('shows the notice once, every field read-only (focusable, not disabled), no placeholder and no buttons', async () => {
      await renderPage({ readOnly: true })
      expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
      const controls = labelledControls()
      expect(controls).toHaveLength(4)
      for (const control of controls) {
        expect(control).toHaveRole('textbox')
        expect(control).toHaveAttribute('readonly')
        expect(control).toBeEnabled()
      }
      expect(screen.getAllByRole('textbox')).toEqual(controls)
      expect(field('retentionYears')).toHaveValue('7')
      expect(field('policyUrl')).not.toHaveAttribute('placeholder')
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('lets the values be reached and not changed', async () => {
      await renderPage({ readOnly: true })
      field('retentionYears').focus()
      await userEvent.keyboard('9')
      expect(field('retentionYears')).toHaveValue('7')
      await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
    })
  })
})
