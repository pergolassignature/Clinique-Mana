import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { IntakeMatches } from '../api/demandes'
import { NewDemandeDialog } from './NewDemandeDialog'

const mocks = vi.hoisted(() => ({
  api: { createDemande: vi.fn(), findDemandeMatches: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/demandes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/demandes')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const N = 'modules.demandes.new'
const X = `${N}.matches`
const NEW_ID = 'e0000000-0000-0000-0000-000000000009'

const VIRGINIE: IntakeMatches['clients'][number] = {
  client_id: 'c1',
  client_number: 1,
  display_name: 'Virginie Tremblay',
  birth_year: 1985,
  is_archived: false,
  matched_on: ['phone', 'name'],
  phone_hint: '0101',
  email_hint: null,
  open_demandes: [],
}
const NONE: IntakeMatches = { clients: [], open_demandes: [] }

beforeEach(() => {
  mocks.api.createDemande.mockResolvedValue(NEW_ID)
  mocks.api.findDemandeMatches.mockResolvedValue(NONE)
})
afterEach(() => vi.clearAllMocks())

function renderDialog(role: 'counselor' | 'admin_assistant' = 'counselor', permissions?: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const base = accessForRole(role, { modules: ['demandes', 'clients', 'professionals'] })
  const access = permissions ? { ...base, permissions } : base
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="demandes" element={<NewDemandeDialog />} />
          <Route path="demandes/:id/:onglet" element={<p>FICHE</p>} />
        </Routes>,
        { access: { access }, path: '/demandes' },
      )}
    </QueryClientProvider>,
  )
}

async function open() {
  const user = userEvent.setup()
  renderDialog()
  await user.click(screen.getByRole('button', { name: t(`${N}.open`) }))
  const dialog = await screen.findByRole('dialog')
  return { user, dialog }
}

const firstName = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: new RegExp(`^${t(`${N}.firstName`)}`) })
const lastName = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: t(`${N}.lastName`) })
const phone = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: t(`${N}.phone`) })

