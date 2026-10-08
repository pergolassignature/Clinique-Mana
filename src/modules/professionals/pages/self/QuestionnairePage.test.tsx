import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { resetSuggestionsPause } from '@/core/address/availability'
import { FunctionCallError } from '@/core/supabase/functions'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import type { MySubmission } from '../../api/self'
import { professionalKeys } from '../../hooks/keys'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { mySubmission } from '../../test/fixtures-questionnaire'
import { setupQueryClient } from '../../test/query-client'
import { QuestionnairePage } from './QuestionnairePage'

const mocks = vi.hoisted(() => ({
  self: {
    fetchMySubmission: vi.fn(),
    saveMySubmissionDraft: vi.fn(),
    saveMySubmissionPrivate: vi.fn(),
    signMyConsent: vi.fn(),
    submitMyProfile: vi.fn(),
    fetchMyProfessionalPrivate: vi.fn(),
  },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  address: { fetchAddressSuggestions: vi.fn(), fetchPlaceAddress: vi.fn() },
  uploadFile: vi.fn(),
}))
vi.mock('../../api/self', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/self')>()), ...mocks.self }))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.catalog }))
vi.mock('@/core/address/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/address/api')>()), ...mocks.address }))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), uploadFile: mocks.uploadFile }))
vi.mock('@/core/storage/hooks', () => ({ useSignedFileUrl: () => ({ data: undefined, refetch: vi.fn() }) }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => sentry)

const Q = 'modules.professionals.questionnaire'
const required = (label: string) => `${label} ${t('common.form.required')}`

const COMPLETE_VALUES = {
  personal: { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' },
  professional: { professions: [{ title_id: IDS.naturopathe, licence_number: null, is_primary: true }] },
  portrait: { bio: 'Bonjour' },
  languages: { language_ids: [IDS.fr] },
  clienteles: { clienteles: [{ id: IDS.couples, specialized: false }] },
  motifs: { motif_ids: [IDS.anxiete] },
  availability: {},
  photo: { file_id: 'photo-file' },
  insurance: { file_id: 'insurance-file', expires_on: '2027-03-31' },
  consent: { consent_version_id: '00000000-0000-4000-8000-00000000c001', signer_name: 'Félix Gauthier', signed_at: '2026-10-08T14:00:00Z' },
}
const SAVED_PRIVATE = { business_number: null, gst_number: null, qst_number: null, bank_institution: '815', bank_transit: '30000', bank_account_last4: '4567', sin_last3: null }

let current: MySubmission | null

/** The browser's back button (the router's history). */
function BrowserBack() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(-1)}>
      BROWSER BACK
    </button>
  )
}

function renderPage(step?: string) {
  const { queryClient } = setupQueryClient()
  const path = `/mon-profil/questionnaire${step ? `?etape=${step}` : ''}`
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <UnsavedChangesProvider>
          <QuestionnairePage />
          <BrowserBack />
        </UnsavedChangesProvider>
      </QueryClientProvider>,
      { path },
    ),
  )
  return queryClient
}

const POSTAL_REFUSAL = { code: 'P0001', message: 'Code postal refusé par la clinique.', hint: 'postal_code' }
const NETWORK = { code: '', message: 'TypeError: Failed to fetch' }
const PERSONAL = { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' }
const nav = () => screen.getByRole('navigation', { name: t(`${Q}.stepsLabel`) })
const navStep = (step: string) => within(nav()).getByRole('button', { name: new RegExp(t(`${Q}.steps.${step}.title` as never)) })
/** A PNG header (the dropzone sniffs the content). */
const PNG = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1])], 'moi.png', { type: 'image/png' })
const chooseFile = (file: File) => fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })

