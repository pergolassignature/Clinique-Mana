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
    fetchConsentCampaigns: vi.fn(),
    startConsentCampaign: vi.fn(),
    cancelConsentCampaign: vi.fn(),
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

/** The four texts as core lists them (CC-12): each one editable. */
const summary = (id: string, key: string, title: string, draftVersionId: string | null, published: number | null): DocumentTemplateSummary => ({
  id,
  key,
  title,
  description: null,
  isActive: true,
  canEdit: true,
  publishedVersion: published,
  publishedAt: published ? '2026-10-01T14:00:00Z' : null,
  draftVersionId,
})
const SUMMARIES = [
  summary('tg-fr', 'clients.consent_general_fr', 'Consentement général', 'vg2', 1),
  summary('tg-en', 'clients.consent_general_en', 'General consent', 'vge1', null),
  summary('tw-fr', 'clients.consent_waitlist_fr', 'Liste d’attente', 'vw1', null),
  summary('tw-en', 'clients.consent_waitlist_en', 'Waitlist (anglais)', 'vwe1', null),
]

/** A version of a consent text: its words, the clauses' line, the signature page (the seeded shape, migration clients_consents). */
function versionOf({
  id,
  version = 1,
  status = 'draft',
  lines = ['Texte provisoire — Provisional text.'],
}: {
  id: string
  version?: number
  status?: TemplateVersion['status']
  lines?: string[]
}): TemplateVersion {
  return {
    id,
    version,
    status,
    body: {
      title: 'Consentement',
      footer: { text: '{{clinic.name}} — Consentement' },
      blocks: [
        ...lines.map((text) => ({ type: 'paragraph', runs: [{ text, bold: text.startsWith('Texte provisoire') }] })),
        { type: 'heading', level: 1, text: 'Consentement' },
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
    emailSubject: 'Consentement — {{clinic.name}}',
    emailMessage: '',
    createdAt: '2026-10-12T12:00:00Z',
    updatedAt: '2026-10-12T12:00:00Z',
    publishedAt: status === 'published' ? '2026-10-01T14:00:00Z' : null,
    archivedAt: null,
  }
}
const VERSIONS: Record<string, TemplateVersion[]> = {
  'tg-fr': [
    versionOf({ id: 'vg2', version: 2, lines: ['Le nouveau texte validé.'] }),
    versionOf({ id: 'vg1', version: 1, status: 'published', lines: ['L’ancien texte.'] }),
  ],
  'tg-en': [versionOf({ id: 'vge1', lines: ['The general consent.'] })],
  'tw-fr': [versionOf({ id: 'vw1', lines: ['La liste d’attente.'] })],
  'tw-en': [versionOf({ id: 'vwe1' })],
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
  mocks.api.fetchConsentCampaigns.mockResolvedValue([])
  mocks.api.startConsentCampaign.mockResolvedValue(340)
  mocks.api.cancelConsentCampaign.mockResolvedValue(undefined)
  mocks.templates.listModuleTemplates.mockResolvedValue(SUMMARIES)
  mocks.templates.fetchTemplateVersions.mockImplementation(async (id: string) => VERSIONS[id] ?? [])
  mocks.templates.updateTemplateVersion.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false, path = '/parametres/consentements' }: { readOnly?: boolean; path?: string } = {}) {
  const section = clientsManifest.settingsSections.find((s) => s.id === 'consents')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { modules: ['professionals', 'clients'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<ConsentsSettingsPage />, { readOnly, section, access: { access }, path })}
    </QueryClientProvider>,
  )
}

