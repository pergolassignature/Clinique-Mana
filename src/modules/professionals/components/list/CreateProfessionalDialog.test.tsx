import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { setupQueryClient } from '../../test/query-client'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { CreateProfessionalDialog } from './CreateProfessionalDialog'

const mocks = vi.hoisted(() => ({
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  record: { createProfessional: vi.fn() },
  invitations: { sendProfessionalInvitation: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.catalog }))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('../../api/invitations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/invitations')>()), ...mocks.invitations }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.professionals.create'
const NEW_ID = '00000000-0000-4000-8000-00000000abcd'

/** The adjointe; without `professionals.invite` unless asked (the 4a tests create only). */
function renderDialog({ invite = false } = {}) {
  const { queryClient, invalidated } = setupQueryClient()
  const permissions = ROLE_PERMISSIONS.admin_assistant.filter((p) => invite || p !== 'professionals.invite')
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <>
          <CreateProfessionalDialog />
          <LocationProbe />
        </>,
        { path: '/professionnels', access: { access: accessForRole('admin_assistant', { permissions }) } },
      )}
    </QueryClientProvider>,
  )
  return { invalidated }
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.list.add') }))
  return screen.findByRole('dialog', { name: t(`${C}.heading`) })
}

const field = (name: string) => within(screen.getByRole('dialog')).getByRole('textbox', { name: new RegExp(`^${name}`) })
const profession = () => within(screen.getByRole('dialog')).getByRole('combobox', { name: t(`${C}.profession`) })
const licence = () => within(screen.getByRole('dialog')).queryByRole('textbox', { name: /^N° de permis/ })

async function fillNames() {
  await userEvent.type(field(t(`${C}.firstName`)), 'Marie')
  await userEvent.type(field(t(`${C}.lastName`)), 'Tremblay')
  await userEvent.type(field(t(`${C}.email`)), 'Marie.T@Exemple.ca')
}

beforeEach(() => {
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.record.createProfessional.mockResolvedValue(NEW_ID)
})
afterEach(() => vi.clearAllMocks())

