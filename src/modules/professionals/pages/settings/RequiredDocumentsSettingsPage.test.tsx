import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ScheduledJob } from '@/core/jobs/api'
import { usageKey } from '../../api/catalog'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { INSURANCE_EXPIRY_JOB, RequiredDocumentsSettingsPage } from './RequiredDocumentsSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchProfessionalsCatalog: vi.fn(),
    fetchReferenceUsage: vi.fn(),
    saveReference: vi.fn(),
    setReferenceActive: vi.fn(),
    reorderReference: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
}))
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.professionals.settings.requiredDocuments'
const L = 'modules.professionals.settings.list'
const INSURANCE = "Preuve d'assurance responsabilité"

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.api.fetchReferenceUsage.mockResolvedValue(new Map([[usageKey('document_types', IDS.insuranceType), 12]]))
  mocks.jobs.listScheduledJobs.mockResolvedValue([insuranceJob(false)])
  mocks.jobs.setScheduledJobEnabled.mockResolvedValue(undefined)
})

const insuranceJob = (enabled: boolean): ScheduledJob => ({
  key: INSURANCE_EXPIRY_JOB,
  label: 'Échéances des assurances',
  description: '',
  kind: 'function',
  is_maintenance: false,
  local_hour: 6,
  schedule: '15 * * * *',
  enabled,
  last_started_at: null,
  last_status: null,
  last_detail: null,
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<RequiredDocumentsSettingsPage />, { sectionId: 'required-documents', readOnly })
  await screen.findByRole('table')
}

