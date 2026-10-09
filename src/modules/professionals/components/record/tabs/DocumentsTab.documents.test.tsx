import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { professionalCatalogKeys, professionalKeys } from '../../../hooks/keys'
import { IDS } from '../../../test/fixtures'
import { CONSENT_JSON, CV_JSON, DOC_IDS, documentJson, documentsFixture, PHOTO_JSON, stagedJson } from '../../../test/fixtures-documents'
import { recordFixture } from '../../../test/fixtures-domain'
import { renderRecordTab } from '../../../test/record-tab'
import { DocumentsTab } from './DocumentsTab'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  submissions: { fetchProfessionalSubmissions: vi.fn() },
  documents: {
    fetchProfessionalDocuments: vi.fn(),
    uploadProfessionalDocument: vi.fn(),
    verifyProfessionalDocument: vi.fn(),
    rejectProfessionalDocument: vi.fn(),
    setProfessionalDocumentExpiry: vi.fn(),
    deleteProfessionalDocument: vi.fn(),
    documentDownloadUrl: vi.fn(),
  },
  signedUrl: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('../../../api/submissions', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/submissions')>()), ...mocks.submissions }))
vi.mock('../../../api/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/documents')>()), ...mocks.documents }))
vi.mock('@/core/storage/hooks', () => ({
  useSignedFileUrl: (fileId: string | null) => {
    mocks.signedUrl(fileId)
    return { data: fileId ? { url: `about:blank#${fileId}` } : undefined, isPending: false, isError: false, error: null, refetch: vi.fn() }
  },
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const D = 'modules.professionals.documents'
const INSURANCE = "Preuve d'assurance responsabilité"
const PHOTO = 'Photo professionnelle'
const CONSENT = "Consentement droit à l'image"

beforeEach(() => {
  mocks.submissions.fetchProfessionalSubmissions.mockResolvedValue([])
  mocks.documents.documentDownloadUrl.mockResolvedValue('about:blank#download')
})
afterEach(() => vi.clearAllMocks())

type Role = 'admin' | 'admin_assistant' | 'counselor'

async function openTab({ role = 'admin', documents = documentsFixture(), record = recordFixture() }: { role?: Role; documents?: ReturnType<typeof documentsFixture>; record?: ReturnType<typeof recordFixture> } = {}) {
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  mocks.documents.fetchProfessionalDocuments.mockResolvedValue(documents)
  const rendered = renderRecordTab(<DocumentsTab />, { record, role })
  await screen.findByRole('heading', { name: t(`${D}.required.title`) })
  return rendered
}

/** A required type's card (a region named by its heading). */
const card = (name: string) => screen.getByRole('region', { name })
const stateOf = (name: string) => card(name).querySelector('[data-type-state]')?.textContent

describe('Documents tab — states by the clinic’s date', () => {
  it('says each required type in words, the summary « 3 sur 3 », and the e-consent on the consent card', async () => {
    await openTab()
    expect(screen.getByText(t(`${D}.required.summary`, { done: '3', total: '3' }))).toBeInTheDocument()
    expect(stateOf(INSURANCE)).toBe("Valide jusqu'au 31 mars 2027")
    expect(stateOf(PHOTO)).toBe(t(`${D}.state.verified`))
    expect(stateOf(CONSENT)).toBe("Valide jusqu'au 8 octobre 2027")
    expect(card(CONSENT)).toHaveTextContent('Signé électroniquement le 08 oct. 2026 par Marie Tremblay (version 1)')
    // The insurance's row: who sent it, who verified it.
    expect(card(INSURANCE)).toHaveTextContent('Téléversé le 01 oct. 2026 par Marie · Vérifié le 02 oct. 2026 par Julie Adjointe')
  })

  it('« Expire le … » within the insurance’s reminder window (7 days), « Expiré » the day after its last day', async () => {
    await openTab({ documents: documentsFixture({ today: '2027-03-23' }) })
    expect(stateOf(INSURANCE)).toBe("Valide jusqu'au 31 mars 2027")
    cleanup()
    await openTab({ documents: documentsFixture({ today: '2027-03-24' }) })
    expect(stateOf(INSURANCE)).toBe('Expire le 31 mars 2027')
    cleanup()
    await openTab({ documents: documentsFixture({ today: '2027-03-31' }) })
    expect(stateOf(INSURANCE)).toBe('Expire le 31 mars 2027')
    cleanup()
    await openTab({ documents: documentsFixture({ today: '2027-04-01' }) })
    expect(stateOf(INSURANCE)).toBe("Expiré : valide jusqu'au 31 mars 2027")
    expect(screen.getByText(t(`${D}.required.summary`, { done: '2', total: '3' }))).toBeInTheDocument()
  })

  it('« Manquant », « À vérifier » and « Refusé » with its reason; an e-consent past its date no longer counts', async () => {
    await openTab({
      documents: documentsFixture({
        documents: [
          documentJson({ status: 'pending', reviewed_at: null, reviewed_by_name: null }),
          documentJson({ id: DOC_IDS.refused, type_id: IDS.photoType, type_key: 'photo', status: 'rejected', expires_on: null, rejection_reason: 'Photo floue.', file: null }),
        ],
        consent: { ...CONSENT_JSON, expires_on: '2026-10-08' },
      }),
    })
    expect(stateOf(INSURANCE)).toBe(t(`${D}.state.pending`))
    expect(stateOf(PHOTO)).toBe(t(`${D}.state.rejected`))
    expect(card(PHOTO)).toHaveTextContent('Raison : Photo floue.')
    expect(stateOf(CONSENT)).toBe(t(`${D}.state.missing`))
    expect(card(CONSENT)).not.toHaveTextContent('Signé électroniquement')
    // The one waiting is said next to the count (P4-495).
    expect(screen.getByText('Documents requis en règle : 0 sur 3 · 1 en attente de vérification')).toBeInTheDocument()
  })

  it('sent with the questionnaire: « Dans le questionnaire à réviser », a link up to it, never « Manquant » (P4-495)', async () => {
    const user = userEvent.setup()
    const staged = [
      stagedJson(),
      stagedJson({ type_key: 'insurance', kind: 'insurance' }),
      stagedJson({ type_key: 'image_consent', kind: 'consent' }),
    ]
    await openTab({ documents: documentsFixture({ documents: [], consent: null, staged }) })
    expect(stateOf(PHOTO)).toBe('Dans le questionnaire à réviser (envoyé le 08 oct. 2026)')
    expect(stateOf(INSURANCE)).toBe('Dans le questionnaire à réviser (envoyé le 08 oct. 2026)')
    expect(stateOf(CONSENT)).toBe('Signé dans le questionnaire à réviser (envoyé le 08 oct. 2026)')
    expect(card(PHOTO)).not.toHaveTextContent(t(`${D}.lines.none`))
    expect(screen.getByText('Documents requis en règle : 0 sur 3 · 3 en attente de vérification')).toBeInTheDocument()
    // Staff keep « Téléverser ».
    expect(within(card(PHOTO)).getByRole('button', { name: `Téléverser : ${PHOTO}` })).toBeInTheDocument()
    // « Voir le questionnaire à réviser » brings « Questionnaire et mises à jour » into focus.
    await user.click(within(card(INSURANCE)).getByRole('button', { name: t(`${D}.lines.showReview`) }))
    expect(document.activeElement).toHaveTextContent(t('modules.professionals.submission.card.title'))
  })

  it('a draft not sent: staff read the card as is', async () => {
    await openTab({ documents: documentsFixture({ documents: [], consent: null, staged: [stagedJson({ status: 'draft', submitted_at: null })] }) })
    expect(stateOf(PHOTO)).toBe(t(`${D}.state.missing`))
    expect(within(card(PHOTO)).queryByRole('button', { name: t(`${D}.lines.showReview`) })).not.toBeInTheDocument()
  })

  it('a renewal waiting under a valid insurance reads « Nouveau document », and older ones fold away', async () => {
    await openTab({
      documents: documentsFixture({
        documents: [
          documentJson({ id: DOC_IDS.insuranceRenewal, status: 'pending', expires_on: '2028-03-31', reviewed_at: null, reviewed_by_name: null, file: { id: DOC_IDS.renewalFile, name: 'assurance-2027.pdf', mime_type: 'application/pdf', size_bytes: 1000 } }),
          documentJson(),
          documentJson({ id: DOC_IDS.insuranceOld, status: 'expired', expires_on: '2026-03-31', file: { id: DOC_IDS.oldFile, name: 'assurance-2025.pdf', mime_type: 'application/pdf', size_bytes: 1000 } }),
          PHOTO_JSON,
        ],
      }),
    })
    const insurance = within(card(INSURANCE))
    expect(insurance.getAllByRole('listitem')).toHaveLength(2)
    expect(insurance.getAllByRole('listitem')[0]).toHaveTextContent(`${t(`${D}.lines.newPending`)}${t(`${D}.state.pending`)}`)
    await userEvent.click(insurance.getByRole('button', { name: t(`${D}.older.show`, { count: '1' }) }))
    expect(insurance.getAllByRole('listitem')).toHaveLength(3)
    expect(insurance.getAllByRole('listitem')[2]).toHaveTextContent("Expiré : valide jusqu'au 31 mars 2026")
  })

  it('lists the other types under « Autres documents », a Word file with « Télécharger » only', async () => {
    await openTab({ documents: documentsFixture({ documents: [documentJson(), PHOTO_JSON, CV_JSON] }) })
    const others = within(screen.getByRole('list', { name: t(`${D}.others.title`) }))
    const [cv] = others.getAllByRole('listitem') as [HTMLElement]
    expect(cv).toHaveTextContent('CV')
    expect(cv).toHaveTextContent('Téléversé le 01 oct. 2026 par la clinique')
    expect(within(cv).queryByRole('button', { name: /^Aperçu/ })).not.toBeInTheDocument()
    expect(within(cv).getByRole('button', { name: /^Télécharger/ })).toBeInTheDocument()
  })
})

describe('Documents tab — actions by permission', () => {
  const pending = () => documentsFixture({ documents: [documentJson({ status: 'pending', reviewed_at: null, reviewed_by_name: null }), PHOTO_JSON] })

  it('the admin: Vérifier, Refuser on a pending document; Supprimer in « … »; « Téléverser » everywhere', async () => {
    await openTab({ documents: pending() })
    const insurance = within(card(INSURANCE))
    expect(insurance.getByRole('button', { name: /^Vérifier : / })).toBeInTheDocument()
    expect(insurance.getByRole('button', { name: /^Refuser : / })).toBeInTheDocument()
    await userEvent.click(insurance.getByRole('button', { name: /^Autres actions/ }))
    expect(await screen.findByRole('menuitem', { name: t(`${D}.actions.delete`) })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: t(`${D}.actions.redate`) })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: t(`${D}.actions.replaceLabel`, { type: PHOTO }) })).toBeInTheDocument()
    // The e-consent in force counts: « Remplacer » there too.
    expect(screen.getByRole('button', { name: t(`${D}.actions.replaceLabel`, { type: CONSENT }) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${D}.actions.uploadLabel`, { type: INSURANCE }) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${D}.actions.uploadOther`) })).toBeInTheDocument()
  })

  it('the adjointe verifies and refuses, but never deletes (professionals.documents.delete)', async () => {
    await openTab({ role: 'admin_assistant', documents: pending() })
    const insurance = within(card(INSURANCE))
    expect(insurance.getByRole('button', { name: /^Vérifier : / })).toBeInTheDocument()
    await userEvent.click(insurance.getByRole('button', { name: /^Autres actions/ }))
    await screen.findByRole('menuitem', { name: t(`${D}.actions.redate`) })
    expect(screen.queryByRole('menuitem', { name: t(`${D}.actions.delete`) })).not.toBeInTheDocument()
  })

  it('the conseillère reads: Aperçu and Télécharger, no upload, no review', async () => {
    await openTab({ role: 'counselor', documents: pending() })
    expect(screen.queryByRole('button', { name: /^(Vérifier|Refuser|Téléverser|Remplacer)/ })).not.toBeInTheDocument()
    expect(within(card(INSURANCE)).getByRole('button', { name: /^Aperçu : / })).toBeInTheDocument()
  })

  it('on one’s own record: no review and no deletion (P4-401), said once', async () => {
    const own = recordFixture()
    await openTab({ documents: pending(), record: { ...own, professional: { ...own.professional, profileId: 'u1' } } })
    expect(screen.getByText(t(`${D}.ownFile`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Vérifier|Refuser) : / })).not.toBeInTheDocument()
    // Aperçu and Télécharger only, side by side: no « … » (no Supprimer, no Modifier l'échéance).
    expect(within(card(INSURANCE)).getByRole('button', { name: /^Télécharger : / })).toBeInTheDocument()
    expect(within(card(INSURANCE)).queryByRole('button', { name: /^Autres actions/ })).not.toBeInTheDocument()
  })
})

