import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { professionalKeys } from '../../../hooks/keys'
import { IDS } from '../../../test/fixtures'
import { recordFixture } from '../../../test/fixtures-domain'
import { INSURANCE_FILE, REVIEW_CHANGED_FIELDS, SUBMISSION_ID, SUBMISSIONS_JSON, submissionReview, submissionReviewWithFields } from '../../../test/fixtures-review'
import { documentsFixture } from '../../../test/fixtures-documents'
import { renderRecordTab } from '../../../test/record-tab'
import { DocumentsTab } from './DocumentsTab'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  submissions: {
    fetchProfessionalSubmissions: vi.fn(),
    fetchSubmissionReview: vi.fn(),
    applyProfessionalSubmission: vi.fn(),
    rejectProfessionalSubmission: vi.fn(),
    cancelProfessionalSubmission: vi.fn(),
  },
  private: { fetchProfessionalPrivate: vi.fn() },
  documents: { fetchProfessionalDocuments: vi.fn() },
  contracts: { fetchProfessionalContract: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('../../../api/submissions', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/submissions')>()), ...mocks.submissions }))
// The contract card atop the tab (Task 4d.3) has its own tests (ContractCard.test.tsx): none sent here.
vi.mock('../../../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/contracts')>()), ...mocks.contracts }))
vi.mock('../../../api/private', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/private')>()), ...mocks.private }))
vi.mock('../../../api/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/documents')>()), ...mocks.documents }))
vi.mock('@/core/storage/hooks', () => ({ useSignedFileUrl: () => ({ data: { url: 'https://files.test/x' }, isError: false, refetch: vi.fn() }) }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.professionals.submission.card'
const S = 'modules.professionals.submission.sheet'
const V = 'modules.professionals.submission.values'
const F = 'modules.professionals.submission.fields'

beforeEach(() => {
  mocks.submissions.fetchSubmissionReview.mockResolvedValue(submissionReview())
  mocks.private.fetchProfessionalPrivate.mockResolvedValue({ bankAccountLast4: '4567', sinLast3: null })
  mocks.documents.fetchProfessionalDocuments.mockResolvedValue(documentsFixture())
  mocks.contracts.fetchProfessionalContract.mockResolvedValue({ publishedVersion: null, clinicSigner: false, request: null })
})
afterEach(() => vi.clearAllMocks())

/** The submissions of SUBMISSIONS_JSON, parsed as the API does. */
function listed(over: Record<string, unknown>[] = []) {
  const json = SUBMISSIONS_JSON.map((row, i) => ({ ...row, ...over[i] }) as (typeof SUBMISSIONS_JSON)[number])
  return json.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    requestedSections: r.requested_sections,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewedByName: r.reviewed_by_name,
    decisionNote: r.decision_note,
    returned: r.returned,
    appliedCount: r.applied_count,
    startedByProfessional: r.started_by_professional,
  }))
}

interface TabOptions {
  role?: 'admin_assistant' | 'counselor' | 'admin'
  list?: unknown[]
  record?: ReturnType<typeof recordFixture>
}

async function openTab({ role = 'admin_assistant', list = listed(), record = recordFixture() }: TabOptions = {}) {
  mocks.submissions.fetchProfessionalSubmissions.mockResolvedValue(list)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  const rendered = renderRecordTab(<DocumentsTab />, { record, role })
  await screen.findByText(t(`${C}.title`))
  await waitFor(() => expect(screen.queryByText(t('common.loading'))).not.toBeInTheDocument())
  return rendered
}

async function openSheet(options: TabOptions & { summary?: string } = {}) {
  const rendered = await openTab(options)
  await userEvent.click(await screen.findByRole('button', { name: t(`${C}.reviewLabel`, { kind: t('modules.professionals.submission.kinds.onboarding') }) }))
  const sheet = await screen.findByRole('dialog', { name: t(`${S}.title`, { name: 'Marie Tremblay' }) })
  await within(sheet).findByText(options.summary ?? t(`${S}.summary`, { count: String(REVIEW_CHANGED_FIELDS.length) }))
  return { ...rendered, sheet }
}

/** « Questionnaire et mises à jour »'s list (the documents have lists of their own). */
const submissionsList = () => screen.getByRole('list', { name: t(`${C}.title`) })

