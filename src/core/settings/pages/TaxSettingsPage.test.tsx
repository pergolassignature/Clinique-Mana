import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { TaxRate } from '@/core/settings/tax/api'
import { renderOrganizationPage, testOrganization } from '@/test/organization'
import { TaxSettingsPage } from './TaxSettingsPage'

const mocks = vi.hoisted(() => ({
  organization: { fetchOrganization: vi.fn(), updateOrganization: vi.fn() },
  tax: { fetchTaxRates: vi.fn(), addTaxRate: vi.fn(), deleteTaxRate: vi.fn(), taxRateOn: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/organization/api', () => mocks.organization)
vi.mock('@/core/settings/tax/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.tax }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

// Today is 2026-10-07 in the clinic (noon in Toronto). Only Date is faked, so userEvent's timers run.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T16:00:00Z'))
})
afterAll(() => vi.useRealTimers())
afterEach(() => vi.clearAllMocks())

const GST_SEEDED: TaxRate = { id: 'g1', tax: 'gst', rate: 0.05, effective_from: '2008-01-01', effective_to: null, created_at: '2026-10-07T15:00:00Z' }
const QST_ENDED: TaxRate = { id: 'q1', tax: 'qst', rate: 0.085, effective_from: '2012-01-01', effective_to: '2013-01-01', created_at: '2026-01-01T00:00:00Z' }
const QST_CURRENT: TaxRate = { id: 'q2', tax: 'qst', rate: 0.09975, effective_from: '2013-01-01', effective_to: '2027-01-01', created_at: '2026-01-01T00:00:00Z' }
const QST_UPCOMING: TaxRate = { id: 'q3', tax: 'qst', rate: 0.1, effective_from: '2027-01-01', effective_to: null, created_at: '2026-09-01T00:00:00Z' }
/** As fetchTaxRates orders them: by tax, newest first. */
const RATES = [GST_SEEDED, QST_UPCOMING, QST_CURRENT, QST_ENDED]

const card = (tax: 'gst' | 'qst') => screen.getByRole('region', { name: t(`settings.tax.taxes.${tax}.title`) })
const numbersCard = () => screen.getByRole('form', { name: t('settings.tax.numbers.title') })
const rowsOf = (tax: 'gst' | 'qst') => within(card(tax)).getAllByRole('row').slice(1)
/** Each cell's text, without the phone-only end date (`sm:hidden`, shown under the start date there). */
const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => {
      const copy = cell.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.sm\\:hidden').forEach((narrowOnly) => narrowOnly.remove())
      return copy.textContent?.replace(/[\u00A0\u202F]/g, ' ')
    })
const dialog = () => screen.getByRole('dialog')
const rateField = () => within(dialog()).getByRole('textbox', { name: `${t('settings.tax.dialog.rate')} ${t('common.form.required')}` })
// A date input has no textbox role; its label also holds the required marker.
const dateField = () => within(dialog()).getByLabelText(t('settings.tax.dialog.from'), { exact: false })

async function renderPage({ rates = RATES, readOnly = false }: { rates?: TaxRate[]; readOnly?: boolean } = {}) {
  mocks.organization.fetchOrganization.mockResolvedValue(testOrganization)
  mocks.tax.fetchTaxRates.mockResolvedValue(rates)
  const result = renderOrganizationPage(<TaxSettingsPage />, { readOnly })
  await screen.findAllByRole('table')
  return result
}

async function openAddDialog(tax: 'gst' | 'qst') {
  await userEvent.click(within(card(tax)).getByRole('button', { name: t('settings.tax.rates.add') }))
  return dialog()
}

/** A date input takes its value whole (typing it character by character is not portable). */
const setDate = (value: string) => fireEvent.change(dateField(), { target: { value } })

describe('TaxSettingsPage', () => {
  it('shows the numbers card grouped, with each format as help', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.tax') })).toBeInTheDocument()
    const gst = within(numbersCard()).getByRole('textbox', { name: t('settings.tax.fields.gst') })
    const qst = within(numbersCard()).getByRole('textbox', { name: t('settings.tax.fields.qst') })
    expect(gst).toHaveValue('123456789 RT 0001')
    expect(qst).toHaveValue('1234567890 TQ 0001')
    expect(gst).toHaveAccessibleDescription('9 chiffres + RT + 4 chiffres')
    expect(qst).toHaveAccessibleDescription('10 chiffres + TQ + 4 chiffres')
  })

  it('saves the numbers compacted, and groups a typed number once the field is left', async () => {
    mocks.organization.updateOrganization.mockImplementation(async (_id: string, patch: object) => ({ ...testOrganization, ...patch }))
    await renderPage()
    const gst = within(numbersCard()).getByRole('textbox', { name: t('settings.tax.fields.gst') })
    await userEvent.clear(gst)
    await userEvent.type(gst, '987654321rt0002')
    await userEvent.tab()
    expect(gst).toHaveValue('987654321 RT 0002')
    await userEvent.click(within(numbersCard()).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.organization.updateOrganization).toHaveBeenCalledWith('o1', { gst_number: '987654321RT0002', qst_number: '1234567890TQ0001' }),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.tax.numbers.saved'))
  })

  it('lists each tax in its own table, with the statuses for 2026-10-07 and the last day of each closed rate', async () => {
    await renderPage()
    expect(within(card('gst')).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      t('settings.tax.rates.rate'),
      t('settings.tax.rates.from'),
      t('settings.tax.rates.to'),
      t('settings.tax.rates.status'),
    ])
    expect(rowsOf('gst').map(cellsOf)).toEqual([['5 %', '1 janv. 2008', '—', 'En vigueur']])
    expect(rowsOf('qst').map(cellsOf)).toEqual([
      ['10 %', '1 janv. 2027', '—', 'À venir', t('settings.tax.rates.delete')],
      ['9,975 %', '1 janv. 2013', '31 déc. 2026', 'En vigueur', ''],
      ['8,5 %', '1 janv. 2012', '31 déc. 2012', 'Terminé', ''],
    ])
    expect(within(card('qst')).getByRole('region', { name: t('settings.tax.rates.scrollLabel', { tax: 'TVQ' }) })).toBeInTheDocument()
    // On a phone the « Jusqu'au » column is hidden and the end date shows under the start date.
    expect(within(card('qst')).getByText('au 31 déc. 2026')).toHaveClass('sm:hidden')
  })

  it('offers « Supprimer » only on the upcoming rate, never on a seeded first rate', async () => {
    await renderPage()
    expect(within(card('gst')).queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument()
    const deletes = within(card('qst')).getAllByRole('button', { name: /supprimer/i })
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toHaveAccessibleName(t('settings.tax.rates.deleteLabel', { rate: '10\u00A0%', date: '1 janv. 2027' }))
  })

  it('offers « Supprimer » on a rate in force created less than 24 hours ago (correction window)', async () => {
    const closed = { ...GST_SEEDED, effective_to: '2026-09-01', created_at: '2026-01-01T00:00:00Z' }
    const backdated: TaxRate = { id: 'g2', tax: 'gst', rate: 0.06, effective_from: '2026-09-01', effective_to: null, created_at: '2026-10-07T10:00:00Z' }
    await renderPage({ rates: [backdated, closed] })
    expect(rowsOf('gst').map(cellsOf)[0]).toEqual(['6 %', '1 sept. 2026', '—', 'En vigueur', t('settings.tax.rates.delete')])
  })

  it('deletes behind a confirmation', async () => {
    mocks.tax.deleteTaxRate.mockResolvedValue(undefined)
    await renderPage()
    await userEvent.click(within(card('qst')).getByRole('button', { name: /supprimer/i }))
    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent(t('settings.tax.rates.confirmTitle'))
    expect(confirm.textContent?.replace(/\u00A0/g, ' ')).toContain('10 %')
    // Cancel is focused first: keeping the rate is the safe default.
    expect(within(confirm).getByRole('button', { name: t('common.cancel') })).toHaveFocus()
    await userEvent.click(within(confirm).getByRole('button', { name: t('settings.tax.rates.delete') }))
    await waitFor(() => expect(mocks.tax.deleteTaxRate).toHaveBeenCalledWith('q3'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.tax.rates.deleted'))
  })

  it('does not delete when the confirmation is cancelled', async () => {
    await renderPage()
    await userEvent.click(within(card('qst')).getByRole('button', { name: /supprimer/i }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.tax.deleteTaxRate).not.toHaveBeenCalled()
  })

  it('shows a refused delete in the confirmation, in the French of the database', async () => {
    mocks.tax.deleteTaxRate.mockRejectedValue({ code: 'P0001', message: 'Un taux déjà en vigueur ne peut pas être supprimé.' })
    await renderPage()
    await userEvent.click(within(card('qst')).getByRole('button', { name: /supprimer/i }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t('settings.tax.rates.delete') }))
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('Un taux déjà en vigueur ne peut pas être supprimé.')
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  describe('« Nouveau taux »', () => {
    it('opens on the rate field, and sends the fraction and the date unchanged on Enter', async () => {
      mocks.tax.addTaxRate.mockResolvedValue('new-id')
      await renderPage()
      const opened = await openAddDialog('qst')
      expect(within(opened).getByRole('heading', { name: t('settings.tax.dialog.title', { tax: 'TVQ' }) })).toBeInTheDocument()
      expect(rateField()).toHaveFocus()
      expect(dateField()).toHaveAttribute('type', 'date')
      expect(dateField()).toHaveAccessibleDescription(t('settings.tax.dialog.fromHelp'))
      setDate('2027-04-01')
      await userEvent.type(rateField(), '10{Enter}')
      await waitFor(() => expect(mocks.tax.addTaxRate).toHaveBeenCalledWith('qst', 0.1, '2027-04-01'))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.tax.dialog.added'))
    })

    it('reads a French decimal comma', async () => {
      mocks.tax.addTaxRate.mockResolvedValue('new-id')
      await renderPage()
      await openAddDialog('gst')
      await userEvent.type(rateField(), '5,5')
      setDate('2027-01-01')
      await userEvent.click(within(dialog()).getByRole('button', { name: t('settings.tax.dialog.submit') }))
      await waitFor(() => expect(mocks.tax.addTaxRate).toHaveBeenCalledWith('gst', 0.055, '2027-01-01'))
    })

    it('stays outline until something is typed', async () => {
      await renderPage()
      await openAddDialog('qst')
      const submit = within(dialog()).getByRole('button', { name: t('settings.tax.dialog.submit') })
      expect(submit).toHaveAttribute('aria-disabled', 'true')
      expect(submit.className).toContain('bg-card')
      await userEvent.type(rateField(), '1')
      expect(submit).not.toHaveAttribute('aria-disabled')
      expect(submit.className).toContain('bg-primary')
    })

    it.each([['abc'], ['100'], ['-1']])('refuses the rate « %s »', async (typed) => {
      await renderPage()
      await openAddDialog('qst')
      await userEvent.type(rateField(), typed)
      setDate('2027-01-01')
      await userEvent.click(within(dialog()).getByRole('button', { name: t('settings.tax.dialog.submit') }))
      expect(await within(dialog()).findByText(t('settings.tax.validation.rate'))).toBeInTheDocument()
      expect(rateField()).toHaveAttribute('aria-invalid', 'true')
      expect(mocks.tax.addTaxRate).not.toHaveBeenCalled()
    })

    it('requires the date', async () => {
      await renderPage()
      await openAddDialog('qst')
      await userEvent.type(rateField(), '10{Enter}')
      expect(await within(dialog()).findByText(t('settings.tax.validation.date'))).toBeInTheDocument()
      expect(mocks.tax.addTaxRate).not.toHaveBeenCalled()
    })

    it('warns before saving a date already past in the clinic, and not for today or later', async () => {
      await renderPage()
      await openAddDialog('qst')
      const warning = t('settings.tax.dialog.backdated')
      setDate('2026-10-07')
      expect(within(dialog()).queryByText(warning)).not.toBeInTheDocument()
      setDate('2026-10-06')
      expect(within(dialog()).getByText(warning)).toBeInTheDocument()
      setDate('2027-01-01')
      expect(within(dialog()).queryByText(warning)).not.toBeInTheDocument()
    })

    it('shows a refused rate (P0001) in the dialog and keeps it open', async () => {
      mocks.tax.addTaxRate.mockRejectedValue({ code: 'P0001', message: 'Le nouveau taux doit commencer après le 2027-01-01.' })
      await renderPage()
      await openAddDialog('qst')
      await userEvent.type(rateField(), '11')
      setDate('2026-12-01')
      await userEvent.click(within(dialog()).getByRole('button', { name: t('settings.tax.dialog.submit') }))
      expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Le nouveau taux doit commencer après le 2027-01-01.')
      expect(rateField()).toHaveValue('11')
      expect(mocks.toast.error).not.toHaveBeenCalled()
    })

    it('starts empty again once closed', async () => {
      await renderPage()
      await openAddDialog('qst')
      await userEvent.type(rateField(), '11')
      await userEvent.click(within(dialog()).getByRole('button', { name: t('common.cancel') }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await openAddDialog('qst')
      expect(rateField()).toHaveValue('')
    })
  })

  describe('read-only (settings.view without settings.manage)', () => {
    it('shows the notice once, the numbers read-only, the rates, and no button that changes them', async () => {
      await renderPage({ readOnly: true })
      expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
      expect(within(numbersCard()).getByRole('textbox', { name: t('settings.tax.fields.gst') })).toHaveAttribute('readonly')
      expect(rowsOf('qst')).toHaveLength(3)
      expect(screen.queryByRole('button', { name: t('settings.tax.rates.add') })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
      expect(within(card('qst')).getAllByRole('columnheader')).toHaveLength(4)
    })
  })

  it('shows a rates load error with a retry', async () => {
    mocks.organization.fetchOrganization.mockResolvedValue(testOrganization)
    mocks.tax.fetchTaxRates.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(RATES)
    renderOrganizationPage(<TaxSettingsPage />)
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(2)
    const [first] = alerts as [HTMLElement, HTMLElement]
    expect(first).toHaveTextContent(t('settings.tax.rates.loadError'))
    await userEvent.click(within(first).getByRole('button', { name: t('common.retry') }))
    expect(await screen.findAllByRole('table')).toHaveLength(2)
  })
})