describe('ConsentsSettingsPage', () => {
  it('one row per consent: when it is asked, the French and English states as chips, one « Modifier »; one banner for the provisional texts (CC-21)', async () => {
    renderPage()
    const texts = (await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).closest('section')!
    expect(within(texts).getAllByRole('button', { name: new RegExp(`^${t(`${S}.texts.edit`)} «`) })).toHaveLength(3)
    const general = within(texts).getByText('Consentement général').closest('li')!
    expect(within(general).getByText(t(`${S}.overview.purpose.off`, { triggers: 'Tous les clients' }))).toBeInTheDocument()
    expect(within(general).getByText(/^Publié · version 1 · le /)).toBeInTheDocument()
    expect(within(general).getByText(t(`${S}.overview.chips.changed`))).toBeInTheDocument()
    expect(within(general).getByText(t(`${S}.overview.chips.draft`))).toBeInTheDocument()
    const waitlist = within(texts).getByText('Liste d’attente').closest('li')!
    expect(within(waitlist).getByText(t(`${S}.overview.chips.placeholder`))).toBeInTheDocument()
    // The provisional texts said once, above, by name.
    expect(screen.getByText(t(`${S}.overview.placeholderTitle`, { count: '1' }))).toBeInTheDocument()
    expect(screen.getByText(t(`${S}.overview.placeholderBody`, { names: 'Liste d’attente' }))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Publier/ })).not.toBeInTheDocument()
  })

  it('« Modifier » opens the consent\'s page: its name focused, French and English as tabs; « Tous les consentements » goes back', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${S}.texts.editLabel`, { name: 'Consentement général' }) }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Consentement général' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('tab', { name: t(`${S}.texts.french`) })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: t(`${S}.texts.english`) })).toBeInTheDocument()
    expect(mocks.templates.fetchTemplateVersions).toHaveBeenCalledWith('tg-fr')
    await user.click(screen.getByRole('button', { name: t(`${S}.editorPage.back`) }))
    expect(await screen.findByRole('heading', { name: t(`${S}.texts.title`) })).toBeInTheDocument()
  })

  it('« Publier la version 2 »: said before it happens, « nouveaux clients seulement » by default; « Tous les clients actifs » flags the signed consents', async () => {
    const user = userEvent.setup()
    renderPage({ path: '/parametres/consentements?texte=general' })
    await user.click(await screen.findByRole('button', { name: t(`${G}.publish`, { version: '2' }) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${S}.texts.publishTitle`, { version: '2', name: 'Consentement général', language: 'français' }) })
    expect(within(dialog).getByText(t(`${S}.texts.publishHelp`))).toBeInTheDocument()
    expect(within(dialog).getByText(t(`${S}.texts.testersNote`))).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.newClients`)) })).toBeChecked()
    expect(within(dialog).queryByText(t(`${S}.texts.campaignNote`))).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: new RegExp(t(`${S}.texts.allActive`)) }))
    expect(within(dialog).getByText(t(`${S}.texts.campaignNote`))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t(`${S}.texts.confirm`, { version: '2' }) }))
    await waitFor(() => expect(mocks.api.publishConsentVersion).toHaveBeenCalledExactlyOnceWith('vg2', 'all_active'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.texts.publishedFlagged`, { count: '3' }))
  })

  it('a first publication has nobody to ask again: no choice, « nouveaux clients » only', async () => {
    const user = userEvent.setup()
    renderPage({ path: '/parametres/consentements?texte=general' })
    await user.click(await screen.findByRole('tab', { name: t(`${S}.texts.english`) }))
    await user.click(await screen.findByRole('button', { name: t(`${G}.publish`, { version: '1' }) }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(t(`${S}.texts.publishFirst`))).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t(`${S}.texts.confirm`, { version: '1' }) }))
    await waitFor(() => expect(mocks.api.publishConsentVersion).toHaveBeenCalledExactlyOnceWith('vge1', 'new_clients'))
  })

  it('« Comparer avec la version publiée »: the lines removed and added', async () => {
    const user = userEvent.setup()
    renderPage({ path: '/parametres/consentements?texte=general' })
    await user.click(await screen.findByRole('button', { name: t(`${G}.focused.compare`, { version: '1' }) }))
    const diff = screen.getByRole('list', { name: t(`${G}.focused.compareTitle`) })
    expect(within(diff).getByText('L’ancien texte.').closest('li')).toHaveTextContent(`${t(`${G}.focused.removed`)}`)
    expect(within(diff).getByText('Le nouveau texte validé.').closest('li')).toHaveTextContent(`${t(`${G}.focused.added`)}`)
    await user.click(screen.getByRole('button', { name: t(`${G}.focused.compareHide`) }))
    expect(screen.queryByRole('list', { name: t(`${G}.focused.compareTitle`) })).not.toBeInTheDocument()
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

  it('the provisional English text: said once, « Publier » waits; the client\'s view shows its questions, the document its answers\' table (CC-11, CC-21)', async () => {
    const user = userEvent.setup()
    renderPage({ path: '/parametres/consentements?texte=waitlist' })
    await user.click(await screen.findByRole('tab', { name: t(`${S}.texts.english`) }))
    // Said once on screen (the button's description repeats it for a screen reader).
    const said = await screen.findAllByText(t(`${ED}.bannerNotice`, { banner: 'Texte provisoire' }))
    expect(said.filter((el) => !el.classList.contains('sr-only'))).toHaveLength(1)
    const publish = screen.getByRole('button', { name: t(`${G}.publish`, { version: '1' }) })
    expect(publish).toHaveAttribute('aria-disabled', 'true')
    expect(publish).toHaveAccessibleDescription(t(`${ED}.bannerNotice`, { banner: 'Texte provisoire' }))
    // Never published: discarding the draft would leave nothing to copy.
    expect(screen.queryByRole('button', { name: t(`${G}.discard`, { version: '1' }) })).not.toBeInTheDocument()
    const view = screen.getByRole('heading', { name: t(`${ED}.clientView.title`) }).closest('section')!
    expect(await within(view).findByRole('radiogroup', { name: /Provisional clause: I agree\./ })).toBeInTheDocument()
    expect(within(view).getByTitle(t(`${ED}.clientView.frameTitle`)).getAttribute('srcdoc')).toContain('Provisional clause: I agree.')
  })

  it('the text autosaves (no toast), keeps what is typed, and refreshes the overview; the provisional line gone, « Publier » is offered', async () => {
    renderPage({ path: '/parametres/consentements?texte=waitlist' })
    await userEvent.click(await screen.findByRole('tab', { name: t(`${S}.texts.english`) }))
    const body = (await screen.findByRole('textbox', { name: new RegExp(`^${t(`${G}.form.body`)}`) })) as HTMLTextAreaElement
    expect(body.value).toContain('Texte provisoire')
    mocks.api.fetchConsentTemplates.mockClear()
    const next = body.value.replace(/^\*\*Texte provisoire[^\n]*\n\n/, 'The approved text.\n\n')
    fireEvent.change(body, { target: { value: next } })
    expect(screen.queryByText(t(`${ED}.bannerNotice`, { banner: 'Texte provisoire' }))).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.templates.updateTemplateVersion).toHaveBeenCalledTimes(1), { timeout: 4000 })
    const [versionId, content] = mocks.templates.updateTemplateVersion.mock.calls[0]!
    expect(versionId).toBe('vwe1')
    expect(JSON.stringify(content)).not.toContain('Texte provisoire')
    expect(JSON.stringify(content)).toContain('{{consent.clauses}}')
    expect(await screen.findByText(/^Brouillon enregistré à /)).toBeInTheDocument()
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(body.value).toBe(next)
    await waitFor(() => expect(mocks.api.fetchConsentTemplates).toHaveBeenCalled())
  })

  it('a text pasted from Word keeps its paragraphs, bold and lists', async () => {
    renderPage({ path: '/parametres/consentements?texte=waitlist' })
    const body = (await screen.findByRole('textbox', { name: new RegExp(`^${t(`${G}.form.body`)}`) })) as HTMLTextAreaElement
    body.setSelectionRange(0, 0)
    const html = "<p class=MsoNormal><b>Objet</b> du consentement</p><p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·</span>Le suivi</p>"
    fireEvent.paste(body, { clipboardData: { getData: (type: string) => (type === 'text/html' ? html : 'Objet du consentement Le suivi') } })
    expect(body.value.startsWith('**Objet** du consentement\n\n- Le suivi\n\n')).toBe(true)
  })

  it('the draft\'s « Oui / Non » questions under the text: added, reworded, reordered, then saved; unsaved, they hold « Publier » (CC-13)', async () => {
    renderPage({ path: '/parametres/consentements?texte=general' })
    const card = (await screen.findByRole('heading', { name: t(`${S}.clauses.title`) })).closest('form')!
    await waitFor(() => expect(mocks.api.fetchConsentClauses).toHaveBeenCalledWith('vg2'))
    const first = await within(card).findByRole('textbox', { name: new RegExp(`^${t(`${S}.clauses.text`, { n: '1' })}`) })
    expect(first).toHaveValue('Provisional clause: I agree.')
    fireEvent.change(first, { target: { value: 'I have read this consent.' } })
    expect(await screen.findByText(t(`${ED}.clausesUnsaved`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${G}.publish`, { version: '2' }) })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(within(card).getByRole('button', { name: t(`${S}.clauses.add`) }))
    const second = within(card).getByRole('textbox', { name: new RegExp(`^${t(`${S}.clauses.text`, { n: '2' })}`) })
    fireEvent.change(second, { target: { value: 'Reminders by email?' } })
    await userEvent.click(within(card).getByRole('button', { name: t(`${S}.clauses.up`, { n: '2' }) }))
    await userEvent.click(within(card).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveConsentClauses).toHaveBeenCalledExactlyOnceWith('vg2', [
        { key: 'clause_2', kind: 'yes_no', text: 'Reminders by email?' },
        { key: 'accord', kind: 'agree', text: 'I have read this consent.' },
      ]),
    )
  })

  it('a clause without text is refused before any call', async () => {
    renderPage({ path: '/parametres/consentements?texte=general' })
    const card = (await screen.findByRole('heading', { name: t(`${S}.clauses.title`) })).closest('form')!
    await userEvent.click(await within(card).findByRole('button', { name: t(`${S}.clauses.add`) }))
    await userEvent.click(within(card).getByRole('button', { name: t('common.save') }))
    expect(await within(card).findByText(t(`${S}.clauses.emptyText`))).toBeInTheDocument()
    expect(mocks.api.saveConsentClauses).not.toHaveBeenCalled()
  })

  it('read-only: « Voir », no « Publier », no save; the switches and the frequencies read only (not disabled)', async () => {
    const user = userEvent.setup()
    renderPage({ readOnly: true })
    await screen.findByRole('heading', { name: t(`${S}.texts.title`) })
    const general = screen.getByRole('switch', { name: t(`${S}.rules.toggle`, { name: 'Consentement général' }) })
    expect(general).toHaveAttribute('aria-readonly', 'true')
    expect(general).toBeEnabled()
    await user.click(general)
    expect(mocks.api.saveConsentRule).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: t(`${S}.rules.frequency`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    // The texts can still be read: « Voir », in a read-only editor.
    await user.click(screen.getByRole('button', { name: t(`${S}.texts.viewLabel`, { name: 'Liste d’attente' }) }))
    await screen.findByRole('heading', { level: 1, name: 'Liste d’attente' })
    await screen.findByRole('textbox', { name: new RegExp(`^${t(`${G}.form.body`)}`) })
    expect(screen.queryByRole('button', { name: t(`${G}.save`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Publier/ })).not.toBeInTheDocument()
  })

  it('« Nouvelles signatures » (C5b.4): a published consent offers the campaign, confirmed first; one running says its counts and « Arrêter »', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = (await screen.findByRole('heading', { name: t(`${S}.campaigns.title`) })).closest('section')!
    // « Liste d'attente » has no published text: not listed at all.
    await within(card).findByText('Consentement général')
    expect(within(card).queryByText('Liste d’attente')).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: t(`${S}.campaigns.startLabel`, { name: 'Consentement général' }) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${S}.campaigns.confirmTitle`, { name: 'Consentement général' }) })
    expect(mocks.api.startConsentCampaign).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: t(`${S}.campaigns.confirm`) }))
    await waitFor(() => expect(mocks.api.startConsentCampaign).toHaveBeenCalledExactlyOnceWith('general'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.campaigns.started`, { count: '340' }))
  })

  it('… a campaign running: its counts and « Arrêter la campagne »; a refusal is shown in the dialog', async () => {
    const user = userEvent.setup()
    mocks.api.fetchConsentCampaigns.mockResolvedValue([
      { id: 'k1', consentKey: 'general', state: 'running', total: 340, createdAt: '2026-10-13T14:00:00Z', finishedAt: null, queued: 240, sent: 98, failed: 2, skipped: 0 },
    ])
    renderPage()
    const card = (await screen.findByRole('heading', { name: t(`${S}.campaigns.title`) })).closest('section')!
    expect(await within(card).findByText(t(`${S}.campaigns.running`, { sent: '98', total: '340', queued: '240', failed: '2' }))).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: t(`${S}.campaigns.stop`) }))
    await waitFor(() => expect(mocks.api.cancelConsentCampaign).toHaveBeenCalledWith('k1'))
  })
})