const applyAll = () => screen.getByRole('button', { name: t(`${S}.apply`, { count: String(REVIEW_CHANGED_FIELDS.length) }) })

describe('« Questionnaire et mises à jour »', () => {
  it('lists the submissions newest first, each with its state in words and its dates in the clinic’s time', async () => {
    await openTab()
    const items = within(submissionsList()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(t('modules.professionals.submission.kinds.onboarding'))
    expect(items[0]).toHaveTextContent(t('modules.professionals.submission.states.onboarding.to_review'))
    expect(items[0]).toHaveTextContent('Envoyé le 08 oct. 2026')
    // « Mise à jour du profil » is feminine: every state and date agrees with it (P4-377).
    expect(items[1]).toHaveTextContent('Appliquée')
    expect(items[1]).toHaveTextContent('Envoyée le 02 sept. 2026')
    expect(items[1]).toHaveTextContent('Approuvée le 03 sept. 2026 par Julie Adjointe')
    expect(items[1]).toHaveTextContent(t(`${C}.changesOne`))
    expect(items[1]).toHaveTextContent(t(`${C}.sections`, { sections: 'Motifs' }))
    // Marie started that update herself (P4-375).
    expect(items[1]).toHaveTextContent('Commencée par Marie')
  })

  it('an update the clinic asked for says so; an update sent back or closed agrees with « la mise à jour »', async () => {
    await openTab({
      list: listed([
        { kind: 'update', status: 'draft', requested_sections: ['languages'], started_by_professional: false, reviewed_at: '2026-10-08T16:00:00+00:00', reviewed_by_name: 'Julie Adjointe', decision_note: 'Précisez vos langues.', returned: true },
        { status: 'cancelled', reviewed_at: null, reviewed_by_name: null, applied_count: null },
      ]),
    })
    const [first, second] = within(submissionsList()).getAllByRole('listitem') as HTMLElement[]
    expect(first).toHaveTextContent(t(`${C}.origin.clinic`))
    expect(first).toHaveTextContent('Renvoyée au professionnel')
    expect(first).toHaveTextContent('Renvoyée le 08 oct. 2026 par Julie Adjointe')
    expect(second).toHaveTextContent('Fermée sans être appliquée')
  })

  it('« Fermer la demande » closes an open update after a confirmation (P4-421); never on the onboarding', async () => {
    mocks.submissions.cancelProfessionalSubmission.mockResolvedValue(undefined)
    await openTab({
      list: listed([
        { kind: 'update', status: 'draft', submitted_at: null, requested_sections: ['languages'], started_by_professional: false },
        { kind: 'onboarding', status: 'submitted' },
      ]),
    })
    const [update, onboarding] = within(submissionsList()).getAllByRole('listitem') as [HTMLElement, HTMLElement]
    expect(within(onboarding).queryByRole('button', { name: t(`${C}.cancel`) })).not.toBeInTheDocument()
    await userEvent.click(within(update).getByRole('button', { name: t(`${C}.cancel`) }))
    const confirm = await screen.findByRole('alertdialog', { name: t('modules.professionals.submission.cancelDialog.title', { name: 'Marie Tremblay' }) })
    await userEvent.click(within(confirm).getByRole('button', { name: t('modules.professionals.submission.cancelDialog.confirm') }))
    await waitFor(() => expect(mocks.submissions.cancelProfessionalSubmission).toHaveBeenCalledWith(SUBMISSIONS_JSON[0]?.id))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.submission.toasts.cancelled', { firstName: 'Marie' }))
  })

  it('« Fermer la demande » is not offered to the conseillère (no professionals.invite)', async () => {
    await openTab({ role: 'counselor', list: listed([{ kind: 'update', status: 'submitted', requested_sections: ['languages'] }]) })
    expect(screen.queryByRole('button', { name: t(`${C}.cancel`) })).not.toBeInTheDocument()
  })

  it('shows the note of a profile sent back', async () => {
    await openTab({
      list: listed([{ status: 'draft', submitted_at: '2026-10-08T14:00:00+00:00', reviewed_at: '2026-10-08T16:00:00+00:00', reviewed_by_name: 'Julie Adjointe', decision_note: 'Précisez vos langues.', returned: true }]),
    })
    const first = within(submissionsList()).getAllByRole('listitem')[0] as HTMLElement
    expect(first).toHaveTextContent('Renvoyé au professionnel')
    expect(first).toHaveTextContent('Précisez vos langues.')
    expect(within(first).queryByRole('button')).not.toBeInTheDocument()
  })

  it('the conseillère reads that a profile was sent back, never the note (professionals.review only, P4-474)', async () => {
    await openTab({
      role: 'counselor',
      list: listed([{ status: 'draft', submitted_at: '2026-10-08T14:00:00+00:00', reviewed_at: '2026-10-08T16:00:00+00:00', reviewed_by_name: 'Julie Adjointe', decision_note: null, returned: true }]),
    })
    const first = within(submissionsList()).getAllByRole('listitem')[0] as HTMLElement
    expect(first).toHaveTextContent('Renvoyé au professionnel')
    expect(first).toHaveTextContent('Renvoyé le 08 oct. 2026 par Julie Adjointe')
    expect(first).not.toHaveTextContent(t(`${C}.note`))
  })

  it('offers « Réviser » to reviewers only, never on their own file (P4-304)', async () => {
    await openTab({ role: 'counselor' })
    expect(screen.queryByRole('button', { name: /Réviser/ })).not.toBeInTheDocument()
    cleanup()
    // The file's account is the reviewer's own (testAccess's user).
    const own = recordFixture()
    await openTab({ record: { ...own, professional: { ...own.professional, profileId: 'u1' } } })
    expect(screen.queryByRole('button', { name: /Réviser/ })).not.toBeInTheDocument()
    expect(screen.getByText(t(`${C}.ownFile`))).toBeInTheDocument()
  })

  it('says when nothing was sent yet', async () => {
    await openTab({ list: [] })
    expect(screen.getByText(t(`${C}.empty.title`))).toBeInTheDocument()
  })
})

describe('SubmissionReviewSheet', () => {
  it('asks before closing with a typed « Renvoyer » note, and keeps it on « Continuer la note »', async () => {
    const { sheet } = await openSheet()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.return`) }))
    await userEvent.type(within(sheet).getByRole('textbox', { name: new RegExp(t(`${S}.noteLabel`, { firstName: 'Marie' })) }), 'Précisez vos langues.')
    await userEvent.keyboard('{Escape}')
    const ask = await screen.findByRole('alertdialog', { name: t(`${S}.discardNote.title`) })
    await userEvent.click(within(ask).getByRole('button', { name: t(`${S}.discardNote.keep`) }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: t(`${S}.title`, { name: 'Marie Tremblay' }) })).toBeInTheDocument()
    expect(within(sheet).getByRole('textbox', { name: new RegExp(t(`${S}.noteLabel`, { firstName: 'Marie' })) })).toHaveValue('Précisez vos langues.')
  })

  it('shows each changed field as « Actuel / Proposé », checked, and folds the unchanged ones', async () => {
    const { sheet } = await openSheet()
    const phone = within(sheet).getByRole('checkbox', { name: t(`${F}.personal_phone`) })
    expect(phone).toBeChecked()
    const phoneRow = phone.closest('li') as HTMLElement
    expect(within(phoneRow).getByText(t(`${V}.current`))).toBeInTheDocument()
    expect(phoneRow).toHaveTextContent('514 555-1234')
    expect(phoneRow).toHaveTextContent('514 555-9876')
    expect(phoneRow).toHaveTextContent(t(`${V}.changed`))
    // Unchanged fields have no checkbox; they are folded under « Voir les champs inchangés ».
    expect(within(sheet).queryByRole('checkbox', { name: t(`${F}.postal_code`) })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.showUnchanged`, { count: '4' }) }))
    expect(within(sheet).getByText('H2X 1Y4', { exact: false })).toBeVisible()
    expect(within(sheet).getAllByText(t(`${V}.notAnswered`), { exact: false }).length).toBeGreaterThan(0)
  })

  it('names the motifs added and removed, by category; never an id', async () => {
    const { sheet } = await openSheet()
    const motifs = within(sheet).getByRole('checkbox', { name: t(`${F}.motif_ids`) }).closest('li') as HTMLElement
    expect(motifs).toHaveTextContent(t(`${V}.added`, { count: '1' }))
    expect(motifs).toHaveTextContent('Vie intérieure')
    expect(motifs).toHaveTextContent('Psychose')
    expect(motifs).toHaveTextContent(t(`${V}.removed`, { count: '1' }))
    expect(motifs).toHaveTextContent('Anxiété')
    expect(sheet.textContent).not.toContain(IDS.psychose)
    const clienteles = within(sheet).getByRole('checkbox', { name: t(`${F}.clienteles`) }).closest('li') as HTMLElement
    expect(clienteles).toHaveTextContent('Aînés (65 ans et plus)')
    expect(clienteles).toHaveTextContent(t(`${V}.unstarred`))
  })

  it('says files, titles and the consent in words: the insurance’s expiry and its file, the titles side by side', async () => {
    const { sheet } = await openSheet()
    const insurance = within(sheet).getByRole('checkbox', { name: t(`${F}.insurance`) }).closest('li') as HTMLElement
    expect(insurance).toHaveTextContent(t(`${V}.insuranceSent`, { date: '31 mars 2027' }))
    // A new tab, said to screen readers (« (nouvel onglet) ») and shown by an icon.
    const open = within(insurance).getByRole('link', { name: `${t(`${V}.openFile`)} ${t(`${V}.newTab`)}` })
    expect(open).toHaveAttribute('href', 'https://files.test/x')
    expect(open).toHaveAttribute('target', '_blank')
    // A valid insurance and the latest consent text: no warning.
    expect(insurance).not.toHaveTextContent(/échue/)
    const photo = within(sheet).getByRole('checkbox', { name: t(`${F}.photo`) }).closest('li') as HTMLElement
    expect(within(photo).getByRole('img', { name: t(`${V}.photoAlt`) })).toBeInTheDocument()
    const titles = within(sheet).getByRole('checkbox', { name: t(`${F}.professions`) }).closest('li') as HTMLElement
    expect(titles).toHaveTextContent('Psychologue · OPQ 12345')
    expect(titles).toHaveTextContent('Naturopathe')
    const consent = within(sheet).getByRole('checkbox', { name: t(`${F}.consent`) }).closest('li') as HTMLElement
    expect(consent).toHaveTextContent(t(`${V}.consentNone`))
    expect(consent).toHaveTextContent('par Marie Tremblay (version 1)')
  })

  it('never shows a private value: « Modifié », and the file’s mask only for whoever reads the masks', async () => {
    const { sheet } = await openSheet()
    const account = within(sheet).getByRole('checkbox', { name: t(`${F}.bank_account`) }).closest('li') as HTMLElement
    expect(account).toHaveTextContent(t(`${V}.privateSent`))
    expect(account).toHaveTextContent(t(`${V}.privateHidden`))
    // The adjointe has no professionals.private: no masks requested.
    expect(mocks.private.fetchProfessionalPrivate).not.toHaveBeenCalled()
    cleanup()
    const admin = await openSheet({ role: 'admin' })
    const adminAccount = within(admin.sheet).getByRole('checkbox', { name: t(`${F}.bank_account`) }).closest('li') as HTMLElement
    await waitFor(() => expect(adminAccount).toHaveTextContent(t(`${V}.maskAccount`, { last4: '4567' })))
  })

  it('applies the checked fields, says how many in the button, and refreshes the file', async () => {
    mocks.submissions.applyProfessionalSubmission.mockResolvedValue(undefined)
    const { sheet, invalidated } = await openSheet()
    const total = REVIEW_CHANGED_FIELDS.length
    expect(within(sheet).getByRole('button', { name: t(`${S}.apply`, { count: String(total) }) })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: t(`${F}.city`) }))
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.apply`, { count: String(total - 1) }) }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.submissions.applyProfessionalSubmission).toHaveBeenCalledExactlyOnceWith(
      SUBMISSION_ID,
      REVIEW_CHANGED_FIELDS.filter((f) => f !== 'city'),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.submission.toasts.applied.onboarding', { count: String(total - 1) }))
    expect(invalidated()).toEqual(expect.arrayContaining([professionalKeys.record(IDS.professional), professionalKeys.lists(), professionalKeys.history(IDS.professional)]))
  })

  it('with nothing checked: says what to do instead of approving silently', async () => {
    const { sheet } = await openSheet()
    for (const field of REVIEW_CHANGED_FIELDS) await userEvent.click(within(sheet).getByRole('checkbox', { name: t(`${F}.${field}`) }))
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.apply`, { count: '0' }) }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent(t(`${S}.noneChecked`))
    expect(mocks.submissions.applyProfessionalSubmission).not.toHaveBeenCalled()
  })

  it('« Renvoyer au professionnel » requires a note, then sends it back and says so', async () => {
    mocks.submissions.rejectProfessionalSubmission.mockResolvedValue(undefined)
    const { sheet } = await openSheet()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.return`) }))
    const note = within(sheet).getByRole('textbox', { name: new RegExp(t(`${S}.noteLabel`, { firstName: 'Marie' })) })
    expect(note).toHaveFocus()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.sendBack`) }))
    expect(within(sheet).getByText(t(`${S}.noteRequired`, { firstName: 'Marie' }))).toBeInTheDocument()
    expect(mocks.submissions.rejectProfessionalSubmission).not.toHaveBeenCalled()
    await userEvent.type(note, '  Précisez vos langues.  ')
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.sendBack`) }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.submissions.rejectProfessionalSubmission).toHaveBeenCalledExactlyOnceWith(SUBMISSION_ID, 'Précisez vos langues.')
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.submission.toasts.returned', { firstName: 'Marie' }))
  })

  it('a refusal stays in the sheet with its sentence; one decided elsewhere leaves « Fermer » only', async () => {
    mocks.submissions.applyProfessionalSubmission.mockRejectedValueOnce({
      code: 'P0001',
      message: 'Cette assurance est échue depuis l’envoi du profil.',
      hint: 'Renvoyez le profil au professionnel : il joindra une preuve en vigueur.',
    })
    const { sheet } = await openSheet()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.apply`, { count: String(REVIEW_CHANGED_FIELDS.length) }) }))
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent('Cette assurance est échue depuis l’envoi du profil.')
    expect(alert).toHaveTextContent('Renvoyez le profil au professionnel')
    expect(within(sheet).getByRole('button', { name: t(`${S}.return`) })).toBeInTheDocument()

    mocks.submissions.applyProfessionalSubmission.mockRejectedValueOnce({ code: 'P0001', message: 'Cette soumission n’attend pas de révision.', hint: 'status' })
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.apply`, { count: String(REVIEW_CHANGED_FIELDS.length) }) }))
    await within(sheet).findByText('Cette soumission n’attend pas de révision.')
    expect(within(sheet).queryByRole('button', { name: t(`${S}.return`) })).not.toBeInTheDocument()
    expect(within(sheet).getByText(t('common.close'), { selector: 'button' })).toBeInTheDocument()
  })

  it('says the kind and the date in agreement: « Questionnaire d’accueil envoyé le … »', async () => {
    const { sheet } = await openSheet()
    expect(sheet).toHaveAccessibleDescription("Questionnaire d'accueil envoyé le 08 oct. 2026 à 10:00.")
  })

  // P4-378: what « Appliquer » would refuse is said on the field first (the database still decides).
  it('flags an insurance already expired and a consent signed on an older text, before « Appliquer »', async () => {
    mocks.submissions.fetchSubmissionReview.mockResolvedValue(
      submissionReviewWithFields({
        insurance: { submitted: { file_id: INSURANCE_FILE, expires_on: '2020-03-31' } },
        consent: { submitted: { consent_version_id: '00000000-0000-4000-8000-00000000c001', signer_name: 'Marie Tremblay', signed_at: '2026-10-08T13:58:00+00:00', version: 1, is_latest: false } },
      }),
    )
    const { sheet } = await openSheet()
    const insurance = within(sheet).getByRole('checkbox', { name: t(`${F}.insurance`) })
    expect(insurance.closest('li')).toHaveTextContent(t(`${S}.warnings.insuranceExpired`, { date: '31 mars 2020' }))
    expect(insurance).toHaveAccessibleDescription(expect.stringContaining('Cette assurance est échue depuis le 31 mars 2020'))
    const consent = within(sheet).getByRole('checkbox', { name: t(`${F}.consent`) })
    expect(consent.closest('li')).toHaveTextContent(t(`${S}.warnings.consentOutdated`))
    // Still checked: the reviewer decides; the server refuses if she applies it anyway.
    expect(insurance).toBeChecked()
  })

  // P4-363: no change proposed at all is a decision of its own, sent as an empty list (never null).
  it('« Approuver sans changement » sends an empty list of fields', async () => {
    mocks.submissions.fetchSubmissionReview.mockResolvedValue(submissionReviewWithFields({}, { changed: false }))
    mocks.submissions.applyProfessionalSubmission.mockResolvedValue(undefined)
    const { sheet } = await openSheet({ summary: t(`${S}.noChange`) })
    expect(within(sheet).queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.approveUnchanged`) }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.submissions.applyProfessionalSubmission).toHaveBeenCalledExactlyOnceWith(SUBMISSION_ID, [])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.submission.toasts.approvedUnchanged.onboarding'))
  })

  it('the reviewer’s own file (HINT submission): the sentence, then « Fermer » only', async () => {
    mocks.submissions.applyProfessionalSubmission.mockRejectedValueOnce({ code: 'P0001', message: 'Vous ne pouvez pas réviser votre propre profil.', hint: 'submission' })
    const { sheet } = await openSheet()
    await userEvent.click(applyAll())
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent('Vous ne pouvez pas réviser votre propre profil.')
    // A routing HINT is never shown as text.
    expect(alert).not.toHaveTextContent(/submission/)
    expect(within(sheet).queryByRole('button', { name: t(`${S}.return`) })).not.toBeInTheDocument()
    expect(within(sheet).getByText(t('common.close'), { selector: 'button' })).toBeInTheDocument()
  })

  it('the SIN no longer collected (HINT sin): the sentence, and the reviewer can still decide', async () => {
    mocks.submissions.applyProfessionalSubmission.mockRejectedValueOnce({ code: 'P0001', message: 'La collecte du NAS n’est pas activée.', hint: 'sin' })
    const { sheet } = await openSheet()
    await userEvent.click(applyAll())
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent('La collecte du NAS n’est pas activée.')
    expect(alert).not.toHaveTextContent(/\bsin\b/)
    expect(within(sheet).getByRole('button', { name: t(`${S}.return`) })).toBeInTheDocument()
    expect(applyAll()).toBeInTheDocument()
  })

  it('a refused send-back stays in the note form; one decided elsewhere leaves « Fermer » only', async () => {
    mocks.submissions.rejectProfessionalSubmission.mockRejectedValueOnce({ code: 'P0001', message: 'La note compte au plus 1000 caractères.', hint: 'note' })
    const { sheet } = await openSheet()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.return`) }))
    const note = within(sheet).getByRole('textbox', { name: new RegExp(t(`${S}.noteLabel`, { firstName: 'Marie' })) })
    await userEvent.type(note, 'Précisez vos langues.')
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.sendBack`) }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('La note compte au plus 1000 caractères.')
    // The note stays, and so do the buttons.
    expect(note).toHaveValue('Précisez vos langues.')
    expect(within(sheet).getByRole('button', { name: t(`${S}.sendBack`) })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    mocks.submissions.rejectProfessionalSubmission.mockRejectedValueOnce({ code: 'P0001', message: 'Cette soumission n’attend pas de révision.', hint: 'status' })
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.sendBack`) }))
    await within(sheet).findByText('Cette soumission n’attend pas de révision.')
    expect(within(sheet).queryByRole('button', { name: t(`${S}.sendBack`) })).not.toBeInTheDocument()
    expect(within(sheet).getByText(t('common.close'), { selector: 'button' })).toBeInTheDocument()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('a submission no longer waiting: read-only, « Fermer »', async () => {
    mocks.submissions.fetchSubmissionReview.mockResolvedValue(submissionReview({ status: 'approved' }))
    await openTab()
    await userEvent.click(await screen.findByRole('button', { name: t(`${C}.reviewLabel`, { kind: t('modules.professionals.submission.kinds.onboarding') }) }))
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText(t(`${S}.notWaiting`))).toBeInTheDocument()
    expect(within(sheet).getByRole('checkbox', { name: t(`${F}.city`) })).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: t(`${S}.return`) })).not.toBeInTheDocument()
  })
})