beforeEach(() => {
  resetSuggestionsPause()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  current = mySubmission()
  mocks.self.fetchMySubmission.mockImplementation(async () => current)
  mocks.self.saveMySubmissionDraft.mockResolvedValue('2026-10-08T16:01:00+00:00')
  mocks.self.fetchMyProfessionalPrivate.mockResolvedValue({
    sinLast3: null,
    businessNumber: null,
    gstNumber: null,
    qstNumber: null,
    bankInstitution: null,
    bankTransit: null,
    bankAccountLast4: null,
  })
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.address.fetchAddressSuggestions.mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const stepTitle = async (step: string) => screen.findByRole('heading', { level: 2, name: t(`${Q}.steps.${step}.title` as never) })

describe('QuestionnairePage — states', () => {
  it('says there is nothing to complete without an open submission', async () => {
    current = null
    renderPage()
    expect(await screen.findByText(t(`${Q}.states.none.title`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${Q}.states.none.home`) })).toHaveAttribute('href', '/accueil')
  })

  it('shows a sent profile read-only, with the thanks', async () => {
    current = mySubmission({ status: 'submitted', submitted_at: '2026-10-08T15:00:00Z', values: COMPLETE_VALUES, private: SAVED_PRIVATE })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${Q}.states.submitted.pageTitle`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${Q}.states.submitted.thanks`))).toBeInTheDocument()
    expect(screen.getByText('•••• 4567')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${Q}.review.submit`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()
  })

  it('puts the clinic’s note on top of a profile sent back', async () => {
    current = mySubmission({ decision_note: 'Votre numéro de permis manque.' })
    renderPage()
    expect(await screen.findByText(t(`${Q}.states.returned.title`))).toBeInTheDocument()
    expect(screen.getByText('Votre numéro de permis manque.')).toBeInTheDocument()
  })

  it('shows only the requested sections of an update, then « Révision et envoi »', async () => {
    current = mySubmission({ kind: 'update', requested_sections: ['motifs', 'personal'], prefill: {}, values: {} })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${Q}.title.update`) })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: t(`${Q}.stepsLabel`) })
    const steps = within(nav).getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '-1' && b.closest('li'))
    expect(steps.map((b) => b.textContent)).toEqual([
      expect.stringContaining(t(`${Q}.steps.personal.title`)),
      expect.stringContaining(t(`${Q}.steps.motifs.title`)),
      expect.stringContaining(t(`${Q}.steps.review.title`)),
    ])
    // Opens on the first step to complete, out of the tab order.
    expect(await stepTitle('personal')).toBeInTheDocument()
    expect(screen.getAllByText(t(`${Q}.stepOf`, { current: '1', total: '3' })).length).toBeGreaterThan(0)
  })
})

describe('QuestionnairePage — steps', () => {
  it('« Continuer » validates the step first', async () => {
    renderPage('renseignements-personnels')
    await stepTitle('personal')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await screen.findByText(t(`${Q}.validation.phoneRequired`))).toBeInTheDocument()
    expect(mocks.self.saveMySubmissionDraft).not.toHaveBeenCalled()
  })

  it('« Continuer » saves what changed and the required fields shown, then opens the next step', async () => {
    current = mySubmission({ prefill: { personal: { personal_phone: '+15145551234', address_line1: '1 rue A', address_line2: null, city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' } }, values: {} })
    renderPage('renseignements-personnels')
    await stepTitle('personal')
    const city = screen.getByRole('textbox', { name: required(t(`${Q}.personal.city`)) })
    await userEvent.clear(city)
    await userEvent.type(city, 'Montréal')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await stepTitle('professional')).toHaveFocus()
    // One save: the city changed, the other required fields confirmed; never line 2 (not required, unchanged).
    const calls = mocks.self.saveMySubmissionDraft.mock.calls.filter(([section]) => section === 'personal')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      'personal',
      { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Montréal', province: 'QC', postal_code: 'H7A 1A1' },
    ])
    expect(calls.flatMap(([, values]) => Object.keys(values))).not.toContain('address_line2')
  })

  it('shows a refusal under the field its HINT names', async () => {
    mocks.self.saveMySubmissionDraft.mockRejectedValue({ code: 'P0001', message: 'Code postal invalide : format A1A 1A1 attendu.', hint: 'postal_code' })
    current = mySubmission({ prefill: { personal: { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' } }, values: {} })
    renderPage('renseignements-personnels')
    await stepTitle('personal')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    const postal = screen.getByRole('textbox', { name: required(t(`${Q}.personal.postalCode`)) })
    await waitFor(() => expect(postal).toHaveAccessibleDescription('Code postal invalide : format A1A 1A1 attendu.'))
    expect(screen.getByRole('heading', { level: 2, name: t(`${Q}.steps.personal.title`) })).toBeInTheDocument()
  })

  it('sends the private step to its own RPC only, never into the draft', async () => {
    mocks.self.saveMySubmissionPrivate.mockImplementation(async () => {
      current = mySubmission({ private: SAVED_PRIVATE, private_saved_at: '2026-10-08T16:02:00Z' })
    })
    renderPage('fiscalite-et-banque')
    await stepTitle('tax_bank')
    await userEvent.type(await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) }), '815')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.transit`)) }), '30000')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.account`)) }), '1234567')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await stepTitle('consent')).toBeInTheDocument()
    expect(mocks.self.saveMySubmissionPrivate).toHaveBeenCalledWith({
      businessNumber: null,
      gstNumber: null,
      qstNumber: null,
      bankInstitution: '815',
      bankTransit: '30000',
      bankAccount: '1234567',
      sin: null,
    })
    expect(mocks.self.saveMySubmissionDraft).not.toHaveBeenCalled()
    // No SIN field while the clinic does not collect it.
    expect(screen.queryByRole('textbox', { name: new RegExp(t(`${Q}.taxBank.sin`)) })).not.toBeInTheDocument()
  })

  it('signs the consent only with the file’s name', async () => {
    mocks.self.signMyConsent.mockResolvedValue(undefined)
    renderPage('consentement')
    await stepTitle('consent')
    await userEvent.click(screen.getByRole('checkbox', { name: t(`${Q}.consent.agree`) }))
    const name = screen.getByRole('textbox', { name: required(t(`${Q}.consent.name`)) })
    await userEvent.type(name, 'Félix Gauthie')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.consent.signAndContinue`) }))
    expect(await screen.findByText(t(`${Q}.consent.nameMismatch`))).toBeInTheDocument()
    expect(mocks.self.signMyConsent).not.toHaveBeenCalled()
    await userEvent.type(name, 'r')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.consent.signAndContinue`) }))
    expect(await stepTitle('review')).toBeInTheDocument()
    expect(mocks.self.signMyConsent).toHaveBeenCalledWith('00000000-0000-4000-8000-00000000c001', 'Félix Gauthier')
  })

  it('saves a picker at once and stays on the step (the sheet’s submit is not « Continuer »)', async () => {
    renderPage('motifs')
    await stepTitle('motifs')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.sets.motifs.choose`) }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(sheet).getByRole('button', { name: /^Vie intérieure/ }))
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Anxiété' }))
    await userEvent.click(within(sheet).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('motifs', { motif_ids: [IDS.anxiete] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Named by category on the step, which is still the current one.
    expect(screen.getByText('Anxiété')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: t(`${Q}.steps.motifs.title`) })).toBeInTheDocument()
    expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledTimes(1)
  })

  it('uploads the photo for the submission, then records it in the draft', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: '00000000-0000-4000-8000-0000000f0001' })
    renderPage('photo')
    await stepTitle('photo')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    // A PNG header (the dropzone sniffs the content).
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1])], 'moi.png', { type: 'image/png' })
    fireEvent.change(input as HTMLInputElement, { target: { files: [png] } })
    await waitFor(() => expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('photo', { file_id: '00000000-0000-4000-8000-0000000f0001' }))
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'professional_submission_file', subjectType: 'professional_submission', subjectId: current?.id, mimeType: 'image/png' }),
    )
    expect(await screen.findByText(t(`${Q}.files.photoReceived`))).toBeInTheDocument()
  })
})

