import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { DocumentTemplateSummary, TemplateVersion } from '@/core/signing/templates/api'
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
    fetchConsentClauses: vi.fn(),
    saveConsentClauses: vi.fn(),
  },
  templates: {
    listModuleTemplates: vi.fn(),
    fetchTemplateVersions: vi.fn(),
    updateTemplateVersion: vi.fn(),
    publishTemplateVersion: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/consents', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/core/signing/templates/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.templates }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.clients.consents.settings'
const ED = `${S}.editor`
/** The shared editor's own words (core, CC-12). */
const G = 'signing.templates.editor'

/** « Liste d'attente » in English, as core lists it: a draft, never published. */
const SUMMARY: DocumentTemplateSummary = {
  id: 'tw-en',
  key: 'clients.consent_waitlist_en',
  title: 'Waitlist (anglais)',
  description: null,
  isActive: true,
  canEdit: true,
  publishedVersion: null,
  publishedAt: null,
  draftVersionId: 'vwe1',
}

/** The seeded placeholder's shape (migration clients_consents): the provisional line, the clauses, the signature page. */
function placeholderVersion({ provisional = true } = {}): TemplateVersion {
  return {
    id: 'vwe1',
    version: 1,
    status: 'draft',
    body: {
      title: 'Waitlist',
      footer: { text: '{{clinic.name}} — Waitlist' },
      blocks: [
        ...(provisional ? [{ type: 'paragraph', runs: [{ text: 'Texte provisoire — Provisional text.', bold: true }] }] : []),
        { type: 'heading', level: 1, text: 'Waitlist' },
        { type: 'paragraph', runs: [{ text: '{{consent.clauses}}' }] },
        { type: 'signaturePage', signers: [{ role: 'client', label: '{{signer.full_name}}' }] },
      ],
    },
    variables: [
      { path: 'clinic.name', label: 'Nom de la clinique', sample: 'Clinique MANA', required: true, kind: 'text' },
      { path: 'signer.full_name', label: 'Nom de la personne qui signe', sample: 'Camille Exemple', required: true, kind: 'text' },
      { path: 'consent.clauses', label: 'Réponses aux clauses (Oui / Non)', sample: 'Oui', required: false, kind: 'text' },
    ],
    signers: [{ role: 'client', label: 'Client, ou parent ou tuteur', order: 1, required: true }],
    emailSubject: 'Waitlist — {{clinic.name}}',
    emailMessage: '',
    createdAt: '2026-10-12T12:00:00Z',
    updatedAt: '2026-10-12T12:00:00Z',
    publishedAt: null,
    archivedAt: null,
  }
}

beforeEach(() => {
  mocks.api.fetchConsentTypes.mockResolvedValue(TYPES)
  mocks.api.fetchConsentTemplates.mockResolvedValue(TEMPLATES)
  mocks.api.fetchConsentRules.mockResolvedValue(RULES)
  mocks.api.fetchConsentSettings.mockResolvedValue(SETTINGS)
  mocks.api.saveConsentRule.mockResolvedValue('r1')
  mocks.api.saveConsentSettings.mockImplementation(async (patch: object) => ({ ...SETTINGS, ...patch }))
  mocks.api.publishConsentVersion.mockResolvedValue(3)
  mocks.api.fetchConsentClauses.mockResolvedValue({
    clauses: [{ key: 'accord', kind: 'agree', text: 'Provisional clause: I agree.' }],
    editable: true,
  })
  mocks.api.saveConsentClauses.mockImplementation(async (_id: string, clauses: object) => clauses)
  mocks.templates.listModuleTemplates.mockResolvedValue([SUMMARY])
  mocks.templates.fetchTemplateVersions.mockResolvedValue([placeholderVersion()])
  mocks.templates.updateTemplateVersion.mockResolvedValue(undefined)
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
    await waitFor(() => expect(mocks.api.saveConsentSettings).toHaveBeenCalledExactlyOnceWith({ dueDays: 1, reminderDays: 10, preAppointmentHours: 48 }))
  })

  it('the retention policy is one line of 500 characters at most; no duration: nothing purged, no question', async () => {
    renderPage()
    const retention = await screen.findByRole('textbox', { name: new RegExp(`^${t(`${S}.retention.policy`)}`) })
    const form = retention.closest('form')!
    expect(within(form).getByText(t(`${S}.retention.kept`))).toBeInTheDocument()
    await userEvent.type(retention, '  Dix   ans après la fin du suivi.  ')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveConsentSettings).toHaveBeenCalledExactlyOnceWith({ retentionPolicy: 'Dix ans après la fin du suivi.', retentionYears: null }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a retention duration (1 to 50 years) is confirmed first: older sealed PDFs are purged for good (CC-18)', async () => {
    renderPage()
    const years = await screen.findByRole('textbox', { name: (name) => name.startsWith(t(`${S}.retention.years`)) })
    const form = years.closest('form')!
    await userEvent.type(years, '60')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    expect(await within(form).findByText(t(`${S}.retention.yearsInvalid`))).toBeInTheDocument()
    await userEvent.clear(years)
    await userEvent.type(years, '7')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    const dialog = await screen.findByRole('dialog', { name: t(`${S}.retention.confirmTitle`) })
    expect(within(dialog).getByText(t(`${S}.retention.confirmBody`, { years: '7' }))).toBeInTheDocument()
    expect(mocks.api.saveConsentSettings).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${S}.retention.confirm`) }))
    await waitFor(() => expect(mocks.api.saveConsentSettings).toHaveBeenCalledExactlyOnceWith({ retentionPolicy: null, retentionYears: 7 }))
  })

  it('« Modifier le texte » opens the text in the shared editor: the provisional line said, the answers\' table shown, no « Publier » there (CC-11, CC-12)', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    expect(within(texts).getAllByRole('button', { name: new RegExp(`^${t(`${S}.texts.editLabel`, { name: '' })}`) })).toHaveLength(4)
    await userEvent.click(within(texts).getByRole('button', { name: t(`${S}.texts.editLabel`, { name: 'Liste d’attente (anglais)' }) }))
    const editor = await screen.findByRole('region', { name: t(`${ED}.title`, { name: 'Liste d’attente (anglais)' }) })
    await waitFor(() => expect(within(editor).getByRole('heading', { name: t(`${ED}.title`, { name: 'Liste d’attente (anglais)' }) })).toHaveFocus())
    expect(mocks.templates.fetchTemplateVersions).toHaveBeenCalledWith('tw-en')
    expect(await within(editor).findByText(t(`${ED}.bannerNotice`, { banner: 'Texte provisoire' }))).toBeInTheDocument()
    expect(within(editor).getByText(t(`${ED}.clausesNote`))).toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: t(`${G}.publish`, { version: '1' }) })).not.toBeInTheDocument()
    // Never published: discarding the draft would leave nothing to copy.
    expect(within(editor).queryByRole('button', { name: t(`${G}.discard`, { version: '1' }) })).not.toBeInTheDocument()
    const frame = within(editor).getByTitle(t(`${G}.preview.frameTitle`))
    expect(frame.getAttribute('srcdoc')).toContain('accord requis')
  })

  it('saving the text replaces the provisional line and refreshes « Textes » (where « Publier » then shows)', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    await userEvent.click(within(texts).getByRole('button', { name: t(`${S}.texts.editLabel`, { name: 'Liste d’attente (anglais)' }) }))
    const editor = await screen.findByRole('region', { name: t(`${ED}.title`, { name: 'Liste d’attente (anglais)' }) })
    const body = await within(editor).findByRole('textbox', { name: new RegExp(`^${t(`${G}.form.body`)}`) })
    const markup = (body as HTMLTextAreaElement).value
    expect(markup).toContain('Texte provisoire')
    mocks.api.fetchConsentTemplates.mockClear()
    fireEvent.change(body, { target: { value: markup.replace(/^\*\*Texte provisoire[^\n]*\n\n/, '') } })
    expect(within(editor).queryByText(t(`${ED}.bannerNotice`, { banner: 'Texte provisoire' }))).not.toBeInTheDocument()
    await userEvent.click(within(editor).getByRole('button', { name: t(`${G}.save`) }))
    await waitFor(() => expect(mocks.templates.updateTemplateVersion).toHaveBeenCalledTimes(1))
    const [versionId, content] = mocks.templates.updateTemplateVersion.mock.calls[0]!
    expect(versionId).toBe('vwe1')
    expect(JSON.stringify(content)).not.toContain('Texte provisoire')
    expect(JSON.stringify(content)).toContain('{{consent.clauses}}')
    await waitFor(() => expect(mocks.api.fetchConsentTemplates).toHaveBeenCalled())
  })

  it('the draft\'s « Oui / Non » clauses: added, reworded, reordered, then saved (CC-13)', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    await userEvent.click(within(texts).getByRole('button', { name: t(`${S}.texts.editLabel`, { name: 'Liste d’attente (anglais)' }) }))
    const card = (await screen.findByRole('heading', { name: t(`${S}.clauses.title`) })).closest('form')!
    expect(mocks.api.fetchConsentClauses).toHaveBeenCalledWith('vwe1')
    const first = within(card).getByRole('textbox', { name: new RegExp(`^${t(`${S}.clauses.text`, { n: '1' })}`) })
    expect(first).toHaveValue('Provisional clause: I agree.')
    fireEvent.change(first, { target: { value: 'I have read this consent.' } })
    await userEvent.click(within(card).getByRole('button', { name: t(`${S}.clauses.add`) }))
    const second = within(card).getByRole('textbox', { name: new RegExp(`^${t(`${S}.clauses.text`, { n: '2' })}`) })
    fireEvent.change(second, { target: { value: 'Reminders by email?' } })
    await userEvent.click(within(card).getByRole('button', { name: t(`${S}.clauses.up`, { n: '2' })}))
    await userEvent.click(within(card).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveConsentClauses).toHaveBeenCalledExactlyOnceWith('vwe1', [
        { key: 'clause_2', kind: 'yes_no', text: 'Reminders by email?' },
        { key: 'accord', kind: 'agree', text: 'I have read this consent.' },
      ]),
    )
  })

  it('a clause without text is refused before any call', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    await userEvent.click(within(texts).getByRole('button', { name: t(`${S}.texts.editLabel`, { name: 'Liste d’attente (anglais)' }) }))
    const card = (await screen.findByRole('heading', { name: t(`${S}.clauses.title`) })).closest('form')!
    await userEvent.click(within(card).getByRole('button', { name: t(`${S}.clauses.add`) }))
    await userEvent.click(within(card).getByRole('button', { name: t('common.save') }))
    expect(await within(card).findByText(t(`${S}.clauses.emptyText`))).toBeInTheDocument()
    expect(mocks.api.saveConsentClauses).not.toHaveBeenCalled()
  })

  it('« Fermer le texte » closes the editor', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    await userEvent.click(within(texts).getByRole('button', { name: t(`${S}.texts.editLabel`, { name: 'Liste d’attente (anglais)' }) }))
    const editor = await screen.findByRole('region', { name: t(`${ED}.title`, { name: 'Liste d’attente (anglais)' }) })
    await userEvent.click(within(editor).getByRole('button', { name: t(`${ED}.close`) }))
    expect(screen.queryByRole('region', { name: t(`${ED}.title`, { name: 'Liste d’attente (anglais)' }) })).not.toBeInTheDocument()
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
    // The texts can still be read: « Voir le texte », in a read-only editor.
    await userEvent.click(screen.getByRole('button', { name: t(`${S}.texts.viewLabel`, { name: 'Liste d’attente (anglais)' }) }))
    const editor = await screen.findByRole('region', { name: t(`${ED}.title`, { name: 'Liste d’attente (anglais)' }) })
    expect(await within(editor).findByText(t(`${ED}.readOnlyHelp`))).toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: t(`${G}.save`) })).not.toBeInTheDocument()
  })
})
