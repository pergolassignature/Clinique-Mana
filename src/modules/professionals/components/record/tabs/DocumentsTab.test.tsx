import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { professionalKeys } from '../../../hooks/keys'
import { IDS } from '../../../test/fixtures'
import { recordFixture } from '../../../test/fixtures-domain'
import { REVIEW_CHANGED_FIELDS, SUBMISSION_ID, SUBMISSIONS_JSON, submissionReview } from '../../../test/fixtures-review'
import { renderRecordTab } from '../../../test/record-tab'
import { DocumentsTab } from './DocumentsTab'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  submissions: {
    fetchProfessionalSubmissions: vi.fn(),
    fetchSubmissionReview: vi.fn(),
    applyProfessionalSubmission: vi.fn(),
    rejectProfessionalSubmission: vi.fn(),
  },
  private: { fetchProfessionalPrivate: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('../../../api/submissions', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/submissions')>()), ...mocks.submissions }))
vi.mock('../../../api/private', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/private')>()), ...mocks.private }))
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
    appliedCount: r.applied_count,
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

async function openSheet(options: TabOptions = {}) {
  const rendered = await openTab(options)
  await userEvent.click(await screen.findByRole('button', { name: t(`${C}.reviewLabel`, { kind: t('modules.professionals.submission.kinds.onboarding') }) }))
  const sheet = await screen.findByRole('dialog', { name: t(`${S}.title`, { name: 'Marie Tremblay' }) })
  await within(sheet).findByText(t(`${S}.summary`, { count: String(REVIEW_CHANGED_FIELDS.length) }))
  return { ...rendered, sheet }
}

describe('« Questionnaire et mises à jour »', () => {
  it('lists the submissions newest first, each with its state in words and its dates in the clinic’s time', async () => {
    await openTab()
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(t('modules.professionals.submission.kinds.onboarding'))
    expect(items[0]).toHaveTextContent(t('modules.professionals.submission.states.to_review'))
    expect(items[0]).toHaveTextContent(t(`${C}.sentOn`, { date: '08 oct. 2026' }))
    expect(items[1]).toHaveTextContent(t('modules.professionals.submission.states.applied'))
    expect(items[1]).toHaveTextContent(t(`${C}.appliedOnBy`, { date: '03 sept. 2026', name: 'Julie Adjointe' }))
    expect(items[1]).toHaveTextContent(t(`${C}.changesOne`))
    expect(items[1]).toHaveTextContent(t(`${C}.sections`, { sections: 'Motifs' }))
  })

  it('shows the note of a profile sent back', async () => {
    await openTab({
      list: listed([{ status: 'draft', submitted_at: '2026-10-08T14:00:00+00:00', reviewed_at: '2026-10-08T16:00:00+00:00', reviewed_by_name: 'Julie Adjointe', decision_note: 'Précisez vos langues.' }]),
    })
    const first = within(screen.getByRole('list')).getAllByRole('listitem')[0] as HTMLElement
    expect(first).toHaveTextContent(t('modules.professionals.submission.states.returned'))
    expect(first).toHaveTextContent('Précisez vos langues.')
    expect(within(first).queryByRole('button')).not.toBeInTheDocument()
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
    expect(within(insurance).getByRole('link', { name: t(`${V}.openFile`) })).toHaveAttribute('href', 'https://files.test/x')
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