const dialog = () => screen.getByRole('dialog')
const rowOf = (name: string) => {
  const row = screen.getAllByRole('row').find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
const cells = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .slice(0, 5)
    .map((cell) => cell.textContent)
async function openEdit(name: string) {
  await userEvent.click(screen.getByRole('button', { name: t(`${L}.actions.menu`, { name }) }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${L}.actions.edit`) }))
}

describe('RequiredDocumentsSettingsPage', () => {
  it('shows Requis, Échéance, Rappels, Fichiers and « Utilisé par » in words; the system types locked', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t(`${R}.title`) })).toBeInTheDocument()
    expect(cells(INSURANCE)).toEqual(['Oui', '31 mars suivant', '7 jours avant · chaque semaine après', 'PDF, JPEG ou PNG · 10 Mo', '12 professionnels'])
    expect(cells('Autre')[3]).toBe('Tous les types · 10\u00a0Mo')
    expect(cells('CV')).toEqual(['Non', 'Aucune', 'Aucun', 'PDF, Word (.doc) ou Word (.docx) · 10 Mo', expect.stringContaining('—')])
    // The image consent never expires (P4-504).
    expect(cells("Consentement droit à l'image")[1]).toBe(t(`${R}.consentNoExpiry`))
    expect(within(rowOf(INSURANCE)).getByRole('img', { name: t(`${R}.system`) })).toBeInTheDocument()
    // An archived type is under « Archivés » only.
    expect(screen.queryByText('Ancien document')).not.toBeInTheDocument()
  })

  it('edits the insurance’s reminders (« 30, 7 », weekly) and saves them largest first', async () => {
    mocks.api.saveReference.mockResolvedValue(IDS.insuranceType)
    await renderPage()
    await openEdit(INSURANCE)
    const reminders = within(dialog()).getByRole('textbox', { name: t(`${R}.reminderDays`) })
    expect(reminders).toHaveValue('7')
    await userEvent.clear(reminders)
    await userEvent.type(reminders, '7, 30')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('document_types', {
        id: IDS.insuranceType,
        name: INSURANCE,
        required: true,
        expiryRule: 'next_march_31',
        reminderDays: [30, 7],
        weeklyAfterExpiry: true,
        acceptedMime: ['application/pdf', 'image/jpeg', 'image/png'],
        maxBytes: 10_485_760,
      }),
    )
  })

  it('refuses reminders it cannot keep, and reminders without an end date', async () => {
    await renderPage()
    await openEdit(INSURANCE)
    const reminders = within(dialog()).getByRole('textbox', { name: t(`${R}.reminderDays`) })
    await userEvent.clear(reminders)
    await userEvent.type(reminders, '120')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.reminderDays'))).toBeInTheDocument()
    await userEvent.clear(reminders)
    await userEvent.type(reminders, '7')
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: t(`${R}.expiry`) }), 'none')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.remindersNeedExpiry'))).toBeInTheDocument()
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('a type other than the insurance has no reminders; the photo keeps JPEG or PNG', async () => {
    await renderPage()
    await openEdit('Photo professionnelle')
    expect(within(dialog()).queryByRole('textbox', { name: t(`${R}.reminderDays`) })).not.toBeInTheDocument()
    expect(within(dialog()).getByText(t(`${R}.remindersOnlyInsurance`))).toBeInTheDocument()
    const files = within(dialog()).getByRole('group', { name: t(`${R}.files`) })
    expect(within(files).getAllByRole('checkbox').map((c) => c.closest('div')?.textContent)).toEqual(['JPEG', 'PNG'])
    await userEvent.click(within(files).getByRole('checkbox', { name: 'JPEG' }))
    await userEvent.click(within(files).getByRole('checkbox', { name: 'PNG' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.acceptedMime'))).toBeInTheDocument()
  })

  it('adds a type: optional, no end date, every file type and 10 Mo by default', async () => {
    mocks.api.saveReference.mockResolvedValue('00000000-0000-4000-8000-000000000499')
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.add`) }))
    await userEvent.type(within(dialog()).getByRole('textbox', { name: /^Nom/ }), 'Attestation de formation')
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${L}.dialog.create`) }))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('document_types', {
        id: null,
        name: 'Attestation de formation',
        required: false,
        expiryRule: 'none',
        reminderDays: [],
        weeklyAfterExpiry: false,
        acceptedMime: [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        maxBytes: 10_485_760,
      }),
    )
  })

  it('never offers « Archiver » on a system type', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: t(`${L}.actions.menu`, { name: INSURANCE }) }))
    await screen.findByRole('menuitem', { name: t(`${L}.actions.edit`) })
    expect(screen.queryByRole('menuitem', { name: t(`${L}.actions.archive`) })).not.toBeInTheDocument()
  })

  it('read-only for the adjointe: no « Ajouter », no menus', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${R}.add`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
  })

  it('the image consent never expires: « Aucune expiration », read-only in its form (P4-504)', async () => {
    await renderPage()
    await openEdit("Consentement droit à l'image")
    expect(within(dialog()).getByLabelText(t(`${R}.expiry`))).toHaveValue(t(`${R}.consentNoExpiry`))
    expect(within(dialog()).getByLabelText(t(`${R}.expiry`))).toHaveAttribute('readonly')
    expect(within(dialog()).queryByRole('combobox', { name: t(`${R}.expiry`) })).not.toBeInTheDocument()
  })

  it('points to « Contrats et formulaires » for the consent’s text (P4-508)', async () => {
    await renderPage()
    const card = screen.getByRole('region', { name: t(`${R}.consentText.title`) })
    expect(within(card).getByRole('link', { name: t(`${R}.consentText.open`) })).toHaveAttribute('href', '/parametres/contrats')
  })

  it('says the insurance reminders need the job « Échéances des assurances », off, and lets an admin turn it on (P4-509)', async () => {
    await renderPage()
    const card = screen.getByRole('region', { name: t(`${R}.job.title`) })
    expect(await within(card).findByText(t(`${R}.job.off`))).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: t(`${R}.job.enable`) }))
    await waitFor(() => expect(mocks.jobs.setScheduledJobEnabled).toHaveBeenCalledExactlyOnceWith(INSURANCE_EXPIRY_JOB, true))
  })

  it('on: when it runs', async () => {
    mocks.jobs.listScheduledJobs.mockResolvedValue([insuranceJob(true)])
    await renderPage()
    expect(await within(screen.getByRole('region', { name: t(`${R}.job.title`) })).findByText(t(`${R}.job.on`, { hour: '6' }))).toBeInTheDocument()
  })

  it('the adjointe, the job off: where it is done, never a switch', async () => {
    await renderPage({ readOnly: true })
    const card = screen.getByRole('region', { name: t(`${R}.job.title`) })
    expect(await within(card).findByText(t(`${R}.job.askAdmin`))).toBeInTheDocument()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: t(`${R}.job.openJobs`) })).toHaveAttribute('href', '/parametres/taches-planifiees')
  })
})
