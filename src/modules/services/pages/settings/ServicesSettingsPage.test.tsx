import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { servicesManifest } from '../../manifest'
import { PRICES, SIDS, servicesSettings } from '../../test/fixtures'
import { ServicesSettingsPage } from './ServicesSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchServicesSettings: vi.fn(),
    fetchServicePrices: vi.fn(),
    saveService: vi.fn(),
    setServiceTitles: vi.fn(),
    setServiceActive: vi.fn(),
    addRateVariant: vi.fn(),
    endRateVariant: vi.fn(),
    addBillingPolicy: vi.fn(),
    deleteBillingPolicy: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalogue')>()),
  ...mocks.api,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
const taxMocks = vi.hoisted(() => ({ taxRateOn: vi.fn() }))
vi.mock('@/core/settings/tax/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...taxMocks }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.services.settings'
const C = `${S}.catalogue`
const SH = `${S}.sheet`

beforeEach(() => {
  taxMocks.taxRateOn.mockImplementation(async (tax: string) => (tax === 'gst' ? 0.05 : 0.09975))
  mocks.api.fetchServicesSettings.mockResolvedValue(servicesSettings())
  mocks.api.fetchServicePrices.mockResolvedValue(PRICES)
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  const section = servicesManifest.settingsSections.find(
    (s) => s.id === 'services'
  )
  if (!section) throw new Error('no section')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const access = accessForRole(
    readOnly ? 'admin_assistant' : 'admin',
    readOnly ? { permissions: ['settings.view', 'services.view'] } : {}
  )
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<ServicesSettingsPage />, {
        readOnly,
        section,
        access: { access },
        path: `/parametres/${section.path}`,
      })}
    </QueryClientProvider>
  )
  await screen.findByRole('table', { name: t(`${C}.table`) })
}

const catalogue = () => screen.getByRole('table', { name: t(`${C}.table`) })
const rowOf = (name: string) =>
  within(catalogue())
    .getByRole('rowheader', { name: new RegExp(name) })
    .closest('tr') as HTMLElement

