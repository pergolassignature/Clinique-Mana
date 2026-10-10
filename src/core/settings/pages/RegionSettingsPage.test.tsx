import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import type { Organization } from '@/core/settings/organization/api'
import { LEAVE_LINK, renderOrganizationPage, testOrganization } from '@/test/organization'
import { RegionSettingsPage } from './RegionSettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchOrganization: vi.fn(), updateOrganization: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/organization/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const EASTERN = "Heure de l'Est (Montréal, Toronto)"
const LABEL = t('settings.region.fields.timezone')
const OTHER = 'Autre fuseau…'
const PARIS = { ...testOrganization, timezone: 'Europe/Paris' }

const card = () => screen.getByRole('form', { name: t('settings.region.timezone.title') })
const timezoneSelect = () => screen.getByRole('combobox', { name: LABEL })
const otherButton = () => screen.getByRole('button', { name: OTHER })
const save = () => userEvent.click(within(card()).getByRole('button', { name: t('common.save') }))
const selectedLabel = () => within(timezoneSelect()).getByRole('option', { selected: true }).textContent

async function renderPage({ organization = testOrganization, readOnly = false }: { organization?: Organization; readOnly?: boolean } = {}) {
  mocks.api.fetchOrganization.mockResolvedValue(organization)
  const result = renderOrganizationPage(<RegionSettingsPage />, { readOnly })
  await screen.findByRole('form', { name: t('settings.region.timezone.title') })
  return result
}

function saveEchoes() {
  mocks.api.updateOrganization.mockImplementation(async (_id: string, patch: Partial<Organization>) => ({ ...testOrganization, ...patch }))
}

/** Opens « Autre fuseau… » and returns the dialog. */
async function openPicker() {
  await userEvent.click(otherButton())
  return screen.findByRole('dialog', { name: t('settings.region.picker.title') })
}

