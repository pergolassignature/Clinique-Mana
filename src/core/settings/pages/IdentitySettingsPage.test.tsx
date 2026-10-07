import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { LEAVE_LINK, renderOrganizationPage, testOrganization } from '@/test/organization'
import { IdentitySettingsPage } from './IdentitySettingsPage'

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
  name: `${t('settings.identity.fields.name')} ${t('common.form.required')}`,
  legalName: t('settings.identity.fields.legalName'),
  neq: t('settings.identity.fields.neq'),
  addressLine1: t('settings.identity.fields.addressLine1'),
  addressLine2: t('settings.identity.fields.addressLine2'),
  city: t('settings.identity.fields.city'),
  province: t('settings.identity.fields.province'),
  postalCode: t('settings.identity.fields.postalCode'),
  phone: t('settings.identity.fields.phone'),
  email: t('settings.identity.fields.email'),
  website: t('settings.identity.fields.website'),
}

const cardNamed = (key: 'clinic' | 'address' | 'contact') => screen.getByRole('form', { name: t(`settings.identity.${key}.title`) })
const field = (key: keyof typeof FIELDS) => screen.getByRole('textbox', { name: FIELDS[key] })
const provinceSelect = () => screen.getByRole('combobox', { name: FIELDS.province })

/** The control of every field label in the cards, in document (reading) order. */
function labelledControls(): HTMLElement[] {
  return screen
    .getAllByRole('form')
    .flatMap((form) => [...form.querySelectorAll('label')])
    .map((label) => document.getElementById(label.htmlFor) as HTMLElement)
}

async function edit(element: HTMLElement, value: string) {
  await userEvent.clear(element)
  if (value) await userEvent.type(element, value)
}

/** Loads the page with the organization and waits for the cards. */
async function renderPage({ organization = testOrganization, readOnly = false }: { organization?: Organization; readOnly?: boolean } = {}) {
  mocks.api.fetchOrganization.mockResolvedValue(organization)
  const result = renderOrganizationPage(<IdentitySettingsPage />, { readOnly })
  await screen.findByRole('form', { name: t('settings.identity.clinic.title') })
  return result
}

/** The saved row is the organization with the patch applied, as the database returns it. */
function saveEchoes() {
  mocks.api.updateOrganization.mockImplementation(async (_id: string, patch: Partial<Organization>) => ({ ...testOrganization, ...patch }))
}

