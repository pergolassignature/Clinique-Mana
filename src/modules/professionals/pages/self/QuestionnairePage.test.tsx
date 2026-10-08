import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { resetSuggestionsPause } from '@/core/address/availability'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import type { MySubmission } from '../../api/self'
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
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

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

function renderPage(step?: string) {
  const { queryClient } = setupQueryClient()
  const path = `/mon-profil/questionnaire${step ? `?etape=${step}` : ''}`
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <QuestionnairePage />
      </QueryClientProvider>,
      { path },
    ),
  )
  return queryClient
}

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
