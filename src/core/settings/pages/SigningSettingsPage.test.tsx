import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FileSignature } from 'lucide-react'
import { t } from '@/i18n'
import type { SettingsSection } from '@/core/modules/types'
import type { DocumentTemplate, SignatureRequestRow } from '@/core/signing/api'
import { FunctionCallError } from '@/core/supabase/functions'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { lazyPage } from '@/shared/lib/lazy-page'
import { testAccess } from '@/test/contexts'
import { renderInSettingsSection } from '@/test/settings-section'
import { SigningSettingsPage } from './SigningSettingsPage'

const mocks = vi.hoisted(() => ({
  signing: {
    fetchSigningSettings: vi.fn(),
    setSigningSettings: vi.fn(),
    lastDocumensoEventAt: vi.fn(),
    lastSigningTest: vi.fn(),
    listDocumentTemplates: vi.fn(),
    testSigningConnection: vi.fn(),
    sendSigningTestDocument: vi.fn(),
    syncSignatureRequest: vi.fn(),
    webhookUrl: (orgId: string) => `http://127.0.0.1:55321/functions/v1/signing-webhook?org=${orgId}`,
  },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/signing/api', () => mocks.signing)
vi.mock('@/core/settings/secrets/api', () => mocks.secrets)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.resetAllMocks())

const section: SettingsSection = {
  id: 'signing',
  path: 'signature-electronique',
  labelKey: 'settings.sections.signing',
  icon: FileSignature,
  permission: 'settings.view',
  editPermission: 'settings.integrations_manage',
  group: 'plateforme',
  component: lazyPage(async () => ({ default: () => null })),
}

const ADMIN = ['settings.view', 'settings.manage', 'settings.email_manage', 'settings.integrations_manage']
const ASSISTANT = ['settings.view']

const TEST_REQUEST: SignatureRequestRow = {
  id: 'a0000000-0000-0000-0000-000000000001',
  status: 'signed',
  last_error: null,
  created_at: '2026-10-08T12:00:00Z',
  sent_at: '2026-10-08T12:00:05Z',
}

const TEMPLATE: DocumentTemplate = {
  id: 'b0000000-0000-0000-0000-000000000001',
  key: 'professionals.contract',
  module_key: 'professionals',
  title: 'Contrat de service',
  description: 'Le contrat signé par chaque professionnel.',
  is_active: true,
  published_version: 3,
  published_at: '2026-10-08T12:00:00Z',
  draft_version_id: 'c0000000-0000-0000-0000-000000000001',
}

function renderPage(
  permissions: string[],
  {
    settings = { base_url: 'https://sign.cliniquemana.com', expiry_days: 7 } as { base_url: string | null; expiry_days: number },
    lastEvent = '2026-10-08T12:00:00Z' as string | null,
    lastTest = null as SignatureRequestRow | null | Promise<never>,
    templates = [TEMPLATE] as DocumentTemplate[],
    secretKeys = [{ key: 'documenso_api_key', updated_at: '2026-10-08T12:00:00Z' }] as { key: string; updated_at: string }[],
  } = {},
) {
  mocks.signing.fetchSigningSettings.mockResolvedValue(settings)
  mocks.signing.lastDocumensoEventAt.mockResolvedValue(lastEvent)
  if (lastTest instanceof Promise) mocks.signing.lastSigningTest.mockReturnValue(lastTest)
  else mocks.signing.lastSigningTest.mockResolvedValue(lastTest)
  mocks.signing.listDocumentTemplates.mockResolvedValue(templates)
  mocks.secrets.listOrgSecretKeys.mockResolvedValue(secretKeys)
  const readOnly = !permissions.includes('settings.integrations_manage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(
        <UnsavedChangesProvider>
          <SigningSettingsPage />
        </UnsavedChangesProvider>,
        { readOnly, section, access: { access: { ...testAccess, permissions } } },
      )}
    </QueryClientProvider>,
  )
}