describe('NewDemandeDialog', () => {
  it('« Prénom » and « Nom » are two fields; the first name is required without a file', async () => {
    const { user, dialog } = await open()
    expect(firstName(dialog)).toHaveAccessibleName(expect.stringContaining(t('common.form.required')))
    await user.type(lastName(dialog), 'Tremblay')
    await user.click(within(dialog).getByRole('button', { name: t(`${N}.create`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`${N}.someone`))
    expect(mocks.api.createDemande).not.toHaveBeenCalled()
    await user.type(firstName(dialog), 'Lina')
    await user.click(within(dialog).getByRole('button', { name: t(`${N}.create`) }))
    await waitFor(() => expect(mocks.api.createDemande).toHaveBeenCalledTimes(1))
    expect(mocks.api.createDemande.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ contact_first_name: 'Lina', contact_last_name: 'Tremblay', channel: 'phone' }),
    )
    expect(mocks.api.createDemande.mock.calls[0]![0]).not.toHaveProperty('client_id')
    expect(mocks.api.createDemande.mock.calls[0]![0]).not.toHaveProperty('contact_name')
  })

  it('no match: no section, the flow unchanged', async () => {
    const { user, dialog } = await open()
    await user.type(phone(dialog), '514 555-0199')
    await waitFor(() => expect(mocks.api.findDemandeMatches).toHaveBeenCalled())
    expect(mocks.api.findDemandeMatches.mock.calls.at(-1)![0]).toEqual({ firstName: null, lastName: null, phone: '+15145550199', email: null })
    await waitFor(() => expect(within(dialog).queryByText(t(`${X}.searching`))).not.toBeInTheDocument())
    expect(within(dialog).queryByRole('region')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('heading', { name: /Dossiers existants/ })).not.toBeInTheDocument()
  })

  it('nothing meaningful typed: no lookup at all (a first name alone, a partial phone, an address in progress)', async () => {
    const { user, dialog } = await open()
    await user.type(firstName(dialog), 'Vi')
    await user.type(phone(dialog), '514 55')
    await user.type(within(dialog).getByRole('textbox', { name: t(`${N}.email`) }), 'virginie@')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(mocks.api.findDemandeMatches).not.toHaveBeenCalled()
  })

  it('shows the matching files; « Utiliser ce dossier » sends the file, « Ne pas rattacher » undoes it', async () => {
    mocks.api.findDemandeMatches.mockResolvedValue({ clients: [VIRGINIE], open_demandes: [] })
    const { user, dialog } = await open()
    await user.type(firstName(dialog), 'Virginie')
    await user.type(lastName(dialog), 'Tremblay')
    await user.type(phone(dialog), '5145550101')
    const section = await within(dialog).findByRole('region', { name: t(`${X}.title`, { count: '1' }) })
    expect(section).toHaveTextContent('CLI-000001 · Virginie Tremblay')
    expect(section).toHaveTextContent(t(`${X}.born`, { year: '1985' }))
    expect(section).toHaveTextContent(t(`${X}.matchedOn.phone`, { hint: '0101' }))
    expect(section).toHaveTextContent(t(`${X}.matchedOn.name`))
    // The probe: the parts that are meaningful, never more.
    expect(mocks.api.findDemandeMatches.mock.calls.at(-1)![0]).toEqual({ firstName: 'Virginie', lastName: 'Tremblay', phone: '+15145550101', email: null })

    const file = 'CLI-000001 · Virginie Tremblay'
    await user.click(within(section).getByRole('button', { name: t(`${X}.useFor`, { file }) }))
    expect(within(section).getByText(t(`${X}.chosen`, { file }))).toBeInTheDocument()
    // Undo, then choose again.
    await user.click(within(section).getByRole('button', { name: t(`${X}.unlink`) }))
    expect(within(section).queryByText(t(`${X}.chosen`, { file }))).not.toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: t(`${X}.useFor`, { file }) }))

    await user.click(within(dialog).getByRole('button', { name: t(`${N}.create`) }))
    await waitFor(() => expect(mocks.api.createDemande).toHaveBeenCalledTimes(1))
    expect(mocks.api.createDemande.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ client_id: 'c1', contact_first_name: 'Virginie', contact_last_name: 'Tremblay', contact_phone_e164: '+15145550101' }),
    )
    expect(await screen.findByText('FICHE')).toBeInTheDocument()
  })

  it('a chosen file is enough: the first name is no longer required', async () => {
    mocks.api.findDemandeMatches.mockResolvedValue({ clients: [VIRGINIE], open_demandes: [] })
    const { user, dialog } = await open()
    await user.type(phone(dialog), '5145550101')
    const section = await within(dialog).findByRole('region', { name: t(`${X}.title`, { count: '1' }) })
    await user.click(within(section).getByRole('button', { name: /Utiliser le dossier/ }))
    expect(firstName(dialog)).not.toHaveAccessibleName(expect.stringContaining(t('common.form.required')))
    await user.click(within(dialog).getByRole('button', { name: t(`${N}.create`) }))
    await waitFor(() => expect(mocks.api.createDemande).toHaveBeenCalledTimes(1))
    expect(mocks.api.createDemande.mock.calls[0]![0]).toEqual(expect.objectContaining({ client_id: 'c1' }))
    expect(mocks.api.createDemande.mock.calls[0]![0]).not.toHaveProperty('contact_first_name')
  })

  it('an open request for the file or the contact: a warning with « Ouvrir la demande », never blocking', async () => {
    mocks.api.findDemandeMatches.mockResolvedValue({
      clients: [{ ...VIRGINIE, open_demandes: [{ id: 'd1', reference: 'DEM-2026-0042' }] }],
      open_demandes: [{ id: 'd2', reference: 'DEM-2026-0043' }],
    })
    const { user, dialog } = await open()
    await user.type(firstName(dialog), 'Virginie')
    await user.type(phone(dialog), '5145550101')
    expect(await within(dialog).findByText(t(`${X}.open`, { reference: 'DEM-2026-0042' }))).toBeInTheDocument()
    expect(within(dialog).getByText(t(`${X}.openContact`, { reference: 'DEM-2026-0043' }))).toBeInTheDocument()
    const link = within(dialog).getByRole('link', { name: t(`${X}.openLinkFor`, { reference: 'DEM-2026-0042' }) })
    expect(link).toHaveAttribute('href', '/demandes/d1/accueil')
    expect(link).toHaveAttribute('target', '_blank')
    // Creation is still possible (another family member may call).
    await user.click(within(dialog).getByRole('button', { name: t(`${N}.create`) }))
    await waitFor(() => expect(mocks.api.createDemande).toHaveBeenCalledTimes(1))
  })

  it('without clients.view: no lookup', async () => {
    const user = userEvent.setup()
    renderDialog('counselor', ['demandes.view', 'demandes.manage'])
    await user.click(screen.getByRole('button', { name: t(`${N}.open`) }))
    const dialog = await screen.findByRole('dialog')
    await user.type(phone(dialog), '5145550101')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(mocks.api.findDemandeMatches).not.toHaveBeenCalled()
  })
})