describe('RegionSettingsPage', () => {
  it('shows the title and description, loads, then the zone by its French name, the language and the currency', async () => {
    mocks.api.fetchOrganization.mockResolvedValue(testOrganization)
    renderOrganizationPage(<RegionSettingsPage />)
    expect(screen.getByRole('heading', { level: 1, name: t('settings.sections.region') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.region.description'))).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))

    expect(await screen.findByRole('form', { name: 'Heure de la clinique' })).toBeInTheDocument()
    expect(timezoneSelect()).toHaveValue('America/Toronto')
    expect(selectedLabel()).toBe(EASTERN)
    expect(otherButton()).toHaveAttribute('type', 'button')
    const locale = screen.getByRole('region', { name: t('settings.region.locale.title') })
    expect(within(locale).getByText('Langue :').closest('div')).toHaveTextContent('Langue : Français (Canada)')
    expect(within(locale).getByText('Devise :').closest('div')).toHaveTextContent('Devise : dollar canadien (CAD)')
  })

  it('offers the eight Canadian zones by French name', async () => {
    await renderPage()
    const options = within(timezoneSelect()).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('value'))).toEqual([
      'America/Toronto',
      'America/Halifax',
      'America/St_Johns',
      'America/Winnipeg',
      'America/Regina',
      'America/Edmonton',
      'America/Vancouver',
      'America/Whitehorse',
    ])
    expect(options.map((o) => o.textContent)).toContain('Heure du Pacifique (Vancouver)')
  })

  it('shows a stored zone outside Canada by its name, as an extra option', async () => {
    await renderPage({ organization: PARIS })
    expect(timezoneSelect()).toHaveValue('Europe/Paris')
    expect(selectedLabel()).toBe('Europe/Paris')
    expect(within(timezoneSelect()).getAllByRole('option')).toHaveLength(9)
  })

  it('saves the zone only, confirms « Fuseau horaire enregistré. » and refreshes the access payload (clinic timezone)', async () => {
    saveEchoes()
    const { queryClient } = await renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.selectOptions(timezoneSelect(), 'America/Vancouver')
    await save()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Fuseau horaire enregistré.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', { timezone: 'America/Vancouver' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
    // Clean again: no « Annuler / Enregistrer » (FormActions hides them, decision UI-2).
    await waitFor(() => expect(within(card()).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument())
    expect(within(card()).queryByRole('button', { name: t('common.cancel') })).not.toBeInTheDocument()
  })

  describe('« Autre fuseau… »', () => {
    it('searches every zone, then the one chosen shows by name in the select and is saved', async () => {
      saveEchoes()
      await renderPage()
      const dialog = await openPicker()
      const search = within(dialog).getByRole('combobox')
      expect(search).toHaveAttribute('placeholder', t('settings.region.picker.placeholder'))
      // The Canadian zones come first, by French name; the current one is marked.
      expect(within(dialog).getByRole('option', { name: `${EASTERN} ${t('settings.region.picker.current')}` })).toBeInTheDocument()
      await userEvent.type(search, 'paris')
      expect(within(dialog).queryByRole('option', { name: 'Asia/Tokyo' })).not.toBeInTheDocument()
      await userEvent.click(within(dialog).getByRole('option', { name: 'Europe/Paris' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(timezoneSelect()).toHaveValue('Europe/Paris')
      expect(selectedLabel()).toBe('Europe/Paris')
      // Focus goes to the select, so the new zone is announced.
      await waitFor(() => expect(timezoneSelect()).toHaveFocus())
      await save()
      await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', { timezone: 'Europe/Paris' }))
    })

    it('announces the current zone when it opens', async () => {
      await renderPage({ organization: PARIS })
      const dialog = await openPicker()
      // A no-break space before the colon (French typography).
      expect(dialog).toHaveAccessibleDescription('Fuseau actuel\u00a0: Europe/Paris')
    })

    it('« Annuler » removes the zone added through the picker', async () => {
      await renderPage()
      const dialog = await openPicker()
      await userEvent.type(within(dialog).getByRole('combobox'), 'paris')
      await userEvent.click(within(dialog).getByRole('option', { name: 'Europe/Paris' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(within(timezoneSelect()).getByRole('option', { name: 'Europe/Paris' })).toBeInTheDocument()
      await userEvent.click(within(card()).getByRole('button', { name: t('common.cancel') }))
      expect(timezoneSelect()).toHaveValue('America/Toronto')
      expect(within(timezoneSelect()).queryByRole('option', { name: 'Europe/Paris' })).not.toBeInTheDocument()
      expect(within(timezoneSelect()).getAllByRole('option')).toHaveLength(8)
    })

    it('finds a Canadian zone by city, accents ignored', async () => {
      await renderPage({ organization: PARIS })
      const dialog = await openPicker()
      await userEvent.type(within(dialog).getByRole('combobox'), 'montreal')
      expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([EASTERN])
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(timezoneSelect()).toHaveValue('America/Toronto')
      // Enter chose the zone; it did not submit the card's form.
      expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
      // The stored zone stays offered, to go back to it.
      expect(within(timezoneSelect()).getByRole('option', { name: 'Europe/Paris' })).toBeInTheDocument()
    })

    it('says so when nothing matches, and closes with Échap without changing the zone', async () => {
      await renderPage()
      const dialog = await openPicker()
      await userEvent.type(within(dialog).getByRole('combobox'), 'zzzz')
      expect(within(dialog).getByText(t('settings.region.picker.empty'))).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(otherButton()).toHaveFocus())
      expect(timezoneSelect()).toHaveValue('America/Toronto')
      expect(within(card()).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    })
  })

  it('reports an unknown zone refused by the database (22023) and shows the generic message', async () => {
    mocks.api.updateOrganization.mockRejectedValue({ code: '22023', message: 'Fuseau horaire inconnu : Mars/Olympus' })
    await renderPage()
    await userEvent.selectOptions(timezoneSelect(), 'America/Halifax')
    await save()
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.generic')))
    expect(mocks.captureException).toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('asks before leaving with unsaved changes', async () => {
    await renderPage()
    await userEvent.selectOptions(timezoneSelect(), 'America/Regina')
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('« Annuler » puts the stored zone back and returns focus to the select', async () => {
    await renderPage()
    await userEvent.selectOptions(timezoneSelect(), 'America/Regina')
    await userEvent.click(within(card()).getByRole('button', { name: t('common.cancel') }))
    expect(timezoneSelect()).toHaveValue('America/Toronto')
    await waitFor(() => expect(timezoneSelect()).toHaveFocus())
  })

  it('follows the reading order with Tab: zone, « Autre fuseau… » (clean: no Annuler / Enregistrer, decision UI-2)', async () => {
    await renderPage()
    const buttons = within(card()).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([OTHER])
    const [first, ...rest] = [timezoneSelect(), ...buttons]
    first?.focus()
    for (const control of rest) {
      await userEvent.tab()
      expect(document.activeElement).toBe(control)
    }
  })

  describe('read-only (settings.view without settings.manage)', () => {
    it('shows the notice once, the zone as a read-only field with its French name, the language and currency, and no buttons', async () => {
      await renderPage({ readOnly: true })
      expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
      const zone = screen.getByRole('textbox', { name: LABEL })
      expect(zone).toHaveValue(EASTERN)
      expect(zone).toHaveAttribute('readonly')
      expect(zone).toBeEnabled()
      expect(screen.getAllByRole('textbox')).toEqual([zone])
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      // No « Autre fuseau… », no Annuler / Enregistrer.
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: t('settings.region.locale.title') })).toHaveTextContent('Français (Canada)')
    })

    it('shows a zone outside Canada by its name', async () => {
      await renderPage({ organization: PARIS, readOnly: true })
      expect(screen.getByRole('textbox', { name: LABEL })).toHaveValue('Europe/Paris')
    })

    it('lets the zone be reached and not changed', async () => {
      await renderPage({ readOnly: true })
      const zone = screen.getByRole('textbox', { name: LABEL })
      zone.focus()
      expect(zone).toHaveFocus()
      await userEvent.keyboard('Paris')
      expect(zone).toHaveValue(EASTERN)
      await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
    })
  })
})