const card = (title: string) => screen.getByRole('region', { name: title })
const connection = () => card(t('settings.signing.connection.title'))
const webhook = () => card(t('settings.signing.webhook.title'))
const sending = () => card(t('settings.signing.send.title'))
/** Testing Library compares normalised text (a no-break space before « : » becomes a space): so must the expectation. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ')
/** A field by its label, whatever follows it (the required marker). */
const labelled = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const baseUrl = () => within(connection()).findByLabelText(labelled(t('settings.signing.connection.baseUrl')))
/** The text of the field's help and error (`aria-describedby`). */
const description = (field: HTMLElement) =>
  (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim()
const expiry = () => within(sending()).findByLabelText(labelled(t('settings.signing.send.expiry')))

describe('SigningSettingsPage', () => {
  it('starts the settings, secret keys, last event and last test reads together (no waterfall)', () => {
    mocks.signing.fetchSigningSettings.mockReturnValue(new Promise(() => {}))
    mocks.secrets.listOrgSecretKeys.mockReturnValue(new Promise(() => {}))
    mocks.signing.lastDocumensoEventAt.mockReturnValue(new Promise(() => {}))
    mocks.signing.lastSigningTest.mockReturnValue(new Promise(() => {}))
    render(
      <QueryClientProvider client={new QueryClient()}>
        {renderInSettingsSection(<SigningSettingsPage />, { section, access: { access: { ...testAccess, permissions: ADMIN } } })}
      </QueryClientProvider>,
    )
    expect(mocks.signing.fetchSigningSettings).toHaveBeenCalledTimes(1)
    expect(mocks.secrets.listOrgSecretKeys).toHaveBeenCalledTimes(1)
    expect(mocks.signing.lastDocumensoEventAt).toHaveBeenCalledTimes(1)
    expect(mocks.signing.lastSigningTest).toHaveBeenCalledExactlyOnceWith(testAccess.user_id)
    // The templates load only when their tab opens.
    expect(mocks.signing.listDocumentTemplates).not.toHaveBeenCalled()
  })

  describe('admin (settings.integrations_manage): editable', () => {
    it('shows the three cards with editable fields, the keys to replace or add, and no notice', async () => {
      renderPage(ADMIN)
      expect(await baseUrl()).toHaveValue('https://sign.cliniquemana.com')
      expect(await baseUrl()).not.toHaveAttribute('readonly')
      expect(await expiry()).toHaveValue('7')
      expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
      expect(
        await within(connection()).findByRole('button', { name: t('settings.secrets.replace', { label: t('settings.signing.connection.apiKey') }) }),
      ).toBeInTheDocument()
      expect(within(webhook()).getByRole('button', { name: t('settings.secrets.add', { label: t('settings.signing.webhook.secret') }) })).toBeInTheDocument()
      expect(within(connection()).getByRole('button', { name: t('settings.signing.connection.test') })).toBeInTheDocument()
      expect(within(sending()).getByRole('button', { name: t('settings.signing.send.testDocument') })).toBeInTheDocument()
    })

    it('saves the instance address alone, normalised (the expiry is not sent: no lost update)', async () => {
      const user = userEvent.setup()
      mocks.signing.setSigningSettings.mockResolvedValue({ api_key_cleared: false })
      renderPage(ADMIN)
      const field = await baseUrl()
      await user.clear(field)
      await user.type(field, 'HTTPS://Sign.CliniqueMana.com/')
      await user.click(within(connection()).getByRole('button', { name: t('common.save') }))
      await waitFor(() => expect(mocks.signing.setSigningSettings).toHaveBeenCalledExactlyOnceWith({ base_url: 'https://sign.cliniquemana.com' }))
      expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.signing.connection.saved'))
    })

    it('warns, while the address changes, that saving it clears the stored API key; then says so and reads the key again', async () => {
      const user = userEvent.setup()
      mocks.signing.setSigningSettings.mockResolvedValue({ api_key_cleared: true })
      renderPage(ADMIN)
      const field = await baseUrl()
      const warning = plain(t('settings.signing.connection.keyClearedWarning'))
      await within(connection()).findByRole('button', { name: t('settings.secrets.replace', { label: t('settings.signing.connection.apiKey') }) })
      expect(description(field)).toBe(t('settings.signing.connection.baseUrlHelp'))
      await user.clear(field)
      await user.type(field, 'https://autre.cliniquemana.com')
      expect(plain(description(field))).toContain(warning)
      expect(mocks.secrets.listOrgSecretKeys).toHaveBeenCalledTimes(1)
      mocks.secrets.listOrgSecretKeys.mockResolvedValue([])
      await user.click(within(connection()).getByRole('button', { name: t('common.save') }))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.signing.connection.savedKeyCleared')))
      expect(mocks.secrets.listOrgSecretKeys).toHaveBeenCalledTimes(2)
      expect(
        await within(connection()).findByRole('button', { name: t('settings.secrets.add', { label: t('settings.signing.connection.apiKey') }) }),
      ).toBeInTheDocument()
    })

    it('does not warn about the key when none is stored', async () => {
      const user = userEvent.setup()
      renderPage(ADMIN, { secretKeys: [] })
      const field = await baseUrl()
      await within(connection()).findByRole('button', { name: t('settings.secrets.add', { label: t('settings.signing.connection.apiKey') }) })
      await user.clear(field)
      await user.type(field, 'https://autre.cliniquemana.com')
      expect(description(field)).toBe(t('settings.signing.connection.baseUrlHelp'))
    })

    it('refuses an IP address or an internal name in the browser (P3-34)', async () => {
      const user = userEvent.setup()
      renderPage(ADMIN)
      const field = await baseUrl()
      await user.clear(field)
      await user.type(field, 'https://127.0.0.1')
      await user.click(within(connection()).getByRole('button', { name: t('common.save') }))
      expect(await within(connection()).findByText(t('settings.signing.connection.publicHost'))).toBeInTheDocument()
      expect(mocks.signing.setSigningSettings).not.toHaveBeenCalled()
    })

    it('refuses an http:// address in the browser, focused, with the SQL rule’s message', async () => {
      const user = userEvent.setup()
      renderPage(ADMIN)
      const field = await baseUrl()
      await user.clear(field)
      await user.type(field, 'http://sign.cliniquemana.com')
      await user.click(within(connection()).getByRole('button', { name: t('common.save') }))
      expect(await within(connection()).findByText(t('settings.validation.https'))).toBeInTheDocument()
      expect(field).toHaveFocus()
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(mocks.signing.setSigningSettings).not.toHaveBeenCalled()
    })

    it('saves the expiry alone (the address is not sent: no lost update), and refuses one outside 1–60', async () => {
      const user = userEvent.setup()
      mocks.signing.setSigningSettings.mockResolvedValue({ api_key_cleared: false })
      renderPage(ADMIN)
      const field = await expiry()
      await user.clear(field)
      await user.type(field, '61')
      await user.click(within(sending()).getByRole('button', { name: t('common.save') }))
      expect(await within(sending()).findByText(t('settings.signing.send.expiryRange'))).toBeInTheDocument()
      expect(mocks.signing.setSigningSettings).not.toHaveBeenCalled()
      await user.clear(field)
      await user.type(field, '14')
      await user.click(within(sending()).getByRole('button', { name: t('common.save') }))
      await waitFor(() =>
        expect(mocks.signing.setSigningSettings).toHaveBeenCalledExactlyOnceWith({ expiry_days: 14 }),
      )
    })

    describe('« Tester la connexion »', () => {
      it('says the connection works', async () => {
        const user = userEvent.setup()
        mocks.signing.testSigningConnection.mockResolvedValue({ ok: true })
        renderPage(ADMIN)
        await user.click(await within(connection()).findByRole('button', { name: t('settings.signing.connection.test') }))
        expect(await within(connection()).findByText(t('settings.signing.connection.success'))).toBeInTheDocument()
      })

      it('gives Documenso’s status when it refuses, and points at the key for a 401', async () => {
        const user = userEvent.setup()
        mocks.signing.testSigningConnection.mockResolvedValue({ ok: false, status: 401 })
        renderPage(ADMIN)
        await user.click(await within(connection()).findByRole('button', { name: t('settings.signing.connection.test') }))
        expect(await within(connection()).findByText(t('settings.signing.connection.failed', { status: '401' }))).toBeInTheDocument()
        expect(within(connection()).getByText(t('settings.signing.connection.keyRefused'))).toBeInTheDocument()
      })

      it('drops the outcome once another address is saved (it no longer applies)', async () => {
        const user = userEvent.setup()
        mocks.signing.testSigningConnection.mockResolvedValue({ ok: true })
        mocks.signing.setSigningSettings.mockResolvedValue({ api_key_cleared: false })
        renderPage(ADMIN)
        await user.click(await within(connection()).findByRole('button', { name: t('settings.signing.connection.test') }))
        expect(await within(connection()).findByText(t('settings.signing.connection.success'))).toBeInTheDocument()
        mocks.signing.fetchSigningSettings.mockResolvedValue({ base_url: 'https://autre.cliniquemana.com', expiry_days: 7 })
        const field = await baseUrl()
        await user.clear(field)
        await user.type(field, 'https://autre.cliniquemana.com')
        await user.click(within(connection()).getByRole('button', { name: t('common.save') }))
        await waitFor(() => expect(within(connection()).queryByText(t('settings.signing.connection.success'))).not.toBeInTheDocument())
      })

      it('explains a missing configuration', async () => {
        const user = userEvent.setup()
        mocks.signing.testSigningConnection.mockRejectedValue(new FunctionCallError('not_configured', 503, 'Signing is not configured'))
        renderPage(ADMIN)
        await user.click(await within(connection()).findByRole('button', { name: t('settings.signing.connection.test') }))
        expect(await within(connection()).findByText(plain(t('settings.signing.errors.not_configured')))).toBeInTheDocument()
      })
    })

    it('shows the clinic’s webhook address with « Copier », and the last event in clinic time', async () => {
      const user = userEvent.setup()
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      renderPage(ADMIN)
      const url = `http://127.0.0.1:55321/functions/v1/signing-webhook?org=${testAccess.org_id}`
      expect(within(webhook()).getByLabelText(t('settings.signing.webhook.url'))).toHaveValue(url)
      await user.click(within(webhook()).getByRole('button', { name: t('settings.webhook.copy') }))
      expect(writeText).toHaveBeenCalledWith(url)
      expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.webhook.copied'))
      expect(await within(webhook()).findByText(t('settings.signing.webhook.lastEvent', { date: '08 oct. 2026 à 08:00' }))).toBeInTheDocument()
    })

    it('says when no event was received yet, without announcing it (it is what the page loaded)', async () => {
      renderPage(ADMIN, { lastEvent: null })
      expect(await within(webhook()).findByText(t('settings.signing.webhook.noEvent'))).toBeInTheDocument()
      expect(within(webhook()).queryByRole('status')).not.toBeInTheDocument()
    })

    it('sends a secret once and never renders it', async () => {
      const user = userEvent.setup()
      mocks.secrets.setOrgSecret.mockResolvedValue(undefined)
      renderPage(ADMIN)
      await user.click(await within(webhook()).findByRole('button', { name: t('settings.secrets.add', { label: t('settings.signing.webhook.secret') }) }))
      await user.type(within(webhook()).getByLabelText(plain(t('settings.secrets.newValue', { label: t('settings.signing.webhook.secret') }))), 'whsec-local-value')
      await user.click(within(webhook()).getByRole('button', { name: t('common.save') }))
      await waitFor(() => expect(mocks.secrets.setOrgSecret).toHaveBeenCalledExactlyOnceWith('documenso_webhook_secret', 'whsec-local-value'))
      await waitFor(() => expect(within(webhook()).queryByLabelText(plain(t('settings.secrets.newValue', { label: t('settings.signing.webhook.secret') })))).not.toBeInTheDocument())
      expect(document.body.innerHTML).not.toContain('whsec-local-value')
    })

    describe('« Envoyer un document test »', () => {
      it('sends it to the caller with a fresh idempotency key, says where, and reloads the last test', async () => {
        const user = userEvent.setup()
        mocks.signing.sendSigningTestDocument.mockResolvedValue({ request_id: TEST_REQUEST.id, existing: false })
        renderPage(ADMIN)
        await within(sending()).findByText(t('settings.signing.send.noTest'))
        await user.click(within(sending()).getByRole('button', { name: t('settings.signing.send.testDocument') }))
        await waitFor(() => expect(mocks.signing.sendSigningTestDocument).toHaveBeenCalledTimes(1))
        expect(mocks.signing.sendSigningTestDocument.mock.calls[0]![0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.signing.send.testSent', { email: testAccess.email }))
        await waitFor(() => expect(mocks.signing.lastSigningTest).toHaveBeenCalledTimes(2))
      })

      it('retries a failed send with the same key (the draft is sent again, not duplicated)', async () => {
        const user = userEvent.setup()
        mocks.signing.sendSigningTestDocument
          .mockRejectedValueOnce(new FunctionCallError('provider_error', 502, 'The test document could not be sent'))
          .mockResolvedValueOnce({ request_id: TEST_REQUEST.id, existing: true })
          .mockResolvedValueOnce({ request_id: 'other', existing: false })
        renderPage(ADMIN)
        const button = within(sending()).getByRole('button', { name: t('settings.signing.send.testDocument') })
        await user.click(button)
        await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('settings.signing.errors.provider_error')))
        await user.click(button)
        await waitFor(() => expect(mocks.signing.sendSigningTestDocument).toHaveBeenCalledTimes(2))
        await user.click(button)
        await waitFor(() => expect(mocks.signing.sendSigningTestDocument).toHaveBeenCalledTimes(3))
        const [first, second, third] = mocks.signing.sendSigningTestDocument.mock.calls.map(([key]) => key as string)
        expect(second).toBe(first)
        // After a success, a new click is a new test.
        expect(third).not.toBe(first)
      })

      it('says a send is already under way (409)', async () => {
        const user = userEvent.setup()
        mocks.signing.sendSigningTestDocument.mockRejectedValue(new FunctionCallError('conflict', 409, 'Un envoi est déjà en cours.'))
        renderPage(ADMIN)
        await user.click(within(sending()).getByRole('button', { name: t('settings.signing.send.testDocument') }))
        await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('settings.signing.errors.conflict')))
      })

      it('shows the last test’s status in French', async () => {
        renderPage(ADMIN, { lastTest: TEST_REQUEST })
        expect(await within(sending()).findByText(t('signing.status.signed'))).toBeInTheDocument()
        expect(within(sending()).getByText(plain(t('settings.signing.send.lastTest', { date: '08 oct. 2026 à 08:00' })))).toBeInTheDocument()
        // A closed request has nothing to update.
        expect(within(sending()).queryByRole('button', { name: t('settings.signing.send.refresh') })).not.toBeInTheDocument()
      })

      it('one status region, mounted and empty from the start: loading and the last test are not announced', async () => {
        renderPage(ADMIN, { lastTest: new Promise<never>(() => {}) })
        await expiry()
        // Loading: « Chargement… » shows, outside the region.
        const region = within(sending()).getByRole('status')
        expect(within(sending()).getByText(t('common.loading'))).toBeInTheDocument()
        expect(region).toBeEmptyDOMElement()
        cleanup()
        renderPage(ADMIN, { lastTest: { ...TEST_REQUEST, status: 'sent' } })
        await expiry()
        expect(await within(sending()).findByText(t('signing.status.sent'))).toBeInTheDocument()
        const loaded = within(sending()).getByRole('status')
        expect(loaded).toBeEmptyDOMElement()
      })

      it('« Actualiser l’état » reads an open test back from Documenso; the outcome shows in the status region, not a toast', async () => {
        const user = userEvent.setup()
        mocks.signing.syncSignatureRequest.mockResolvedValue({ request_id: TEST_REQUEST.id, outcome: 'unchanged' })
        renderPage(ADMIN, { lastTest: { ...TEST_REQUEST, status: 'sent' } })
        await expiry()
        const region = within(sending()).getByRole('status')
        await user.click(await within(sending()).findByRole('button', { name: t('settings.signing.send.refresh') }))
        await waitFor(() => expect(region).toHaveTextContent(t('settings.signing.send.synced.unchanged')))
        expect(t('settings.signing.send.synced.unchanged')).toBe('État à jour.')
        expect(mocks.signing.syncSignatureRequest).toHaveBeenCalledExactlyOnceWith(TEST_REQUEST.id)
        expect(mocks.toast.success).not.toHaveBeenCalled()
        expect(within(sending()).getByRole('status')).toBe(region)
      })

      it('« Actualiser l’état »: a change and a failure show in the same region', async () => {
        const user = userEvent.setup()
        mocks.signing.syncSignatureRequest
          .mockResolvedValueOnce({ request_id: TEST_REQUEST.id, outcome: 'updated' })
          .mockRejectedValueOnce(new FunctionCallError('provider_error', 502, 'Documenso did not answer'))
        renderPage(ADMIN, { lastTest: { ...TEST_REQUEST, status: 'viewed' } })
        await expiry()
        const region = within(sending()).getByRole('status')
        const button = await within(sending()).findByRole('button', { name: t('settings.signing.send.refresh') })
        await user.click(button)
        await waitFor(() => expect(region).toHaveTextContent(t('settings.signing.send.synced.updated')))
        await user.click(within(sending()).getByRole('button', { name: t('settings.signing.send.refresh') }))
        await waitFor(() => expect(region).toHaveTextContent(t('settings.signing.errors.provider_error')))
        expect(mocks.toast.error).not.toHaveBeenCalled()
      })
    })
  })

  describe('adjointe (settings.view only): read-only', () => {
    it('shows the notice, read-only fields and the keys’ state, without any action', async () => {
      renderPage(ASSISTANT)
      expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
      // One wording: the notice names the right; the cards do not repeat it.
      expect(screen.getByText(t('settings.signing.readOnlyNotice'))).toBeInTheDocument()
      expect(within(connection()).getByText(t('settings.signing.connection.description'))).toBeInTheDocument()
      expect(await baseUrl()).toHaveAttribute('readonly')
      expect(await expiry()).toHaveAttribute('readonly')
      expect(await within(connection()).findByText(t('settings.secrets.configured'))).toBeInTheDocument()
      expect(within(webhook()).getByText(t('settings.secrets.notConfigured'))).toBeInTheDocument()
      for (const name of [
        t('common.save'),
        t('settings.secrets.replaceShort'),
        t('settings.secrets.addShort'),
        t('settings.signing.connection.test'),
        t('settings.signing.send.testDocument'),
      ]) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
      // The webhook address stays readable and copyable.
      expect(within(webhook()).getByRole('button', { name: t('settings.webhook.copy') })).toBeInTheDocument()
      // Test requests are readable with settings.integrations_manage only: not asked for.
      expect(mocks.signing.lastSigningTest).not.toHaveBeenCalled()
    })
  })

  describe('« Modèles de documents »', () => {
    it('lists the templates read-only, with their published version and draft', async () => {
      const user = userEvent.setup()
      renderPage(ASSISTANT, {
        templates: [TEMPLATE, { ...TEMPLATE, id: 'x', key: 'professionals.fiche', title: 'Fiche', description: null, published_version: null, published_at: null, draft_version_id: null, is_active: false }],
      })
      await user.click(screen.getByRole('tab', { name: t('settings.signing.tabs.templates') }))
      const table = await screen.findByRole('table')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(within(rows[0]!).getByText('Contrat de service')).toBeInTheDocument()
      expect(within(rows[0]!).getByText(t('settings.signing.templates.published', { version: '3', date: '08 oct. 2026' }))).toBeInTheDocument()
      expect(within(rows[0]!).getByText(t('settings.signing.templates.draft'))).toBeInTheDocument()
      expect(within(rows[1]!).getByText(t('settings.signing.templates.notPublished'))).toBeInTheDocument()
      expect(within(rows[1]!).getByText(t('settings.signing.templates.inactive'))).toBeInTheDocument()
      expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    })

    it('says when no module has a template yet', async () => {
      const user = userEvent.setup()
      renderPage(ADMIN, { templates: [] })
      await user.click(screen.getByRole('tab', { name: t('settings.signing.tabs.templates') }))
      expect(await screen.findByText(t('settings.signing.templates.empty'))).toBeInTheDocument()
    })
  })
})