describe('QuestionnairePage — sending', () => {
  it('names the steps still missing and sends nothing', async () => {
    renderPage('revision')
    await stepTitle('review')
    expect(screen.getByText(t(`${Q}.review.missingMany`, { count: '10' }))).toBeInTheDocument()
    const send = screen.getByRole('button', { name: t(`${Q}.review.submit`) })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(send)
    expect(mocks.self.submitMyProfile).not.toHaveBeenCalled()
  })

  it('sends a complete profile, then shows it as sent', async () => {
    current = mySubmission({ values: COMPLETE_VALUES, private: SAVED_PRIVATE, private_saved_at: '2026-10-08T16:02:00Z' })
    mocks.self.submitMyProfile.mockImplementation(async () => {
      current = mySubmission({ status: 'submitted', submitted_at: '2026-10-08T16:05:00Z', values: COMPLETE_VALUES, private: SAVED_PRIVATE })
    })
    renderPage('revision')
    await stepTitle('review')
    expect(screen.getByText(t(`${Q}.review.ready`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.review.submit`) }))
    expect(await screen.findByText(t(`${Q}.states.submitted.thanks`))).toBeInTheDocument()
    expect(mocks.self.submitMyProfile).toHaveBeenCalledTimes(1)
  })

  it('lists the steps the server says are incomplete', async () => {
    current = mySubmission({ values: COMPLETE_VALUES, private: SAVED_PRIVATE, private_saved_at: '2026-10-08T16:02:00Z' })
    mocks.self.submitMyProfile.mockRejectedValue(
      new FunctionCallError('invalid_request', 400, 'Certaines sections sont incomplètes.', { refusal: true, field: 'sections', sections: ['photo', 'insurance'] }),
    )
    renderPage('revision')
    await stepTitle('review')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.review.submit`) }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(t(`${Q}.review.serverMissing`))).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: t(`${Q}.steps.photo.title`) })).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: t(`${Q}.steps.insurance.title`) })).toBeInTheDocument()
  })
})

