import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { clientsManifest } from '../../manifest'
import { RULES, SETTINGS, TEMPLATES, TYPES } from '../../test/consent-fixtures'
import { ConsentsSettingsPage } from './ConsentsSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchConsentTypes: vi.fn(),
    fetchConsentTemplates: vi.fn(),
    fetchConsentRules: vi.fn(),
    fetchConsentSettings: vi.fn(),
    saveConsentRule: vi.fn(),
    saveConsentSettings: vi.fn(),
    publishConsentVersion: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/consents', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.clients.consents.settings'

beforeEach(() => {
  mocks.api.fetchConsentTypes.mockResolvedValue(TYPES)
  mocks.api.fetchConsentTemplates.mockResolvedValue(TEMPLATES)
  mocks.api.fetchConsentRules.mockResolvedValue(RULES)
  mocks.api.fetchConsentSettings.mockResolvedValue(SETTINGS)
  mocks.api.saveConsentRule.mockResolvedValue('r1')
  mocks.api.saveConsentSettings.mockImplementation(async (patch: object) => ({ ...SETTINGS, ...patch }))
  mocks.api.publishConsentVersion.mockResolvedValue(3)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false }: { readOnly?: boolean } = {}) {
  const section = clientsManifest.settingsSections.find((s) => s.id === 'consents')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { modules: ['professionals', 'clients'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<ConsentsSettingsPage />, { readOnly, section, access: { access }, path: '/parametres/consentements' })}
    </QueryClientProvider>,
  )
}

describe('ConsentsSettingsPage', () => {
  it('lists each text per language: the version in force, or « Brouillon (pas encore publié) »; the placeholder cannot be published', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    expect(within(texts).getByText(/Version 1 publiée le .* · Brouillon de la version 2 prêt/)).toBeInTheDocument()
    expect(within(texts).getAllByText(/Brouillon \(pas encore publié\)/)).toHaveLength(3)
    // « Liste d'attente » in English is still the seeded placeholder: said, and no « Publier ».
    expect(within(texts).getByText(/^Anglais : Brouillon \(pas encore publié\) · Texte provisoire/)).toBeInTheDocument()
    expect(within(texts).getByText(t(`${S}.texts.editNote`))).toBeInTheDocument()
    expect(within(texts).getAllByRole('button', { name: t(`${S}.texts.publish`) })).toHaveLength(3)
  })

  it('the dialog opens on « nouveaux clients seulement » every time, never on a choice left from before', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    const publishFirst = () => userEvent.click(within(texts).getAllByRole('button', { name: t(`${S}.texts.publish`) })[0]!)
    await publishFirst()
    let dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.allActive`)) }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await publishFirst()
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.newClients`)) })).toBeChecked()
    expect(mocks.api.publishConsentVersion).not.toHaveBeenCalled()
  })

  it('« Publier » a new version: « Tous les clients actifs » flags the signed consents', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    await userEvent.click(within(texts).getAllByRole('button', { name: t(`${S}.texts.publish`) })[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.newClients`)) })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.allActive`)) }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${S}.texts.confirm`) }))
    await waitFor(() => expect(mocks.api.publishConsentVersion).toHaveBeenCalledExactlyOnceWith('vg2', 'all_active'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.texts.publishedFlagged`, { count: '3' }))
  })

  it('a first publication has nobody to flag: « nouveaux clients » only', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    await userEvent.click(within(texts).getAllByRole('button', { name: t(`${S}.texts.publish`) })[1]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.allActive`)) })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${S}.texts.confirm`) }))
    await waitFor(() => expect(mocks.api.publishConsentVersion).toHaveBeenCalledExactlyOnceWith('vge1', 'new_clients'))
  })

  it('a rule switches on only once its text is published', async () => {
    renderPage()
    const general = await screen.findByRole('switch', { name: t(`${S}.rules.toggle`, { name: 'Consentement général' }) })
    const waitlist = screen.getByRole('switch', { name: t(`${S}.rules.toggle`, { name: 'Liste d’attente' }) })
    expect(waitlist).toBeDisabled()
    expect(screen.getByText(/Situation : liste d’attente · Texte pas encore publié/)).toBeInTheDocument()
    await userEvent.click(general)
    await waitFor(() => expect(mocks.api.saveConsentRule).toHaveBeenCalledExactlyOnceWith({ ...RULES[0], isActive: true }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.rules.saved`))
  })

  it('saves the delays; a value out of bounds is refused before any call', async () => {
    renderPage()
    const reminder = await screen.findByRole('textbox', { name: new RegExp(`^${t(`${S}.delays.reminderDays`).replace(/[()]/g, '\\$&')}`) })
    const form = reminder.closest('form')!
    await userEvent.clear(reminder)
    await userEvent.type(reminder, '45')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    expect(await within(form).findByText(t(`${S}.delays.invalid`))).toBeInTheDocument()
    expect(mocks.api.saveConsentSettings).not.toHaveBeenCalled()
    await userEvent.clear(reminder)
    await userEvent.type(reminder, '10')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveConsentSettings).toHaveBeenCalledExactlyOnceWith({ ...SETTINGS, reminderDays: 10 }))
  })

  it('the retention policy is one line of 500 characters at most', async () => {
    renderPage()
    const retention = await screen.findByRole('textbox', { name: new RegExp(`^${t(`${S}.delays.retention`)}`) })
    await userEvent.type(retention, '  Dix   ans après la fin du suivi.  ')
    await userEvent.click(within(retention.closest('form')!).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveConsentSettings).toHaveBeenCalledExactlyOnceWith({ ...SETTINGS, retentionPolicy: 'Dix ans après la fin du suivi.' }),
    )
  })

  it('read-only: no « Publier », the switches and the frequencies read only (not disabled), no save', async () => {
    renderPage({ readOnly: true })
    await screen.findByRole('heading', { name: t(`${S}.texts.title`) })
    expect(screen.queryByRole('button', { name: t(`${S}.texts.publish`) })).not.toBeInTheDocument()
    const general = screen.getByRole('switch', { name: t(`${S}.rules.toggle`, { name: 'Consentement général' }) })
    expect(general).toHaveAttribute('aria-readonly', 'true')
    expect(general).toBeEnabled()
    await userEvent.click(general)
    expect(mocks.api.saveConsentRule).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: t(`${S}.rules.frequency`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })
})
