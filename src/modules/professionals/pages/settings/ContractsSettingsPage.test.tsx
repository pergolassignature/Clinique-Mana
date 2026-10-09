import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { bodyJson, DRAFT_ID, parsedTemplate, parsedVersion, PUBLISHED_ID, TEMPLATE_ID, templateJson, versionJson } from '../../test/fixtures-contract'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { ContractsSettingsPage } from './ContractsSettingsPage'

const mocks = vi.hoisted(() => ({
  contracts: {
    listContractTemplates: vi.fn(),
    fetchTemplateVersions: vi.fn(),
    createTemplateVersion: vi.fn(),
    updateTemplateVersion: vi.fn(),
    publishTemplateVersion: vi.fn(),
    archiveTemplateVersion: vi.fn(),
  },
  fetchOrganization: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/contracts')>()), ...mocks.contracts }))
vi.mock('@/core/settings/organization/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/settings/organization/api')>()),
  fetchOrganization: mocks.fetchOrganization,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const N = 'modules.professionals.settings.contracts'
const E = `${N}.editor`

beforeEach(() => {
  mocks.contracts.listContractTemplates.mockResolvedValue([parsedTemplate()])
  mocks.contracts.fetchTemplateVersions.mockResolvedValue([parsedVersion()])
  mocks.contracts.updateTemplateVersion.mockResolvedValue(undefined)
  mocks.contracts.publishTemplateVersion.mockResolvedValue(undefined)
  mocks.fetchOrganization.mockResolvedValue({ id: 'org', signatory_name: 'Dominique Exemple', signatory_title: 'présidente', signatory_email: 'direction@exemple.ca' })
})
afterEach(() => vi.resetAllMocks())

const render = (readOnly = false) => renderProfessionalsSettingsPage(<ContractsSettingsPage />, { sectionId: 'contracts', readOnly })
const bodyField = () => screen.findByRole('textbox', { name: new RegExp(`^${t(`${E}.form.body`)}`) })
const publishButton = () => screen.getByRole('button', { name: t(`${E}.publish`, { version: '1' }) })

describe('ContractsSettingsPage (Task 4d.3)', () => {
  it('lists « Contrat de service » unpublished, with its draft, and opens it by itself', async () => {
    render()
    expect(await screen.findByRole('heading', { name: t(`${N}.title`) })).toBeInTheDocument()
    expect(await screen.findByText('Contrat de service')).toBeInTheDocument()
    expect(screen.getByText(t(`${N}.list.notPublished`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${N}.list.filter`, { label: t(`${N}.list.filters.unpublished`), count: '1' }) })).toBeInTheDocument()
    expect(await bodyField()).toBeInTheDocument()
    expect(mocks.contracts.fetchTemplateVersions).toHaveBeenCalledWith(TEMPLATE_ID)
  })

  it('shows the clinic’s signer, with a link to « Signataire »', async () => {
    render()
    expect(await screen.findByText('Dominique Exemple')).toBeInTheDocument()
    expect(screen.getByText(t(`${N}.signer.signsSecond`, { email: 'direction@exemple.ca' }))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${N}.signer.link`) })).toHaveAttribute('href', '/parametres/signataire')
  })

  it('filters and searches the templates', async () => {
    render()
    await screen.findByText('Contrat de service')
    await userEvent.click(screen.getByRole('button', { name: t(`${N}.list.filter`, { label: t(`${N}.list.filters.published`), count: '0' }) }))
    expect(screen.getByText(t(`${N}.list.emptyTitle`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${N}.list.filter`, { label: t(`${N}.list.filters.all`), count: '1' }) }))
    await userEvent.type(screen.getByRole('searchbox', { name: t(`${N}.list.search`) }), 'bail')
    expect(screen.getByText(t(`${N}.list.emptyTitle`))).toBeInTheDocument()
  })

  it('the seeded draft cannot be published while it carries the validation line (Mise en service)', async () => {
    render()
    await bodyField()
    expect(screen.getByText(t(`${E}.bannerNotice`, { banner: 'Texte à faire valider par la direction avant publication' }))).toBeInTheDocument()
    expect(publishButton()).toHaveAttribute('aria-disabled', 'true')
    expect(publishButton()).toHaveAccessibleDescription(t(`${E}.publishBlocked.banner`))
    await userEvent.click(publishButton())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('saves the edited draft, then publishes it after « Les prochains contrats utiliseront cette version »', async () => {
    // The draft as seeded, then, once saved, without the line.
    mocks.contracts.fetchTemplateVersions
      .mockResolvedValueOnce([parsedVersion()])
      .mockResolvedValue([parsedVersion(versionJson({ updated_at: '2026-10-08T13:00:00+00:00' }, bodyJson({ banner: false })))])
    render()
    const field = await bodyField()
    // The direction validated the text: the line goes.
    fireEvent.change(field, { target: { value: (field as HTMLTextAreaElement).value.replace(/^\*\*Texte à faire valider[^\n]*\n\n/, '') } })
    expect(publishButton()).toHaveAccessibleDescription(t(`${E}.publishBlocked.unsaved`))
    await userEvent.click(screen.getByRole('button', { name: t(`${E}.save`) }))
    await waitFor(() => expect(mocks.contracts.updateTemplateVersion).toHaveBeenCalledOnce())
    const [versionId, content] = mocks.contracts.updateTemplateVersion.mock.calls[0] as [string, { body: { blocks: { type: string }[]; header: unknown } }]
    expect(versionId).toBe(DRAFT_ID)
    expect(content.body).toEqual({ ...bodyJson({ banner: false }) })

    await waitFor(() => expect(publishButton()).not.toHaveAttribute('aria-disabled'))
    await userEvent.click(publishButton())
    const dialog = await screen.findByRole('alertdialog', { name: t(`${E}.confirm.publish.title`, { version: '1' }) })
    expect(dialog).toHaveTextContent('Les prochains contrats utiliseront cette version.')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${E}.confirm.publish.action`, { version: '1' }) }))
    await waitFor(() => expect(mocks.contracts.publishTemplateVersion).toHaveBeenCalledOnce())
    expect(mocks.contracts.publishTemplateVersion.mock.calls[0]?.[0]).toBe(DRAFT_ID)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('refuses an unknown variable before the database does', async () => {
    render()
    const field = await bodyField()
    fireEvent.change(field, { target: { value: `${(field as HTMLTextAreaElement).value}\n\n{{professional.sin}}` } })
    await userEvent.click(screen.getByRole('button', { name: t(`${E}.save`) }))
    expect(await screen.findByText(t(`${E}.unknownPlaceholders`, { names: '{{professional.sin}}' }))).toBeInTheDocument()
    expect(mocks.contracts.updateTemplateVersion).not.toHaveBeenCalled()
  })

  it('warns when Annexe A’s placeholder is gone', async () => {
    render()
    const field = await bodyField()
    fireEvent.change(field, { target: { value: (field as HTMLTextAreaElement).value.replace('{{pricing.annexe_a}}', 'Annexe') } })
    expect(screen.getByText(t(`${E}.annexeMissing`, { placeholder: '{{pricing.annexe_a}}' }))).toBeInTheDocument()
  })

  it('turns the initials off in one switch (P4-431), keeping the clinic’s none', async () => {
    render()
    await bodyField()
    await userEvent.click(screen.getByRole('switch', { name: t(`${E}.form.initials`) }))
    await userEvent.click(screen.getByRole('button', { name: t(`${E}.save`) }))
    await waitFor(() => expect(mocks.contracts.updateTemplateVersion).toHaveBeenCalledOnce())
    const [, content] = mocks.contracts.updateTemplateVersion.mock.calls[0] as [string, { body: { header: unknown } }]
    expect(content.body.header).toEqual({ text: 'Contrat de service' })
  })

  it('previews in a sandboxed frame, with the samples and no script', async () => {
    render()
    await bodyField()
    const frame = screen.getByTitle(t(`${E}.preview.frameTitle`))
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', '')
    const html = frame.getAttribute('srcdoc') ?? ''
    expect(html).toContain('Camille Exemple')
    expect(html).not.toMatch(/<script/i)
  })

  it('a published version without a draft is read-only, with « Nouvelle version »', async () => {
    mocks.contracts.listContractTemplates.mockResolvedValue([parsedTemplate(templateJson({ draft_version_id: null, published_version_id: PUBLISHED_ID, published_version: 1, published_at: '2026-10-08T15:00:00+00:00' }))])
    mocks.contracts.fetchTemplateVersions.mockResolvedValue([
      parsedVersion(versionJson({ id: PUBLISHED_ID, status: 'published', published_at: '2026-10-08T15:00:00+00:00' }, bodyJson({ banner: false }))),
    ])
    mocks.contracts.createTemplateVersion.mockResolvedValue(DRAFT_ID)
    render()
    expect(await screen.findByText(t(`${E}.form.titlePublished`, { version: '1' }))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${E}.save`) })).toBeNull()
    expect(await bodyField()).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: t(`${E}.newVersionFrom`, { version: '1' }) }))
    await waitFor(() => expect(mocks.contracts.createTemplateVersion).toHaveBeenCalledOnce())
    expect(mocks.contracts.createTemplateVersion.mock.calls[0]?.[0]).toBe(TEMPLATE_ID)
  })

  it('is read-only for the adjointe: the notice, no save, no publish, no new version', async () => {
    render(true)
    expect(await bodyField()).toHaveAttribute('readonly')
    expect(screen.getByText(t('common.readOnlyNotice.body'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${E}.save`) })).toBeNull()
    expect(screen.queryByRole('button', { name: t(`${E}.publish`, { version: '1' }) })).toBeNull()
    expect(screen.queryByRole('switch', { name: t(`${E}.form.initials`) })).toBeNull()
    expect(screen.getByTitle(t(`${E}.preview.frameTitle`))).toHaveAttribute('sandbox', '')
  })

  it('one who may see but not edit the template (can_edit false) reads it only', async () => {
    mocks.contracts.listContractTemplates.mockResolvedValue([parsedTemplate(templateJson({ can_edit: false }))])
    render()
    expect(await bodyField()).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: t(`${E}.save`) })).toBeNull()
  })
})
