import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ConsentVersion, ConsentVersions } from '../../api/documents'
import { professionalsSettingsKeys } from '../../hooks/keys'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { ConsentsSettingsPage } from './ConsentsSettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchConsentVersions: vi.fn(), saveConsentDraft: vi.fn(), publishConsentVersion: vi.fn(), discardConsentDraft: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/documents')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.professionals.settings.consents'

function version(over: Partial<ConsentVersion> = {}): ConsentVersion {
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    version: 1,
    title: "Consentement au droit à l'image",
    body: 'J’autorise la clinique à utiliser ma photo sur son site.',
    publishedAt: '2026-10-01T14:00:00+00:00',
    publishedByName: 'Julie Roy',
    signedCount: 3,
    createdAt: '2026-10-01T13:00:00+00:00',
    updatedAt: '2026-10-01T14:00:00+00:00',
    ...over,
  }
}
const DRAFT = version({ id: '00000000-0000-4000-8000-00000000c002', version: 2, title: 'Consentement v2', body: 'Nouveau texte.', publishedAt: null, publishedByName: null, signedCount: 0 })

function versions(over: Partial<ConsentVersions> = {}): ConsentVersions {
  return { key: 'image_rights', current: version(), draft: null, previous: [], ...over }
}

afterEach(() => vi.clearAllMocks())

async function renderPage(data: ConsentVersions, { readOnly = false } = {}) {
  mocks.api.fetchConsentVersions.mockResolvedValue(data)
  const client = renderProfessionalsSettingsPage(<ConsentsSettingsPage />, { sectionId: 'consents', readOnly })
  await screen.findByRole('heading', { name: t(`${C}.current.title`) })
  return client
}

describe('ConsentsSettingsPage', () => {
  it('shows the version in force: its title, who published it, its signatures and its text', async () => {
    await renderPage(versions({ previous: [version({ id: 'old', version: 0, title: 'Ancien texte', signedCount: 1 })] }))
    expect(screen.getByText('Version 1 · publiée le 01 oct. 2026 par Julie Roy · 3 signatures')).toBeInTheDocument()
    expect(screen.getByText('J’autorise la clinique à utiliser ma photo sur son site.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t(`${C}.previous.title`) })).toBeInTheDocument()
    expect(screen.getByText('Version 0 · publiée le 01 oct. 2026 par Julie Roy · 1 signature')).toBeInTheDocument()
  })

  it('« Nouvelle version » starts from the text in force; « Enregistrer le brouillon » creates it', async () => {
    mocks.api.saveConsentDraft.mockResolvedValue(DRAFT.id)
    const { invalidated } = await renderPage(versions())
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.newVersion`) }))
    expect(screen.getByRole('heading', { name: t(`${C}.draft.title`, { version: '2' }) })).toBeInTheDocument()
    const body = screen.getByRole('textbox', { name: new RegExp(`^${t(`${C}.draft.body`)}`) })
    expect(body).toHaveValue('J’autorise la clinique à utiliser ma photo sur son site.')
    await userEvent.clear(body)
    await userEvent.type(body, 'Texte révisé.')
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.draft.save`) }))
    await waitFor(() => expect(mocks.api.saveConsentDraft).toHaveBeenCalledWith({ title: "Consentement au droit à l'image", body: 'Texte révisé.' }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.documents.toasts.draftSaved'))
    expect(invalidated()).toContainEqual(professionalsSettingsKeys.consents())
  })

  it('« Publier la version 2 » after a confirmation that says signatures keep their version', async () => {
    mocks.api.publishConsentVersion.mockResolvedValue(undefined)
    await renderPage(versions({ draft: DRAFT }))
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.draft.publish`, { version: '2' }) }))
    const confirm = await screen.findByRole('alertdialog', { name: t(`${C}.publishDialog.title`, { version: '2' }) })
    expect(confirm).toHaveTextContent('Les consentements déjà signés gardent leur version')
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${C}.publishDialog.confirm`, { version: '2' }) }))
    await waitFor(() => expect(mocks.api.publishConsentVersion).toHaveBeenCalledWith(DRAFT.id))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.documents.toasts.published'))
  })

  it('never publishes unsaved edits: asks to save first', async () => {
    await renderPage(versions({ draft: DRAFT }))
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`^${t(`${C}.draft.body`)}`) }), ' Ajout.')
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.draft.publish`, { version: '2' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent(t(`${C}.draft.unsavedBeforePublish`))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('« Supprimer le brouillon » after a confirmation', async () => {
    mocks.api.discardConsentDraft.mockResolvedValue(undefined)
    await renderPage(versions({ draft: DRAFT }))
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.draft.discard`) }))
    const confirm = await screen.findByRole('alertdialog', { name: t(`${C}.discardDialog.title`) })
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${C}.discardDialog.confirm`) }))
    await waitFor(() => expect(mocks.api.discardConsentDraft).toHaveBeenCalledWith(DRAFT.id))
  })

  it('a refused text shows under its field (HINT body)', async () => {
    mocks.api.saveConsentDraft.mockRejectedValue({ code: 'P0001', message: 'Le texte du consentement est obligatoire.', hint: 'body' })
    await renderPage(versions({ draft: DRAFT }))
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`^${t(`${C}.draft.titleField`)}`) }), ' bis')
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.draft.save`) }))
    expect(await screen.findByText('Le texte du consentement est obligatoire.')).toBeInTheDocument()
  })

  it('before any publication: says signing waits for one', async () => {
    await renderPage(versions({ current: null }))
    expect(screen.getByText(t(`${C}.current.noneBody`))).toBeInTheDocument()
  })

  it('read-only for the adjointe: the texts, the draft too, and no button', async () => {
    await renderPage(versions({ draft: DRAFT }), { readOnly: true })
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(screen.getByText('Nouveau texte.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Publier|Enregistrer|Supprimer|Nouvelle version/ })).not.toBeInTheDocument()
  })
})