describe('QuestionnairePage — loading', () => {
  it('keeps the questionnaire and its drafts when a background refetch fails', async () => {
    const queryClient = renderPage('portrait')
    await stepTitle('portrait')
    const bio = screen.getByRole('textbox', { name: required(t(`${Q}.portrait.bio`)) })
    await userEvent.type(bio, ' et bienvenue')
    mocks.self.fetchMySubmission.mockRejectedValue({ code: '', message: 'TypeError: Failed to fetch' })
    await act(() => queryClient.refetchQueries({ queryKey: professionalKeys.mySubmission() }))
    await waitFor(() => expect(queryClient.getQueryState(professionalKeys.mySubmission())?.status).toBe('error'))
    expect(screen.getByRole('heading', { level: 2, name: t(`${Q}.steps.portrait.title`) })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: required(t(`${Q}.portrait.bio`)) })).toHaveValue('Bonjour et bienvenue')
    expect(screen.queryByText(t(`${Q}.states.loadError`))).not.toBeInTheDocument()
  })

  it('says there is nothing to complete when the catalogue fails without a submission', async () => {
    current = null
    mocks.catalog.fetchProfessionalsCatalog.mockRejectedValue({ code: '', message: 'TypeError: Failed to fetch' })
    renderPage()
    expect(await screen.findByText(t(`${Q}.states.none.title`))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains an empty questionnaire once the clinic closed it under the page', async () => {
    mocks.self.saveMySubmissionDraft.mockImplementation(async () => {
      current = null
      throw { code: 'P0001', message: 'Aucun questionnaire à compléter.', hint: 'submission' }
    })
    renderPage('portrait')
    await stepTitle('portrait')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.portrait.bio`)) }), '!')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.autosave.saveDraft`) }))
    expect(await screen.findByText(t(`${Q}.states.none.title`))).toBeInTheDocument()
    expect(screen.getByText(t(`${Q}.states.none.closed`))).toBeInTheDocument()
  })
})