describe('Documents tab — upload', () => {
  const pdf = () => new File([new TextEncoder().encode('%PDF-1.7\n')], 'assurance.pdf', { type: 'application/pdf' })
  const chooseFile = (file: File) => fireEvent.change(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]') as HTMLInputElement, { target: { files: [file] } })

  it('proposes the next March 31, sends the type, the date and the insurer, then says it is verified (a reviewer on another’s file)', async () => {
    mocks.documents.uploadProfessionalDocument.mockResolvedValue(DOC_IDS.insuranceRenewal)
    const { invalidated } = await openTab({ documents: documentsFixture({ documents: [PHOTO_JSON], consent: null }) })
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.uploadLabel`, { type: INSURANCE }) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${D}.upload.title`, { type: INSURANCE }) })
    const date = within(dialog).getByLabelText(new RegExp(t(`${D}.upload.expiresOn`)))
    expect(date).toHaveValue('2027-03-31')
    expect(within(dialog).getByText(t(`${D}.upload.verifiedAtOnce`))).toBeInTheDocument()
    expect(within(dialog).getByText('PDF, JPEG ou PNG, 10 Mo au plus.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(t(`${D}.upload.insurer`)), 'La Capitale')
    chooseFile(pdf())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.documents.uploadProfessionalDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ professionalId: IDS.professional, typeKey: 'insurance', mimeType: 'application/pdf', expiresOn: '2027-03-31', insurer: 'La Capitale', policyNumber: null, self: false }),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${D}.toasts.uploaded`))
    expect(invalidated()).toEqual(expect.arrayContaining([professionalKeys.record(IDS.professional), professionalKeys.lists(), professionalCatalogKeys.usage()]))
  })

  it('refuses a past date before sending anything, under the date', async () => {
    await openTab({ documents: documentsFixture({ documents: [PHOTO_JSON] }) })
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.uploadLabel`, { type: INSURANCE }) }))
    const dialog = await screen.findByRole('dialog')
    const date = within(dialog).getByLabelText(new RegExp(t(`${D}.upload.expiresOn`)))
    fireEvent.change(date, { target: { value: '2026-01-01' } })
    chooseFile(pdf())
    expect(await within(dialog).findAllByText(t(`${D}.upload.datePast`))).toHaveLength(2)
    expect(mocks.documents.uploadProfessionalDocument).not.toHaveBeenCalled()
  })

  it('an adjointe without the review right is told the document will wait; the type is chosen in « Téléverser un document »', async () => {
    mocks.documents.uploadProfessionalDocument.mockResolvedValue(DOC_IDS.cv)
    await openTab({ role: 'admin_assistant' })
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.uploadOther`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${D}.upload.titleAny`) })
    expect(within(dialog).getByText(t(`${D}.upload.chooseTypeFirst`))).toBeInTheDocument()
    const select = within(dialog).getByRole('combobox', { name: new RegExp(t(`${D}.upload.type`)) })
    // Required types first, then the others; never an archived one.
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([t(`${D}.upload.typePlaceholder`), PHOTO, INSURANCE, CONSENT, 'CV', 'Autre'])
    await userEvent.selectOptions(select, 'CV')
    expect(within(dialog).queryByLabelText(new RegExp(t(`${D}.upload.expiresOn`)))).not.toBeInTheDocument()
    chooseFile(pdf())
    await waitFor(() => expect(mocks.documents.uploadProfessionalDocument).toHaveBeenCalledWith(expect.objectContaining({ typeKey: 'cv', expiresOn: null })))
  })

  it('a refusal of the date by the database shows under it, and the dialog stays', async () => {
    mocks.documents.uploadProfessionalDocument.mockRejectedValue({ code: 'P0001', message: "L'échéance doit être aujourd'hui ou plus tard.", hint: 'expires_on' })
    await openTab({ documents: documentsFixture({ documents: [PHOTO_JSON] }) })
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.uploadLabel`, { type: INSURANCE }) }))
    const dialog = await screen.findByRole('dialog')
    chooseFile(pdf())
    expect(await within(dialog).findAllByText("L'échéance doit être aujourd'hui ou plus tard.")).toHaveLength(2)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Documents tab — review', () => {
  const pendingInsurance = () =>
    documentsFixture({ documents: [documentJson({ status: 'pending', expires_on: '2027-03-31', reviewed_at: null, reviewed_by_name: null }), PHOTO_JSON] })

  it('« Vérifier » with the date corrected', async () => {
    mocks.documents.verifyProfessionalDocument.mockResolvedValue(undefined)
    await openTab({ documents: pendingInsurance() })
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Vérifier : / }))
    const dialog = await screen.findByRole('alertdialog', { name: t(`${D}.verify.title`, { type: INSURANCE }) })
    const date = within(dialog).getByLabelText(new RegExp(t(`${D}.verify.expiresOn`)))
    expect(date).toHaveValue('2027-03-31')
    fireEvent.change(date, { target: { value: '2027-06-30' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.verify.confirm`) }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.documents.verifyProfessionalDocument).toHaveBeenCalledExactlyOnceWith(DOC_IDS.insurance, '2027-06-30')
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${D}.toasts.verified`))
  })

  it('« Vérifier » says before confirming that a past date makes it expired', async () => {
    await openTab({ documents: pendingInsurance() })
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Vérifier : / }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t(`${D}.verify.expiresOn`))), { target: { value: '2026-03-31' } })
    expect(within(dialog).getByText(t(`${D}.verify.pastNote`))).toBeInTheDocument()
  })

  it('« Refuser » asks for a reason, says the professional will be emailed, then says she was', async () => {
    mocks.documents.rejectProfessionalDocument.mockResolvedValue({ emailed: true, emailProblem: null })
    await openTab({ documents: pendingInsurance() })
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Refuser : / }))
    const dialog = await screen.findByRole('alertdialog', { name: t(`${D}.reject.title`, { type: INSURANCE }) })
    expect(dialog).toHaveTextContent(t(`${D}.reject.emailed`, { firstName: 'Marie' }))
    // Focus starts on the reason.
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: new RegExp(t(`${D}.reject.reason`)) })).toHaveFocus())
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.reject.confirm`) }))
    expect(within(dialog).getByText(t(`${D}.reject.reasonRequired`))).toBeInTheDocument()
    expect(mocks.documents.rejectProfessionalDocument).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(t(`${D}.reject.reason`)) }), '  Le document est illisible.  ')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.reject.confirm`) }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.documents.rejectProfessionalDocument).toHaveBeenCalledExactlyOnceWith(DOC_IDS.insurance, 'Le document est illisible.')
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${D}.toasts.rejectedEmailed`, { firstName: 'Marie' }))
  })

  it('« Refuser » a file the clinic sent: no email is promised (P4-451); an email that failed is a warning', async () => {
    mocks.documents.rejectProfessionalDocument.mockResolvedValue({ emailed: false, emailProblem: { code: 'provider_error', retryAfter: null } })
    await openTab({ documents: documentsFixture({ documents: [documentJson({ status: 'pending', uploaded_by_self: false, reviewed_at: null, reviewed_by_name: null }), PHOTO_JSON] }) })
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Refuser : / }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t(`${D}.reject.notEmailed`))
    await userEvent.type(within(dialog).getByRole('textbox'), 'Mauvais fichier.')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.reject.confirm`) }))
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(t(`${D}.toasts.rejectedNotEmailed`, { firstName: 'Marie' })))
  })

  it('a decision taken elsewhere leaves « Fermer » only', async () => {
    mocks.documents.verifyProfessionalDocument.mockRejectedValue({ code: 'P0001', message: "Ce document n'attend pas de vérification.", hint: 'status' })
    await openTab({ documents: pendingInsurance() })
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Vérifier : / }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.verify.confirm`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Ce document n'attend pas de vérification.")
    expect(within(dialog).queryByRole('button', { name: t(`${D}.verify.confirm`) })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: t('common.close') })).toBeInTheDocument()
  })

  it("« Modifier l'échéance » and « Supprimer » from « … »", async () => {
    mocks.documents.setProfessionalDocumentExpiry.mockResolvedValue(undefined)
    mocks.documents.deleteProfessionalDocument.mockResolvedValue(undefined)
    await openTab()
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Autres actions/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${D}.actions.redate`) }))
    const redate = await screen.findByRole('alertdialog', { name: t(`${D}.redate.title`, { type: INSURANCE }) })
    fireEvent.change(within(redate).getByLabelText(new RegExp(t(`${D}.verify.expiresOn`))), { target: { value: '2027-04-30' } })
    await userEvent.click(within(redate).getByRole('button', { name: t(`${D}.redate.confirm`) }))
    await waitFor(() => expect(mocks.documents.setProfessionalDocumentExpiry).toHaveBeenCalledWith(DOC_IDS.insurance, '2027-04-30'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Autres actions/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${D}.actions.delete`) }))
    const remove = await screen.findByRole('alertdialog', { name: t(`${D}.delete.title`) })
    expect(remove).toHaveTextContent('Marie Tremblay')
    await userEvent.click(within(remove).getByRole('button', { name: t(`${D}.delete.confirm`) }))
    await waitFor(() => expect(mocks.documents.deleteProfessionalDocument).toHaveBeenCalledWith(DOC_IDS.insurance))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${D}.toasts.deleted`))
  })
})

describe('Documents tab — preview and download', () => {
  it('opens the PDF in a sheet through its signed URL; « Télécharger » asks for a new URL at each press (never cached)', async () => {
    await openTab()
    await userEvent.click(within(card(INSURANCE)).getByRole('button', { name: /^Aperçu : / }))
    const sheet = await screen.findByRole('dialog', { name: INSURANCE })
    expect(sheet).toHaveTextContent('assurance-2026.pdf · 240 Ko')
    expect(within(sheet).getByTitle(t(`${D}.preview.frameTitle`, { file: 'assurance-2026.pdf' }))).toHaveAttribute('src', `about:blank#${DOC_IDS.insuranceFile}`)
    expect(mocks.signedUrl).toHaveBeenCalledWith(DOC_IDS.insuranceFile)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${D}.actions.download`) }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${D}.actions.download`) }))
    await waitFor(() => expect(mocks.documents.documentDownloadUrl).toHaveBeenCalledTimes(2))
    expect(mocks.documents.documentDownloadUrl).toHaveBeenCalledWith(DOC_IDS.insuranceFile)
    click.mockRestore()
  })

  it('shows a photo as an image', async () => {
    await openTab()
    await userEvent.click(within(card(PHOTO)).getByRole('button', { name: /^Aperçu : / }))
    const sheet = await screen.findByRole('dialog', { name: PHOTO })
    expect(within(sheet).getByRole('img', { name: t(`${D}.preview.imageAlt`, { type: PHOTO }) })).toHaveAttribute('src', `about:blank#${DOC_IDS.photoFile}`)
  })
})
