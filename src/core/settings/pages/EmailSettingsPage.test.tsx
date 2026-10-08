import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { t } from '@/i18n'
import type { EmailSender, EmailTemplate } from '@/core/email/api'
import type { SettingsSection } from '@/core/modules/types'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { lazyPage } from '@/shared/lib/lazy-page'
import { testAccess } from '@/test/contexts'
import { renderInSettingsSection } from '@/test/settings-section'
import { EmailSettingsPage } from './EmailSettingsPage'

const mocks = vi.hoisted(() => ({
  email: {
    fetchEmailSender: vi.fn(),
    setEmailSender: vi.fn(),
    setEmailSendingDomain: vi.fn(),
    listEmailTemplates: vi.fn(),
    lastWebhookEventAt: vi.fn(),
    listEmailLog: vi.fn(),
    previewEmail: vi.fn(),
    sendTestEmail: vi.fn(),
    saveEmailTemplate: vi.fn(),
    resetEmailTemplate: vi.fn(),
    webhookUrl: (orgId: string) => `http://127.0.0.1:55321/functions/v1/resend-webhook?org=${orgId}`,
    EmailFunctionError: class extends Error {},
    EMAIL_LOG_PAGE_SIZE: 50,
  },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/email/api', () => mocks.email)
vi.mock('@/core/settings/secrets/api', () => mocks.secrets)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.resetAllMocks())

const section: SettingsSection = {
  id: 'email',
  path: 'courriels',
  labelKey: 'settings.sections.email',
  icon: Mail,
  permission: 'settings.view',
  editPermission: ['settings.email_manage', 'settings.integrations_manage'],
  group: 'plateforme',
  component: lazyPage(async () => ({ default: () => null })),
}

const SENDER: EmailSender = {
  from_name: 'Clinique MANA',
  from_address: 'no-reply@gestion.cliniquemana.com',
  reply_to: 'info@cliniquemana.ca',
  sending_domain: 'gestion.cliniquemana.com',
}

const TEMPLATE: EmailTemplate = {
  key: 'core.staff_invite',
  module_key: 'core',
  label: "Invitation d'un membre du personnel",
  description: 'Envoyé quand un administrateur invite une personne.',
  is_custom: false,
  version: 0,
  updated_at: null,
  updated_by_name: null,
  subject: 'Votre accès à {{clinic.name}}',
  body: 'Bonjour {{invitee.display_name}},',
  button_label: 'Créer mon accès',
  variables: [
    { path: 'invitee.display_name', label: 'Nom de la personne invitée', sample: 'Marie Tremblay', required: true, kind: 'text' },
    { path: 'clinic.name', label: 'Nom de la clinique', sample: 'Clinique MANA', required: true, kind: 'text' },
  ],
}

const ADMIN = ['settings.view', 'settings.email_manage', 'settings.integrations_manage']
const ASSISTANT = ['settings.view']
const ASSISTANT_EMAIL = ['settings.view', 'settings.email_manage']

function renderPage(permissions: string[], { lastEvent = '2026-10-08T12:00:00Z' as string | null } = {}) {
  mocks.email.fetchEmailSender.mockResolvedValue(SENDER)
  mocks.email.listEmailTemplates.mockResolvedValue([TEMPLATE])
  mocks.email.lastWebhookEventAt.mockResolvedValue(lastEvent)
  mocks.email.listEmailLog.mockResolvedValue([])
  mocks.email.previewEmail.mockResolvedValue({ subject: 'Objet', html: '<p>x</p>', text: 'x' })
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([{ key: 'resend_api_key', updated_at: '2026-10-08T12:00:00Z' }])
  const readOnly = !permissions.includes('settings.email_manage') && !permissions.includes('settings.integrations_manage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(
        <UnsavedChangesProvider>
          <EmailSettingsPage />
        </UnsavedChangesProvider>,
        { readOnly, section, access: { access: { ...testAccess, permissions } } },
      )}
    </QueryClientProvider>,
  )
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
const fromName = () => screen.findByLabelText(new RegExp(`^${t('settings.email.sender.fromName')}`))
const keysCard = () => screen.getByRole('region', { name: t('settings.email.keys.title') })

describe('EmailSettingsPage', () => {
  it('starts the sender, secret keys and last event reads together (no waterfall)', () => {
    mocks.email.fetchEmailSender.mockReturnValue(new Promise(() => {}))
    mocks.secrets.listOrgSecretKeys.mockReturnValue(new Promise(() => {}))
    mocks.email.lastWebhookEventAt.mockReturnValue(new Promise(() => {}))
    render(
      <QueryClientProvider client={new QueryClient()}>
        {renderInSettingsSection(<EmailSettingsPage />, { section, access: { access: { ...testAccess, permissions: ADMIN } } })}
      </QueryClientProvider>,
    )
    expect(mocks.email.fetchEmailSender).toHaveBeenCalledTimes(1)
    expect(mocks.secrets.listOrgSecretKeys).toHaveBeenCalledTimes(1)
    expect(mocks.email.lastWebhookEventAt).toHaveBeenCalledExactlyOnceWith('resend')
  })

  describe('admin: everything editable', () => {
    it('shows the three tabs, no notice, and editable sender and keys', async () => {
      renderPage(ADMIN)
      expect(tabNames()).toEqual(['Réglages', 'Modèles', "Historique d'envoi"])
      expect(await fromName()).not.toHaveAttribute('readonly')
      expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
      // The domain is shown after the local part, which is all that is typed.
      expect(screen.getByLabelText(new RegExp(`^${t('settings.email.sender.fromAddress')}`))).toHaveValue('no-reply')
      expect(screen.getByText('@gestion.cliniquemana.com')).toBeInTheDocument()
      const keys = keysCard()
      expect(await within(keys).findByRole('button', { name: t('settings.secrets.replace', { label: t('settings.email.keys.apiKey') }) })).toBeInTheDocument()
      expect(within(keys).getByRole('button', { name: t('settings.secrets.add', { label: t('settings.email.keys.webhookSecret') }) })).toBeInTheDocument()
      expect(within(keys).getByLabelText(new RegExp(`^${t('settings.email.keys.domain.label')}`))).not.toHaveAttribute('readonly')
    })

    it('shows the webhook address of the clinic, with « Copier », and the last event in clinic time', async () => {
      const user = userEvent.setup()
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      renderPage(ADMIN)
      const url = `http://127.0.0.1:55321/functions/v1/resend-webhook?org=${testAccess.org_id}`
      expect(within(keysCard()).getByLabelText(t('settings.email.keys.webhookUrl'))).toHaveValue(url)
      await user.click(within(keysCard()).getByRole('button', { name: t('settings.email.keys.copy') }))
      expect(writeText).toHaveBeenCalledWith(url)
      expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.email.keys.webhookCopied'))
      expect(await within(keysCard()).findByText(t('settings.email.keys.lastEvent', { date: '08 oct. 2026 à 08:00' }))).toBeInTheDocument()
    })

    it('says when no event was received yet', async () => {
      renderPage(ADMIN, { lastEvent: null })
      expect(await within(keysCard()).findByText(t('settings.email.keys.noEvent'))).toBeInTheDocument()
    })

    it('asks before changing the sending domain, then saves it', async () => {
      const user = userEvent.setup()
      mocks.email.setEmailSendingDomain.mockResolvedValue(undefined)
      renderPage(ADMIN)
      const domain = await within(keysCard()).findByLabelText(new RegExp(`^${t('settings.email.keys.domain.label')}`))
      await user.clear(domain)
      await user.type(domain, 'Courriel.CliniqueMana.com')
      await user.click(within(keysCard()).getByRole('button', { name: t('common.save') }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(t('settings.email.keys.domain.confirmBody'))).toBeInTheDocument()
      expect(mocks.email.setEmailSendingDomain).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: t('settings.email.keys.domain.confirm') }))
      await waitFor(() => expect(mocks.email.setEmailSendingDomain).toHaveBeenCalledExactlyOnceWith('courriel.cliniquemana.com'))
    })

    it('focuses the sending domain with its error when it is invalid', async () => {
      const user = userEvent.setup()
      renderPage(ADMIN)
      const domain = await within(keysCard()).findByLabelText(new RegExp(`^${t('settings.email.keys.domain.label')}`))
      await user.clear(domain)
      await user.type(domain, 'pas un domaine')
      await user.click(within(keysCard()).getByRole('button', { name: t('common.save') }))
      expect(domain).toHaveFocus()
      expect(domain).toHaveAttribute('aria-invalid', 'true')
      expect(domain.getAttribute('aria-describedby')).toMatch(/-error/)
      expect(mocks.email.setEmailSendingDomain).not.toHaveBeenCalled()
    })

    describe('changing tabs', () => {
      const typeInFromName = async (user: ReturnType<typeof userEvent.setup>) => {
        const name = await fromName()
        await user.clear(name)
        await user.type(name, 'Accueil MANA')
      }

      it('opens the other tab at once when nothing is being edited', async () => {
        const user = userEvent.setup()
        renderPage(ADMIN)
        await fromName()
        await user.click(screen.getByRole('tab', { name: 'Modèles' }))
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'Modèles' })).toHaveAttribute('aria-selected', 'true')
      })

      it('asks first with an unsaved card, and « Rester » keeps the edit', async () => {
        const user = userEvent.setup()
        renderPage(ADMIN)
        await typeInFromName(user)
        await user.click(screen.getByRole('tab', { name: 'Modèles' }))
        const dialog = await screen.findByRole('alertdialog')
        await user.click(within(dialog).getByRole('button', { name: t('common.unsaved.stay') }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(screen.getByRole('tab', { name: 'Réglages' })).toHaveAttribute('aria-selected', 'true')
        expect(await fromName()).toHaveValue('Accueil MANA')
        expect(mocks.email.listEmailTemplates).not.toHaveBeenCalled()
      })

      it('by keyboard: focus alone switches nothing, Espace asks and the dialog stays open', async () => {
        const user = userEvent.setup()
        renderPage(ADMIN)
        await typeInFromName(user)
        const templatesTab = screen.getByRole('tab', { name: 'Modèles' })
        act(() => templatesTab.focus())
        expect(screen.getByRole('tab', { name: 'Réglages' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        await user.keyboard(' ')
        const dialog = await screen.findByRole('alertdialog')
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(dialog).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: t('common.unsaved.stay') })).toHaveFocus()
      })

      it('« Quitter sans enregistrer » opens the other tab', async () => {
        const user = userEvent.setup()
        renderPage(ADMIN)
        await typeInFromName(user)
        await user.click(screen.getByRole('tab', { name: 'Modèles' }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.leave') }))
        expect(screen.getByRole('tab', { name: 'Modèles' })).toHaveAttribute('aria-selected', 'true')
        expect(await screen.findByRole('button', { name: TEMPLATE.label })).toBeInTheDocument()
        // Back on « Réglages », the stored name again: the edit was dropped (and nothing asks).
        await user.click(screen.getByRole('tab', { name: 'Réglages' }))
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(await fromName()).toHaveValue(SENDER.from_name)
      })
    })

    it('saves the sender with the address on the sending domain', async () => {
      const user = userEvent.setup()
      mocks.email.setEmailSender.mockResolvedValue(undefined)
      renderPage(ADMIN)
      const name = await fromName()
      await user.clear(name)
      await user.type(name, 'Clinique MANA – Accueil')
      await user.clear(screen.getByLabelText(new RegExp(`^${t('settings.email.sender.replyTo')}`)))
      await user.click(within(screen.getByRole('form', { name: t('settings.email.sender.title') })).getByRole('button', { name: t('common.save') }))
      await waitFor(() =>
        expect(mocks.email.setEmailSender).toHaveBeenCalledExactlyOnceWith({
          from_name: 'Clinique MANA – Accueil',
          from_address: 'no-reply@gestion.cliniquemana.com',
          reply_to: null,
        }),
      )
    })
  })

  describe('adjointe (settings.view): read-only', () => {
    it('shows the notice, no « Historique d’envoi », read-only fields and no key action', async () => {
      renderPage(ASSISTANT)
      expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
      expect(tabNames()).toEqual(['Réglages', 'Modèles'])
      expect(await fromName()).toHaveAttribute('readonly')
      expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
      await waitFor(() => expect(mocks.secrets.listOrgSecretKeys).toHaveBeenCalled())
      expect(await within(keysCard()).findByText(t('settings.secrets.configured'))).toBeInTheDocument()
      expect(within(keysCard()).queryByRole('button', { name: /Remplacer|Ajouter/ })).not.toBeInTheDocument()
      expect(within(keysCard()).getByLabelText(new RegExp(`^${t('settings.email.keys.domain.label')}`))).toHaveAttribute('readonly')
    })

    it('opens a template read-only, with its preview', async () => {
      const user = userEvent.setup()
      renderPage(ASSISTANT)
      await user.click(screen.getByRole('tab', { name: 'Modèles' }))
      await user.click(await screen.findByRole('button', { name: TEMPLATE.label }))
      const sheet = await screen.findByRole('dialog')
      expect(within(sheet).getByLabelText(new RegExp(`^${t('settings.email.editor.subject')}`))).toHaveAttribute('readonly')
      expect(within(sheet).queryByRole('button', { name: t('settings.email.editor.sendTest') })).not.toBeInTheDocument()
      await waitFor(() => expect(sheet.querySelector('iframe')).not.toBeNull())
    })
  })

  describe('adjointe + settings.email_manage', () => {
    it('edits the sender and templates, sees the log, but not the keys', async () => {
      const user = userEvent.setup()
      renderPage(ASSISTANT_EMAIL)
      expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
      expect(tabNames()).toEqual(['Réglages', 'Modèles', "Historique d'envoi"])
      expect(await fromName()).not.toHaveAttribute('readonly')
      expect(within(keysCard()).getByText(t('settings.email.keys.readOnlyDescription'))).toBeInTheDocument()
      expect(within(keysCard()).getByLabelText(new RegExp(`^${t('settings.email.keys.domain.label')}`))).toHaveAttribute('readonly')
      await within(keysCard()).findByText(t('settings.secrets.configured'))
      expect(within(keysCard()).queryByRole('button', { name: /Remplacer|Ajouter/ })).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Modèles' }))
      await user.click(await screen.findByRole('button', { name: TEMPLATE.label }))
      const sheet = await screen.findByRole('dialog')
      expect(within(sheet).getByLabelText(new RegExp(`^${t('settings.email.editor.subject')}`))).not.toHaveAttribute('readonly')
      expect(within(sheet).getByRole('button', { name: t('settings.email.editor.sendTest') })).toBeInTheDocument()
    })

    it('opens the send log', async () => {
      const user = userEvent.setup()
      renderPage(ASSISTANT_EMAIL)
      await user.click(screen.getByRole('tab', { name: "Historique d'envoi" }))
      expect(await screen.findByText(t('settings.email.log.empty.title'))).toBeInTheDocument()
    })
  })
})