describe('QuestionnairePage — refused and failed saves', () => {
  it('names a change refused after its step was left (within 2.5 s), and « Envoyer » says which step to fix', async () => {
    mocks.self.saveMySubmissionDraft.mockRejectedValue(POSTAL_REFUSAL)
    current = mySubmission({ values: COMPLETE_VALUES, private: SAVED_PRIVATE, private_saved_at: '2026-10-08T16:02:00Z' })
    renderPage('renseignements-personnels')
    await stepTitle('personal')
    const postal = screen.getByRole('textbox', { name: required(t(`${Q}.personal.postalCode`)) })
    await userEvent.clear(postal)
    await userEvent.type(postal, 'H2X 1Y4')
    // Leaves at once: the pending autosave is sent as the step closes.
    await userEvent.click(navStep('review'))
    await stepTitle('review')
    const alert = await screen.findByText(t(`${Q}.refused.titleOne`))
    const box = alert.closest('[role="alert"]') as HTMLElement
    expect(within(box).getByRole('button', { name: t(`${Q}.steps.personal.title`) })).toBeInTheDocument()
    expect(within(box).getByText(/Code postal refusé par la clinique\./)).toBeInTheDocument()
    expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('personal', { postal_code: 'H2X 1Y4' })
    // The step is marked in the list; the status line does not claim the change was saved.
    expect(navStep('personal')).toHaveTextContent(t(`${Q}.stepState.refused`))
    // « Envoyer »: the step to fix, never the connection.
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.review.submit`) }))
    expect(await screen.findByText(t(`${Q}.review.errors.refusedOne`, { step: t(`${Q}.steps.personal.title`) }))).toBeInTheDocument()
    expect(screen.queryByText(/connexion/)).not.toBeInTheDocument()
    expect(mocks.self.submitMyProfile).not.toHaveBeenCalled()
    // Back on the step, the refusal is under its field again.
    await userEvent.click(within(box).getByRole('button', { name: t(`${Q}.steps.personal.title`) }))
    await stepTitle('personal')
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: required(t(`${Q}.personal.postalCode`)) })).toHaveAccessibleDescription(POSTAL_REFUSAL.message),
    )
    expect(screen.getByText(t(`${Q}.autosave.unsaved`))).toBeInTheDocument()
  })

  it('a refusal after a failure in transit replaces the banner', async () => {
    mocks.self.saveMySubmissionDraft.mockRejectedValueOnce(NETWORK).mockRejectedValueOnce(POSTAL_REFUSAL)
    current = mySubmission({ prefill: { personal: PERSONAL }, values: {} })
    renderPage('renseignements-personnels')
    await stepTitle('personal')
    const city = screen.getByRole('textbox', { name: required(t(`${Q}.personal.city`)) })
    await userEvent.clear(city)
    await userEvent.type(city, 'Montréal')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.autosave.saveDraft`) }))
    expect(await screen.findByText(t(`${Q}.autosave.failed`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${Q}.autosave.retry`) })).toBeInTheDocument()
    const postal = screen.getByRole('textbox', { name: required(t(`${Q}.personal.postalCode`)) })
    await userEvent.clear(postal)
    await userEvent.type(postal, 'H2X 1Y4')
    // Left first: its own check on leaving (valid) must not race the refusal.
    await userEvent.tab()
    await waitFor(() => expect(postal).toHaveValue('H2X 1Y4'))
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.autosave.saveDraft`) }))
    expect(await screen.findByText(t(`${Q}.refused.titleOne`))).toBeInTheDocument()
    expect(screen.queryByText(t(`${Q}.autosave.failed`))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${Q}.autosave.retry`) })).not.toBeInTheDocument()
    await waitFor(() => expect(postal).toHaveAccessibleDescription(POSTAL_REFUSAL.message))
    expect(mocks.self.saveMySubmissionDraft).toHaveBeenLastCalledWith('personal', { city: 'Montréal', postal_code: 'H2X 1Y4' })
  })

  it('puts « Enregistrer le brouillon » after the fields in the tab order', async () => {
    renderPage('renseignements-personnels')
    await stepTitle('personal')
    const postal = screen.getByRole('textbox', { name: required(t(`${Q}.personal.postalCode`)) })
    const draft = screen.getByRole('button', { name: t(`${Q}.autosave.saveDraft`) })
    expect(postal.compareDocumentPosition(draft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Not on the steps saved on « Continuer ».
    await userEvent.click(navStep('tax_bank'))
    await stepTitle('tax_bank')
    expect(screen.queryByRole('button', { name: t(`${Q}.autosave.saveDraft`) })).not.toBeInTheDocument()
  })
})

describe('QuestionnairePage — leaving', () => {
  it('sends what is pending when the page is hidden, and when it is left (pagehide)', async () => {
    renderPage('portrait')
    await stepTitle('portrait')
    const bio = screen.getByRole('textbox', { name: required(t(`${Q}.portrait.bio`)) })
    await userEvent.type(bio, '!')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('portrait', { bio: 'Bonjour!' }))
    visibility.mockRestore()
    await userEvent.type(bio, '?')
    fireEvent(window, new Event('pagehide'))
    await waitFor(() => expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('portrait', { bio: 'Bonjour!?' }))
  })

  it('sends a step’s pending edits when it closes', async () => {
    renderPage('portrait')
    await stepTitle('portrait')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.portrait.bio`)) }), '!')
    await userEvent.click(navStep('languages'))
    await stepTitle('languages')
    await waitFor(() => expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('portrait', { bio: 'Bonjour!' }))
  })

  it('asks before leaving « Fiscalité et banque » with typed values: the list, « Retour » and the browser’s back button', async () => {
    renderPage('assurance')
    await stepTitle('insurance')
    await userEvent.click(navStep('tax_bank'))
    await stepTitle('tax_bank')
    const institution = await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })
    await userEvent.type(institution, '815')
    const stay = async () => {
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(t('common.unsaved.title'))).toBeInTheDocument()
      await userEvent.click(within(dialog).getByRole('button', { name: t('common.unsaved.stay') }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(screen.getByRole('heading', { level: 2, name: t(`${Q}.steps.tax_bank.title`) })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })).toHaveValue('815')
    }
    await userEvent.click(navStep('consent'))
    await stay()
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.back`) }))
    await stay()
    await userEvent.click(screen.getByRole('button', { name: 'BROWSER BACK' }))
    await stay()
    // Asked again on the next press; « Quitter » goes where the browser was going.
    await userEvent.click(screen.getByRole('button', { name: 'BROWSER BACK' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(await stepTitle('insurance')).toBeInTheDocument()
  })

  it('lets the browser’s back button leave « Fiscalité et banque » when nothing was typed', async () => {
    renderPage('assurance')
    await stepTitle('insurance')
    await userEvent.click(navStep('tax_bank'))
    await stepTitle('tax_bank')
    await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })
    await userEvent.click(screen.getByRole('button', { name: 'BROWSER BACK' }))
    expect(await stepTitle('insurance')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('QuestionnairePage — « Fiscalité et banque »', () => {
  const ON_FILE = { sinLast3: '286', businessNumber: null, gstNumber: null, qstNumber: null, bankInstitution: '815', bankTransit: '30000', bankAccountLast4: '4567' }

  it('keeps the browser, password managers, spell check and translators away from every field', async () => {
    current = mySubmission({ collect_sin: true })
    renderPage('fiscalite-et-banque')
    await stepTitle('tax_bank')
    await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })
    const fields = screen.getAllByRole('textbox')
    expect(fields).toHaveLength(7)
    for (const field of fields) {
      expect(field).toHaveAttribute('autocomplete', 'off')
      expect(field).toHaveAttribute('data-1p-ignore', 'true')
      expect(field).toHaveAttribute('data-lpignore', 'true')
      expect(field).toHaveAttribute('data-bwignore', 'true')
      expect(field).toHaveAttribute('data-form-type', 'other')
      expect(field).toHaveAttribute('spellcheck', 'false')
      expect(field).toHaveAttribute('translate', 'no')
    }
  })

  it('with the SIN collected and on file: the masks, nothing required, blank keeps them', async () => {
    current = mySubmission({ collect_sin: true, on_file: { has_sin: true, has_bank_account: true } })
    mocks.self.fetchMyProfessionalPrivate.mockResolvedValue(ON_FILE)
    mocks.self.saveMySubmissionPrivate.mockResolvedValue(undefined)
    renderPage('fiscalite-et-banque')
    await stepTitle('tax_bank')
    expect(await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })).toHaveValue('815')
    expect(screen.getByRole('textbox', { name: t(`${Q}.taxBank.sin`) })).toHaveAccessibleDescription(t(`${Q}.taxBank.sinOnFile`, { last3: '286' }))
    expect(screen.getByRole('textbox', { name: t(`${Q}.taxBank.account`) })).toHaveAccessibleDescription(t(`${Q}.taxBank.accountOnFile`, { last4: '4567' }))
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await stepTitle('consent')).toBeInTheDocument()
    expect(mocks.self.saveMySubmissionPrivate).toHaveBeenCalledWith({
      businessNumber: null,
      gstNumber: null,
      qstNumber: null,
      bankInstitution: '815',
      bankTransit: '30000',
      bankAccount: null,
      sin: null,
    })
  })

  it('with the SIN collected and none on file: required, checked, sent once, then the field empties', async () => {
    current = mySubmission({ collect_sin: true })
    mocks.self.saveMySubmissionPrivate.mockResolvedValue(undefined)
    renderPage('fiscalite-et-banque')
    await stepTitle('tax_bank')
    await userEvent.type(await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) }), '815')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.transit`)) }), '30000')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.account`)) }), '1234567')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await screen.findByText(t(`${Q}.validation.sinRequired`))).toBeInTheDocument()
    const sin = screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.sin`)) })
    await userEvent.type(sin, '046 454 287')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await screen.findByText(t('modules.professionals.validation.sinInvalid'))).toBeInTheDocument()
    await userEvent.clear(sin)
    await userEvent.type(sin, '046 454 286')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await stepTitle('consent')).toBeInTheDocument()
    expect(mocks.self.saveMySubmissionPrivate).toHaveBeenCalledTimes(1)
    expect(mocks.self.saveMySubmissionPrivate).toHaveBeenCalledWith(expect.objectContaining({ bankAccount: '1234567', sin: '046454286' }))
  })

  it('says a failure that is not a refusal plainly (not the connection), and reports its code only', async () => {
    mocks.self.saveMySubmissionPrivate.mockRejectedValue({ code: '22023', message: 'Compte 1234567 invalide.' })
    renderPage('fiscalite-et-banque')
    await stepTitle('tax_bank')
    await userEvent.type(await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) }), '815')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.transit`)) }), '30000')
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.taxBank.account`)) }), '1234567')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await screen.findByText(t(`${Q}.taxBank.errors.failed`))).toBeInTheDocument()
    expect(screen.queryByText(/connexion/)).not.toBeInTheDocument()
    const [report, context] = sentry.captureException.mock.calls.at(-1) as [Error, { tags: Record<string, string>; extra: Record<string, string> }]
    expect(report.name).toBe('RpcError 22023')
    expect(report.message).toBe('save_my_submission_private failed')
    expect(JSON.stringify([report.message, context])).not.toContain('1234567')
    expect(context.extra).toEqual({ submission_id: current?.id })
  })

  it('says when the details on file cannot be shown, with « Réessayer », and shows no form meanwhile', async () => {
    current = mySubmission({ on_file: { has_sin: false, has_bank_account: true } })
    mocks.self.fetchMyProfessionalPrivate.mockRejectedValueOnce({ code: '', message: 'TypeError: Failed to fetch' }).mockResolvedValueOnce(ON_FILE)
    renderPage('fiscalite-et-banque')
    await stepTitle('tax_bank')
    expect(await screen.findByText(t(`${Q}.taxBank.onFileError`))).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('textbox', { name: required(t(`${Q}.taxBank.institution`)) })).toHaveValue('815')
    expect(screen.queryByText(t(`${Q}.taxBank.onFileError`))).not.toBeInTheDocument()
  })
})