describe('ServicesSettingsPage', () => {
  it('shows the catalogue by family, with the duration and pause, the price source and the taxes', async () => {
    await renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: t(`${S}.title`) })
    ).toBeInTheDocument()
    expect(within(catalogue()).getByText('10 · Individuel')).toBeInTheDocument()
    expect(
      within(catalogue()).getByText('50 · Administratif')
    ).toBeInTheDocument()
    const session = within(rowOf('Consultation individuelle 50 min'))
    // In its column, and under the name on a phone (one shows at a time).
    expect(session.getAllByText('50 min + 10 min de pause')).toHaveLength(2)
    expect(rowOf('Consultation individuelle 50 min')).toHaveTextContent(
      'Grille, 50 minNon taxable'
    )
    expect(session.getByText('Psychologue, Sexologue')).toBeInTheDocument()
    expect(rowOf('Ouverture de dossier')).toHaveTextContent('37,83 $')
    // An archived service is under « Archivés » only.
    expect(screen.queryByText('Ancien service')).not.toBeInTheDocument()
  })

  it('shows the grid prices per profession today, the student rate, « À confirmer » and the gap with GOrendezvous', async () => {
    await renderPage()
    const prices = await screen.findByRole('table', {
      name: t(`${S}.prices.table`),
    })
    const psychologue = within(
      within(prices)
        .getByRole('cell', { name: 'Psychologue' })
        .closest('tr') as HTMLElement
    )
    expect(psychologue.getByText(/^175,00/)).toHaveTextContent(
      '175,00 $Étudiant 120,00 $'
    )
    const sexologue = within(
      within(prices)
        .getByRole('cell', { name: 'Sexologue' })
        .closest('tr') as HTMLElement
    )
    expect(sexologue.getByText(t(`${S}.prices.toConfirm`))).toBeInTheDocument()
    const gaps = screen.getByRole('table', {
      name: t(`${S}.prices.gaps.title`),
    })
    expect(within(gaps).getAllByRole('row')).toHaveLength(2)
    expect(within(gaps).getAllByRole('row')[1]).toHaveTextContent(
      /^Sexologue.*Aucune grille150,00 \$$/
    )
    expect(mocks.api.fetchServicePrices).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    )
  })

  it('read-only: the notice, and no add, edit or archive action', async () => {
    await renderPage({ readOnly: true })
    expect(
      screen.getByText(t('common.readOnlyNotice.title'))
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t(`${C}.add`) })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: t(`${C}.menu`, { name: 'Consultation individuelle 50 min' }),
      })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t(`${S}.variants.add`) })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t(`${S}.policy.add`) })
    ).not.toBeInTheDocument()
  })

  it('adds a service through the sheet: save_service, then its titles', async () => {
    const user = userEvent.setup()
    mocks.api.saveService.mockResolvedValue('new-id')
    mocks.api.setServiceTitles.mockResolvedValue(undefined)
    await renderPage()
    await user.click(screen.getByRole('button', { name: t(`${C}.add`) }))
    const sheet = await screen.findByRole('dialog', {
      name: t(`${SH}.createTitle`),
    })
    const inSheet = within(sheet)
    await user.type(
      inSheet.getByLabelText(new RegExp(`^${t(`${SH}.fields.code`)}`)),
      '10160'
    )
    await user.type(
      inSheet.getByLabelText(new RegExp(`^${t(`${SH}.fields.key`)}`)),
      'consultation_60'
    )
    await user.type(
      inSheet.getByLabelText(new RegExp(`^${t(`${SH}.fields.name`)}`)),
      'Consultation 60 min'
    )
    await user.click(inSheet.getByLabelText('Psychologue'))
    await user.click(inSheet.getByRole('button', { name: t(`${SH}.create`) }))
    await waitFor(() =>
      expect(mocks.api.setServiceTitles).toHaveBeenCalledWith('new-id', [
        SIDS.psychologue,
      ])
    )
    expect(mocks.api.saveService).toHaveBeenCalledWith(
      expect.objectContaining({
        id: null,
        familyId: SIDS.familyIndividual,
        code: 10160,
        key: 'consultation_60',
        name: 'Consultation 60 min',
        priceSource: 'grid',
        gridDuration: 50,
      })
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.created`))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('refuses a code outside its family before saving, under the field', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: t(`${C}.add`) }))
    const sheet = within(
      await screen.findByRole('dialog', { name: t(`${SH}.createTitle`) })
    )
    await user.type(
      sheet.getByLabelText(new RegExp(`^${t(`${SH}.fields.code`)}`)),
      '20160'
    )
    await user.type(
      sheet.getByLabelText(new RegExp(`^${t(`${SH}.fields.key`)}`)),
      'x'
    )
    await user.type(
      sheet.getByLabelText(new RegExp(`^${t(`${SH}.fields.name`)}`)),
      'X'
    )
    await user.click(sheet.getByRole('button', { name: t(`${SH}.create`) }))
    expect(
      await sheet.findByText(
        t('modules.services.validation.codeFamily', {
          from: '10 000',
          to: '10 999',
        })
      )
    ).toBeInTheDocument()
    expect(mocks.api.saveService).not.toHaveBeenCalled()
  })

  it('archives a service from its row', async () => {
    const user = userEvent.setup()
    mocks.api.setServiceActive.mockResolvedValue(undefined)
    await renderPage()
    await user.click(
      screen.getByRole('button', {
        name: t(`${C}.menu`, { name: "Inscription liste d'attente" }),
      })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: t(`${C}.archive`) })
    )
    await waitFor(() =>
      expect(mocks.api.setServiceActive).toHaveBeenCalledWith(
        SIDS.waitlist,
        false
      )
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.archivedToast`))
  })

  it('« Trier par »: one list by name, without the family rows (L27)', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: t(`${C}.sortLabel`) }), 'name')
    const names = within(catalogue())
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent ?? '')
    expect(names[0]).toMatch(/^Consultation individuelle 50 min/)
    expect(names[1]).toMatch(/^Inscription liste d'attente/)
    expect(names[2]).toMatch(/^Ouverture de dossier/)
    expect(within(catalogue()).queryByText('10 · Individuel')).not.toBeInTheDocument()
  })

  it('the search reads the description too, and shows it under the name (L27)', async () => {
    const user = userEvent.setup()
    const settings = servicesSettings()
    mocks.api.fetchServicesSettings.mockResolvedValue({
      ...settings,
      services: settings.services.map((s) => (s.id === SIDS.waitlist ? { ...s, description: 'Frais pour rester inscrit' } : s)),
    })
    await renderPage()
    await user.type(screen.getByRole('searchbox', { name: t(`${C}.searchLabel`) }), 'rester')
    expect(rowOf("Inscription liste d'attente")).toHaveTextContent('Frais pour rester inscrit')
    expect(within(catalogue()).queryByRole('rowheader', { name: /Consultation individuelle/ })).not.toBeInTheDocument()
  })

  it('« Prix »: a taxable price shows its amount with the taxes in force today (L27)', async () => {
    mocks.api.fetchServicePrices.mockResolvedValue(PRICES.map((p) => (p.serviceId === SIDS.session50 && p.titleId === SIDS.psychologue ? { ...p, taxRule: 'taxable' } : p)))
    await renderPage()
    const prices = await screen.findByRole('table', { name: t(`${S}.prices.table`) })
    // 175,00 $ + 8,75 $ (TPS 5 %) + 17,46 $ (TVQ 9,975 %), each tax rounded on its own.
    expect(await within(prices).findByText(/^Avec taxes : 201,21/)).toBeInTheDocument()
    expect(taxMocks.taxRateOn).toHaveBeenCalledWith('gst', expect.any(String))
  })
})