describe('IdentitySettingsPage', () => {
  it('shows the title and description, loads, then fills the three cards', async () => {
    mocks.api.fetchOrganization.mockResolvedValue(testOrganization)
    renderOrganizationPage(<IdentitySettingsPage />)
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.identity.description'))).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))

    expect(await screen.findByRole('form', { name: t('settings.identity.clinic.title') })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      t('settings.identity.clinic.title'),
      t('settings.identity.address.title'),
      t('settings.identity.contact.title'),
    ])
    expect(field('name')).toHaveValue('Clinique MANA')
    expect(field('legalName')).toHaveValue('9999-9999 Québec inc.')
    expect(field('neq')).toHaveValue('1234567890')
    expect(field('neq')).toHaveAttribute('inputmode', 'numeric')
    expect(field('neq')).toHaveAccessibleDescription(t('settings.identity.fields.neqHelp'))
    expect(field('name')).toHaveAccessibleDescription(t('settings.identity.fields.nameHelp'))
    expect(field('addressLine1')).toHaveValue('123, rue Saint-Denis')
    expect(field('addressLine1')).toHaveAttribute('autocomplete', 'address-line1')
    expect(field('addressLine2')).toHaveValue('Bureau 200')
    expect(field('city')).toHaveValue('Montréal')
    expect(provinceSelect()).toHaveValue('QC')
    expect(within(provinceSelect()).getByRole('option', { selected: true })).toHaveTextContent('Québec')
    expect(field('postalCode')).toHaveValue('H2X 1Y4')
    expect(field('postalCode')).toHaveAttribute('autocomplete', 'postal-code')
    expect(field('phone')).toHaveValue('514 555-1234')
    expect(field('phone')).toHaveAttribute('type', 'tel')
    expect(field('email')).toHaveValue('info@cliniquemana.com')
    expect(field('email')).toHaveAttribute('type', 'email')
    expect(field('website')).toHaveValue('https://cliniquemana.com')
    expect(field('website')).toHaveAttribute('placeholder', 'https://')
  })

  it('lists the 13 provinces by French name', async () => {
    await renderPage()
    const options = within(provinceSelect()).getAllByRole('option')
    expect(options.filter((o) => o.getAttribute('value') !== '')).toHaveLength(13)
    expect(options.map((o) => o.textContent)).toContain('Ontario')
  })

  describe('province', () => {
    const PLACEHOLDER = t('settings.identity.fields.provincePlaceholder')
    const saveAddress = () => userEvent.click(within(cardNamed('address')).getByRole('button', { name: t('common.save') }))

    it('without one stored, shows the placeholder (never a value that is not stored) and saves null', async () => {
      saveEchoes()
      await renderPage({ organization: { ...testOrganization, province: null } })
      expect(provinceSelect()).toHaveValue('')
      expect(within(provinceSelect()).getByRole('option', { selected: true })).toHaveTextContent(PLACEHOLDER)
      await edit(field('city'), 'Laval')
      await saveAddress()
      await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenCalledWith('o1', expect.objectContaining({ city: 'Laval', province: null })))
    })

    it('saves the province chosen', async () => {
      saveEchoes()
      await renderPage({ organization: { ...testOrganization, province: null } })
      await userEvent.selectOptions(provinceSelect(), 'QC')
      await saveAddress()
      await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenCalledWith('o1', expect.objectContaining({ province: 'QC' })))
    })

    it('can be cleared back to null with the empty option, worded « Aucune » while a province is chosen', async () => {
      saveEchoes()
      await renderPage()
      expect(within(provinceSelect()).getByRole('option', { name: t('settings.identity.fields.provinceNone') })).toBeEnabled()
      expect(t('settings.identity.fields.provinceNone')).toBe('Aucune')
      await userEvent.selectOptions(provinceSelect(), '')
      await saveAddress()
      await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenCalledWith('o1', expect.objectContaining({ province: null })))
    })

    it('read-only without one stored: an empty read-only field', async () => {
      await renderPage({ organization: { ...testOrganization, province: null }, readOnly: true })
      expect(field('province')).toHaveValue('')
      expect(field('province')).toHaveAttribute('readonly')
      expect(field('province')).not.toHaveAttribute('placeholder')
    })
  })

  it('shows a load error with a retry', async () => {
    mocks.api.fetchOrganization.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testOrganization)
    renderOrganizationPage(<IdentitySettingsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(t('settings.organization.loadError'))
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('form', { name: t('settings.identity.clinic.title') })).toBeInTheDocument()
  })

  it('refuses a NEQ of 3 digits without saving', async () => {
    await renderPage()
    await edit(field('neq'), '123')
    await userEvent.click(within(cardNamed('clinic')).getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText('Le NEQ compte 10 chiffres.')).toBeInTheDocument()
    expect(field('neq')).toHaveAccessibleDescription(`${t('settings.identity.fields.neqHelp')} Le NEQ compte 10 chiffres.`)
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it('« Clinique »: saves its three fields only, normalised, then confirms « Identité enregistrée. »', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('name'), '  Clinique MANA Laval ')
    await edit(field('legalName'), '')
    await edit(field('neq'), '1234 567-891')
    await userEvent.click(within(cardNamed('clinic')).getByRole('button', { name: t('common.save') }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Identité enregistrée.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', { name: 'Clinique MANA Laval', legal_name: null, neq: '1234567891' })
  })

  it('« Adresse du siège social »: saves its five fields only, with the chosen province and the postal code formatted', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('addressLine1'), '1, rue Wellington')
    await edit(field('addressLine2'), '')
    await edit(field('city'), 'Ottawa')
    await userEvent.selectOptions(provinceSelect(), 'ON')
    await edit(field('postalCode'), 'k1a0b1')
    await userEvent.click(within(cardNamed('address')).getByRole('button', { name: t('common.save') }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Adresse enregistrée.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', {
      address_line1: '1, rue Wellington',
      address_line2: null,
      city: 'Ottawa',
      province: 'ON',
      postal_code: 'K1A 0B1',
    })
  })

  it('« Coordonnées »: saves its three fields only, the phone in E.164 and the website with https://', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('phone'), '(418) 907-9754')
    await edit(field('email'), ' accueil@cliniquemana.com ')
    await edit(field('website'), 'www.cliniquemana.com')
    await userEvent.click(within(cardNamed('contact')).getByRole('button', { name: t('common.save') }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Coordonnées enregistrées.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', {
      phone: '+14189079754',
      email: 'accueil@cliniquemana.com',
      website: 'https://www.cliniquemana.com',
    })
    // The saved phone shows as typed in Quebec again.
    await waitFor(() => expect(field('phone')).toHaveValue('418 907-9754'))
  })

  it('formats the postal code and the phone when leaving the field', async () => {
    await renderPage()
    await edit(field('postalCode'), 'h3b2y5')
    await userEvent.tab()
    expect(field('postalCode')).toHaveValue('H3B 2Y5')
    await edit(field('phone'), '4189079754')
    await userEvent.tab()
    expect(field('phone')).toHaveValue('418 907-9754')
    // An invalid phone is left as typed, for the error to point at.
    await edit(field('phone'), '555-1234')
    await userEvent.tab()
    expect(field('phone')).toHaveValue('555-1234')
  })

  it.each([
    [{ code: 'P0001', message: 'Ce NEQ appartient déjà à une autre clinique.' }, 'Ce NEQ appartient déjà à une autre clinique.'],
    [{ code: '23514', message: 'new row violates check constraint "organizations_neq_check"' }, t('common.errors.invalidValue')],
  ])('shows the mapped error when the save is refused (%o)', async (error, message) => {
    mocks.api.updateOrganization.mockRejectedValue(error)
    await renderPage()
    await edit(field('neq'), '1234567891')
    await userEvent.click(within(cardNamed('clinic')).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('one card saving keeps the edits typed in another', async () => {
    saveEchoes()
    await renderPage()
    await edit(field('city'), 'Laval')
    await edit(field('neq'), '1234567891')
    await userEvent.click(within(cardNamed('clinic')).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
    expect(field('city')).toHaveValue('Laval')
    expect(within(cardNamed('address')).getByRole('button', { name: t('common.save') })).toBeEnabled()
  })

  it('asks before leaving with unsaved changes', async () => {
    await renderPage()
    await userEvent.type(field('city'), ' Nord')
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it("follows the reading order with Tab, card by card (the clean cards' disabled buttons are skipped)", async () => {
    await renderPage()
    // Every labelled control, in the order the cards and fields are read.
    const controls = labelledControls()
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(['name', 'legal_name', 'neq', 'address_line1', 'address_line2', 'city', 'province', 'postal_code', 'phone', 'email', 'website'])
    const [first, ...rest] = controls
    first?.focus()
    for (const control of rest) {
      await userEvent.tab()
      expect(document.activeElement).toBe(control)
    }
  })

  describe('read-only (settings.view without settings.manage)', () => {
    it('shows the notice once, at the top, and no card badge', async () => {
      await renderPage({ readOnly: true })
      expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
      expect(screen.getByText(t('common.readOnlyNotice.body'))).toBeInTheDocument()
    })

    it('renders every field read-only (focusable, not disabled), the province as its name, and no buttons', async () => {
      await renderPage({ readOnly: true })
      // Every labelled control is a read-only, enabled text field, and there is no other textbox.
      const controls = labelledControls()
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control).toHaveRole('textbox')
        expect(control).toHaveAttribute('readonly')
        expect(control).toBeEnabled()
      }
      expect(screen.getAllByRole('textbox')).toEqual(controls)
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(field('province')).toHaveValue('Québec')
      expect(field('neq')).toHaveValue('1234567890')
      expect(field('website')).not.toHaveAttribute('placeholder')
      expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: t('common.cancel') })).not.toBeInTheDocument()
      // Without the required marker: the label is just « Nom affiché ».
      expect(screen.getByRole('textbox', { name: t('settings.identity.fields.name') })).toBeInTheDocument()
    })

    it('lets the values be reached with Tab and not changed', async () => {
      await renderPage({ readOnly: true })
      const neq = field('neq')
      neq.focus()
      expect(neq).toHaveFocus()
      await userEvent.keyboard('999')
      expect(neq).toHaveValue('1234567890')
      await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
    })
  })
})