describe('QuestionnairePage — files', () => {
  it('shows a refused upload in the dropzone, the step unchanged', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: '00000000-0000-4000-8000-0000000f0001' })
    mocks.self.saveMySubmissionDraft.mockRejectedValue({ code: 'P0001', message: 'La photo doit être une image JPEG ou PNG de 5 Mo au plus.', hint: 'file_id' })
    renderPage('photo')
    await stepTitle('photo')
    chooseFile(PNG())
    expect(await screen.findByText('La photo doit être une image JPEG ou PNG de 5 Mo au plus.')).toBeInTheDocument()
    expect(screen.getByText(t(`${Q}.files.photoNone`))).toBeInTheDocument()
  })

  it('« Retirer » removes the photo from the step and moves focus to the dropzone’s button', async () => {
    current = mySubmission({ values: { photo: { file_id: 'photo-file' } } })
    renderPage('photo')
    await stepTitle('photo')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.files.removePhoto`) }))
    await waitFor(() => expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('photo', { file_id: null }))
    expect(await screen.findByRole('button', { name: t(`${Q}.files.choosePhoto`) })).toHaveFocus()
    expect(screen.getByText(t(`${Q}.files.photoNone`))).toBeInTheDocument()
  })

  it('« Continuer » is not blocked by an earlier refused « Retirer »', async () => {
    current = mySubmission({ values: { photo: { file_id: 'photo-file' } } })
    mocks.self.saveMySubmissionDraft.mockRejectedValueOnce({ code: 'P0001', message: 'Ce fichier ne peut plus être modifié.', hint: 'file_id' })
    renderPage('photo')
    await stepTitle('photo')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.files.removePhoto`) }))
    expect(await screen.findAllByText(/Ce fichier ne peut plus être modifié\./)).not.toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.actions.continue`) }))
    expect(await stepTitle('insurance')).toBeInTheDocument()
  })

  it('sends the insurance’s expiry (next March 31) with the file', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: '00000000-0000-4000-8000-0000000f0002' })
    renderPage('assurance')
    await stepTitle('insurance')
    expect(screen.getByLabelText(new RegExp(t(`${Q}.files.expiry`)))).toHaveValue('2027-03-31')
    chooseFile(new File([new TextEncoder().encode('%PDF-1.7\n')], 'assurance.pdf', { type: 'application/pdf' }))
    await waitFor(() =>
      expect(mocks.self.saveMySubmissionDraft).toHaveBeenCalledWith('insurance', { file_id: '00000000-0000-4000-8000-0000000f0002', expires_on: '2027-03-31' }),
    )
    expect(mocks.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/pdf', subjectId: current?.id }))
  })
})

describe('QuestionnairePage — motifs reserved to regulated titles (P4-335)', () => {
  const openMotifs = async () => {
    await stepTitle('motifs')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.sets.motifs.choose`) }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(sheet).getByRole('button', { name: /^Vie intérieure/ }))
    return within(sheet).getByRole('checkbox', { name: /Psychose/ })
  }

  it('blocks them while the questionnaire’s titles hold none, naming the step to change', async () => {
    current = mySubmission({ values: { professional: { professions: [{ title_id: IDS.naturopathe, licence_number: null, is_primary: true }] } } })
    renderPage('motifs')
    const psychose = await openMotifs()
    expect(psychose).toBeDisabled()
    expect(psychose).toHaveAccessibleDescription(t(`${Q}.sets.motifs.blocked`))
  })

  it('allows them with a regulated title among the questionnaire’s', async () => {
    current = mySubmission({ values: { professional: { professions: [{ title_id: IDS.psychologue, licence_number: '12345', is_primary: true }] } } })
    renderPage('motifs')
    expect(await openMotifs()).toBeEnabled()
  })

  it('leaves them to the database when the titles are not asked', async () => {
    current = mySubmission({ kind: 'update', requested_sections: ['motifs'], prefill: {}, values: {} })
    renderPage('motifs')
    expect(await openMotifs()).toBeEnabled()
  })
})