describe('CreateProfessionalDialog', () => {
  it('starts on Prénom, its X out of the tab order, and lists the active titles', async () => {
    renderDialog()
    const dialog = await open()
    await waitFor(() => expect(field(t(`${C}.firstName`))).toHaveFocus())
    expect(within(dialog).getByRole('button', { name: t('common.close') })).toHaveAttribute('tabindex', '-1')
    expect(within(profession()).getAllByRole('option').map((o) => o.textContent)).toEqual([t(`${C}.professionNone`), 'Psychologue', 'Naturopathe'])
  })

  it('asks for the licence, under the order’s label, only for a regulated title (P4-35)', async () => {
    renderDialog()
    await open()
    expect(licence()).not.toBeInTheDocument()
    await userEvent.selectOptions(profession(), IDS.psychologue)
    expect(licence()).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.licenceHelp`, { order: 'OPQ' }))).toBeInTheDocument()
    await userEvent.selectOptions(profession(), IDS.naturopathe)
    expect(licence()).not.toBeInTheDocument()
  })

  it('requires the licence of a regulated title', async () => {
    renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.psychologue)
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    expect(await screen.findByText(t('modules.professionals.validation.licenceRequired'))).toBeInTheDocument()
    expect(mocks.record.createProfessional).not.toHaveBeenCalled()
  })

  it('creates, then opens the record with « Professionnel créé. »', async () => {
    const { invalidated } = renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.psychologue)
    await userEvent.type(licence() as HTMLElement, '12345')
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/professionnels/${NEW_ID}/apercu`))
    expect(mocks.record.createProfessional).toHaveBeenCalledWith({
      firstName: 'Marie',
      lastName: 'Tremblay',
      email: 'marie.t@exemple.ca',
      titleId: IDS.psychologue,
      licenceNumber: '12345',
    })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.created'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(invalidated()).toContainEqual(['professionals', 'list'])
  })

  it('sends no licence once the title no longer needs one', async () => {
    renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.psychologue)
    await userEvent.type(licence() as HTMLElement, '12345')
    await userEvent.selectOptions(profession(), IDS.naturopathe)
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(mocks.record.createProfessional).toHaveBeenCalledWith(expect.objectContaining({ titleId: IDS.naturopathe, licenceNumber: null })))
  })

  it('shows a duplicate email under Courriel (HINT email), and stays open', async () => {
    mocks.record.createProfessional.mockRejectedValue({ code: 'P0001', message: 'Ce courriel est déjà utilisé.', hint: 'email' })
    renderDialog()
    await open()
    await fillNames()
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    const email = field(t(`${C}.email`))
    await waitFor(() => expect(email).toHaveAccessibleDescription(expect.stringContaining('Ce courriel est déjà utilisé.')))
    expect(email).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('routes by the HINT, not the wording: « …non permis » on the first name goes under Prénom', async () => {
    const message = 'Le prénom contient des caractères invisibles ou non permis.'
    mocks.record.createProfessional.mockRejectedValue({ code: 'P0001', message, hint: 'first_name' })
    renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.psychologue)
    await userEvent.type(licence() as HTMLElement, '12345')
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    const firstName = field(t(`${C}.firstName`))
    await waitFor(() => expect(firstName).toHaveAccessibleDescription(expect.stringContaining(message)))
    expect(firstName).toHaveFocus()
    expect(licence()).not.toHaveAccessibleDescription(expect.stringContaining(message))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a licence refusal under the licence field when it is there', async () => {
    const message = "Le numéro de permis pour Psychologue n'a pas le bon format."
    mocks.record.createProfessional.mockRejectedValue({ code: 'P0001', message, hint: 'licence' })
    renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.psychologue)
    await userEvent.type(licence() as HTMLElement, '12345')
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(licence()).toHaveAccessibleDescription(expect.stringContaining(message)))
    expect(licence()).toHaveFocus()
  })

  it('a licence refusal with no licence field (the title gained an order) goes above the buttons, and the titles are refetched', async () => {
    mocks.record.createProfessional.mockRejectedValue({ code: 'P0001', message: 'Le numéro de permis est requis pour ce titre.', hint: 'licence' })
    const { invalidated } = renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.naturopathe)
    expect(licence()).not.toBeInTheDocument()
    // Meanwhile, naturopathe was put under an order.
    mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue({
      ...CATALOG,
      titles: CATALOG.titles.map((title) => (title.id === IDS.naturopathe ? { ...title, orderId: IDS.opq } : title)),
    })
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.licenceNowRequired`))
    expect(invalidated()).toContainEqual(['professionals-catalog', 'catalog'])
    // The refetched catalogue brings the field.
    expect(await screen.findByRole('textbox', { name: /^N° de permis/ })).toBeInTheDocument()
  })

  it('an archived title (HINT title) shows under Profession, and the titles are refetched', async () => {
    const message = 'Ce titre est archivé.'
    mocks.record.createProfessional.mockRejectedValue({ code: 'P0001', message, hint: 'title' })
    const { invalidated } = renderDialog()
    await open()
    await fillNames()
    await userEvent.selectOptions(profession(), IDS.naturopathe)
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(profession()).toHaveAccessibleDescription(expect.stringContaining(message)))
    expect(invalidated()).toContainEqual(['professionals-catalog', 'catalog'])
  })

  it('shows any other refusal above the buttons', async () => {
    mocks.record.createProfessional.mockRejectedValue({ code: 'P0001', message: "Aucune langue active n'est disponible." })
    renderDialog()
    await open()
    await fillNames()
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Aucune langue active n'est disponible.")
  })
})

describe('CreateProfessionalDialog — invite now (Task 4b.3)', () => {
  const INVITE = t(`${C}.inviteNow`)

  async function create() {
    await fillNames()
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submitAndInvite`) }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/professionnels/${NEW_ID}/apercu`))
  }

  it('offers « Envoyer l’invitation maintenant », ticked, only with professionals.invite; the description follows it', async () => {
    renderDialog({ invite: true })
    await open()
    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('checkbox', { name: INVITE })).toBeChecked()
    expect(screen.getByRole('button', { name: t(`${C}.submitAndInvite`) })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription(t(`${C}.description`))
    await userEvent.click(screen.getByRole('checkbox', { name: INVITE }))
    expect(screen.getByRole('button', { name: t(`${C}.submit`) })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription(t(`${C}.descriptionNoInvite`))
  })

  it('without professionals.invite, the description says no invitation leaves', async () => {
    renderDialog()
    await open()
    expect(screen.queryByRole('checkbox', { name: INVITE })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(t(`${C}.descriptionNoInvite`))
  })

  it('creates, then sends the invitation to the file’s address, and says where it went', async () => {
    mocks.invitations.sendProfessionalInvitation.mockResolvedValue({ expiresAt: '2026-10-15T14:00:00Z', emailProblem: null })
    renderDialog({ invite: true })
    await open()
    await create()
    expect(mocks.invitations.sendProfessionalInvitation).toHaveBeenCalledWith(NEW_ID, 'send')
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.onboarding.toasts.sentExpires', { email: 'marie.t@exemple.ca', date: '15 oct. 2026' }))
  })

  it('sends nothing when unticked', async () => {
    renderDialog({ invite: true })
    await open()
    await fillNames()
    await userEvent.click(screen.getByRole('checkbox', { name: INVITE }))
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/professionnels/${NEW_ID}/apercu`))
    expect(mocks.invitations.sendProfessionalInvitation).not.toHaveBeenCalled()
  })

  it('the link created but its email failed: a warning that says what to do, the record opens', async () => {
    mocks.invitations.sendProfessionalInvitation.mockResolvedValue({ expiresAt: null, emailProblem: { code: 'provider_error', retryAfter: null } })
    renderDialog({ invite: true })
    await open()
    await create()
    expect(mocks.toast.warning).toHaveBeenCalledWith(t('modules.professionals.onboarding.toasts.createdNotSent'), {
      description: `${t('modules.professionals.onboarding.emailProblems.provider_error')} ${t('modules.professionals.onboarding.emailAdvice.invitation')} ${t('modules.professionals.onboarding.emailAdvice.copyLink')}`,
    })
  })

  it('the invitation refused after the creation: the file exists, the toast says so and why', async () => {
    mocks.invitations.sendProfessionalInvitation.mockRejectedValue(new FunctionCallError('network', 0, 'Function unreachable'))
    renderDialog({ invite: true })
    await open()
    await create()
    expect(mocks.toast.error).toHaveBeenCalledWith(t(`${C}.notInvited`), { description: t('modules.professionals.onboarding.errors.network') })
  })
})