describe('QuestionnairePage — consent and review', () => {
  it('shows the signature’s time as the database answers it', async () => {
    mocks.self.signMyConsent.mockResolvedValue('2026-10-08T16:03:00.000+00:00')
    renderPage('consentement')
    await stepTitle('consent')
    await userEvent.click(screen.getByRole('checkbox', { name: t(`${Q}.consent.agree`) }))
    await userEvent.type(screen.getByRole('textbox', { name: required(t(`${Q}.consent.name`)) }), 'Felix Gauthier')
    await userEvent.click(screen.getByRole('button', { name: t(`${Q}.consent.signAndContinue`) }))
    await stepTitle('review')
    expect(
      screen.getByText(t(`${Q}.consent.signed`, { date: formatClinicDateTime('2026-10-08T16:03:00.000+00:00'), name: 'Felix Gauthier' })),
    ).toBeInTheDocument()
  })

  it('says sending waits for the clinic’s text when none is published', async () => {
    current = mySubmission({ consent: null })
    renderPage('consentement')
    await stepTitle('consent')
    expect(screen.getByText(t(`${Q}.consent.none`))).toBeInTheDocument()
  })

  it('reads « Signé (version n) » on a sent profile once the clinic published a newer text', async () => {
    current = mySubmission({
      status: 'submitted',
      submitted_at: '2026-10-08T15:00:00Z',
      values: COMPLETE_VALUES,
      private: SAVED_PRIVATE,
      consent: { id: '00000000-0000-4000-8000-00000000c002', version: 2, title: 'Consentement au droit à l’image', body: 'Texte 2' },
      signed_consent_version: 1,
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: t(`${Q}.states.submitted.pageTitle`) })
    expect(
      screen.getByText(t(`${Q}.review.signedVersion`, { version: '1', date: formatClinicDateTime('2026-10-08T14:00:00Z'), name: 'Félix Gauthier' })),
    ).toBeInTheDocument()
    expect(screen.queryByText(t(`${Q}.review.notSigned`))).not.toBeInTheDocument()
  })

  it('reads a prefilled section never confirmed « À confirmer »', async () => {
    renderPage('revision')
    await stepTitle('review')
    const languages = screen.getByRole('region', { name: t(`${Q}.steps.languages.title`) })
    expect(within(languages).getByText(t(`${Q}.review.toConfirm`))).toBeInTheDocument()
    expect(within(languages).getByRole('button', { name: t(`${Q}.review.confirmActionLabel`, { step: t(`${Q}.steps.languages.title`) }) })).toBeInTheDocument()
    const motifs = screen.getByRole('region', { name: t(`${Q}.steps.motifs.title`) })
    expect(within(motifs).getByText(t(`${Q}.review.incomplete`))).toBeInTheDocument()
  })
})
