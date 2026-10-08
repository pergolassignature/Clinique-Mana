import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { SubjectEmail } from '../../../api/invitations'
import type { HistoryEntry, Onboarding } from '../../../api/parse'
import { setupQueryClient } from '../../../test/query-client'
import { CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../../../test/fixtures-domain'
import { IDS } from '../../../test/fixtures'
import type { CatalogView } from '../../../lib/catalog-view'
import { refreshProfessionalHistory } from '../../../hooks/use-professional-record'
import { RecordContext } from '../record-context'
import { HistoryTab } from './HistoryTab'

const mocks = vi.hoisted(() => ({
  fetchProfessionalHistory: vi.fn(),
  fetchProfessionalEmails: vi.fn(),
  fetchProfessionalsSettings: vi.fn(),
}))
// Two rows per page, so paging is easy to drive.
vi.mock('../../../api/history', () => ({ fetchProfessionalHistory: mocks.fetchProfessionalHistory, PROFESSIONAL_HISTORY_PAGE_SIZE: 2 }))
vi.mock('../../../api/invitations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/invitations')>()),
  fetchProfessionalEmails: mocks.fetchProfessionalEmails,
}))
vi.mock('../../../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/settings')>()),
  fetchProfessionalsSettings: mocks.fetchProfessionalsSettings,
}))

beforeEach(() => {
  mocks.fetchProfessionalEmails.mockResolvedValue([])
  mocks.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false, invitationExpiryDays: 7, invitationReminderAfterDays: 3 })
})
afterEach(() => {
  cleanup()
  mocks.fetchProfessionalHistory.mockReset()
  mocks.fetchProfessionalEmails.mockReset()
})

const H = 'modules.professionals.history'
const P = IDS.professional

const entry = (id: number, createdAt: string, tableName: string, action: HistoryEntry['action'], changedFields: HistoryEntry['changedFields'], recordId: string = P): HistoryEntry => ({
  id,
  createdAt,
  tableName,
  recordId,
  action,
  changedFields,
  actorId: IDS.admin,
  actorName: 'Admin Local',
  actorRole: 'admin',
  source: 'app',
})
const motif = (id: number, createdAt: string, motifId: string) =>
  entry(id, createdAt, 'professional_motifs', 'insert', { professional_id: P, motif_id: motifId }, `${P}:${motifId}`)

function renderTab(
  catalog: CatalogView = CATALOG_VIEW,
  queryClient: QueryClient = setupQueryClient().queryClient,
  role: 'counselor' | 'admin' = 'counselor',
  onboarding: Onboarding | null = null,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <RecordContext.Provider value={{ record: recordFixture(), catalog, onboarding, focusHeading: () => {} }}>
          <HistoryTab />
        </RecordContext.Provider>,
        { access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

describe('HistoryTab', () => {
  it('reads each entry by clinic day: time, who, what', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([
      entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { city: '[redacted]' }),
      entry(8, '2026-10-07T13:05:00+00:00', 'professionals', 'update', { years_experience: { before: 1, after: 2 } }),
    ])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([])
    renderTab()
    const today = await screen.findByRole('region', { name: 'Jeudi 8 octobre 2026' })
    const item = within(today).getByRole('listitem')
    expect(within(item).getByText('14:30')).toHaveAttribute('datetime', '2026-10-08T18:30:00+00:00')
    expect(item).toHaveTextContent('Admin Local a modifié la ville')
    expect(mocks.fetchProfessionalHistory).toHaveBeenCalledWith(P, undefined)
    // A full page: its oldest save may go on in the next one, so it waits for « Charger plus ».
    expect(screen.queryByRole('region', { name: 'Mercredi 7 octobre 2026' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.loadMore`) }))
    expect(await screen.findByRole('region', { name: 'Mercredi 7 octobre 2026' })).toHaveTextContent(
      "Admin Local a modifié les années d'expérience : 1 → 2",
    )
  })

  it('unfolds an entry to its details', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([
      entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { city: '[redacted]', province: { before: 'QC', after: 'ON' } }),
    ])
    renderTab()
    const toggle = await screen.findByRole('button', { name: /a modifié la ville et la province/ })
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement
    expect(panel).not.toBeVisible()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `Ville\u00a0: ${t('audit.values.redacted')}`,
      'Province\u00a0: QC → ON',
    ])
  })

  it('counts many motifs and lists their names by category behind the disclosure', async () => {
    const big = seventyTwoMotifsCatalog()
    const at = '2026-10-08T18:30:00+00:00'
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(9, at, 'm-0-0'), motif(8, at, 'm-1-0')])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(7, at, 'm-1-1'), motif(6, at, 'm-1-2')])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([])
    renderTab(big)
    // The first page is one unfinished save: the tab reads on before showing it (no « a ajouté 2 motifs »).
    const toggle = await screen.findByRole('button', { name: 'Admin Local a ajouté 4 motifs' })
    expect(mocks.fetchProfessionalHistory.mock.calls).toEqual([[P, undefined], [P, 8], [P, 6]])
    await userEvent.click(toggle)
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement
    // Each category's title on its own line, every name under it (P4-249).
    const categories = within(panel).getAllByRole('listitem').filter((li) => li.querySelector('p'))
    expect(categories.map((li) => li.querySelector('p')?.textContent)).toEqual(['Catégorie 1', 'Catégorie 2'])
    expect(categories.map((li) => [...li.querySelectorAll('li')].map((name) => name.textContent))).toEqual([
      ['Motif 1.1'],
      ['Motif 2.1', 'Motif 2.2', 'Motif 2.3'],
    ])
  })

  it('names up to three motifs in the sentence, with nothing to unfold', async () => {
    const at = '2026-10-08T18:30:00+00:00'
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(9, at, IDS.anxiete)])
    renderTab()
    expect(await screen.findByText(/a ajouté le motif Anxiété/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Anxiété/ })).not.toBeInTheDocument()
  })

  it('loads older entries before the last id, then says the history starts there', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([
      entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { years_experience: { before: 2, after: 3 } }),
      entry(8, '2026-10-08T17:30:00+00:00', 'professionals', 'update', { years_experience: { before: 1, after: 2 } }),
    ])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([entry(7, '2026-10-08T16:30:00+00:00', 'professionals', 'insert', { first_name: 'Marie' })])
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: t(`${H}.loadMore`) }))
    expect(mocks.fetchProfessionalHistory).toHaveBeenLastCalledWith(P, 8)
    expect(await screen.findByText(/a créé le dossier/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(t(`${H}.end`))).toHaveFocus())
    expect(screen.queryByRole('button', { name: t(`${H}.loadMore`) })).not.toBeInTheDocument()
  })

  it('« Modifications » leaves out consultations, and says so when nothing is left', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([entry(9, '2026-10-08T18:30:00+00:00', 'professional_private', 'read', { fields: ['bank_account'] })])
    renderTab()
    expect(await screen.findByText(/a affiché le numéro de compte/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.filter.changes`) }))
    expect(screen.queryByText(/a affiché le numéro de compte/)).not.toBeInTheDocument()
    expect(screen.getByText(t(`${H}.emptyFiltered.title`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.filter.all`) }))
    expect(screen.getByText(/a affiché le numéro de compte/)).toBeInTheDocument()
  })

  it('names the private field a consultation showed (4a.17)', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([entry(9, '2026-10-08T18:30:00+00:00', 'professional_private', 'read', { fields: ['sin'] })])
    renderTab()
    expect(await screen.findByRole('listitem')).toHaveTextContent('Admin Local a affiché le NAS')
  })

  it('reads on after « Charger plus » while the new page holds only the held-back save', async () => {
    const a = entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { years_experience: { before: 2, after: 3 } })
    const b = '2026-10-08T17:30:00+00:00'
    const c = entry(4, '2026-10-08T16:30:00+00:00', 'professionals', 'update', { years_experience: { before: 1, after: 2 } })
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([a, motif(8, b, IDS.anxiete)])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(7, b, IDS.psychose), motif(6, b, IDS.deuil)])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(5, b, IDS.orphan), c])
    renderTab()
    expect(await screen.findByText(/a modifié les années d'expérience : 2 → 3/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    // One click: page 2 is the held-back save alone (nothing new to show), so page 3 follows.
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.loadMore`) }))
    expect(await screen.findByRole('button', { name: 'Admin Local a ajouté 4 motifs' })).toBeInTheDocument()
    expect(mocks.fetchProfessionalHistory.mock.calls).toEqual([[P, undefined], [P, 8], [P, 6]])
    // C may go on in page 4: held back, « Charger plus » again.
    expect(screen.queryByText(/a modifié les années d'expérience : 1 → 2/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${H}.loadMore`) })).not.toHaveAttribute('aria-disabled')
  })

  it('moves the focus to the start of the history once the pages read on reach it', async () => {
    const b = '2026-10-08T17:30:00+00:00'
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([
      entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { years_experience: { before: 2, after: 3 } }),
      motif(8, b, IDS.anxiete),
    ])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(7, b, IDS.psychose), motif(6, b, IDS.deuil)])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(5, b, IDS.orphan)])
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: t(`${H}.loadMore`) }))
    expect(await screen.findByRole('button', { name: 'Admin Local a ajouté 4 motifs' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(t(`${H}.end`))).toHaveFocus())
  })

  it('offers a retry, not an empty state, when the pages read on fail before anything shows', async () => {
    const b = '2026-10-08T17:30:00+00:00'
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(9, b, IDS.anxiete), motif(8, b, IDS.psychose)])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(7, b, IDS.deuil), motif(6, b, IDS.orphan)])
    mocks.fetchProfessionalHistory.mockRejectedValueOnce(new Error('boom'))
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(5, b, IDS.archivedMotif)])
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t(`${H}.loadError`))
    expect(screen.queryByText(t(`${H}.emptyFiltered.title`))).not.toBeInTheDocument()
    expect(screen.queryByText(t(`${H}.empty.title`))).not.toBeInTheDocument()
    // The chain stopped on the error: no request after the failed one.
    expect(mocks.fetchProfessionalHistory).toHaveBeenCalledTimes(3)
    await userEvent.click(within(alert).getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('button', { name: 'Admin Local a ajouté 5 motifs' })).toBeInTheDocument()
    expect(mocks.fetchProfessionalHistory).toHaveBeenLastCalledWith(P, 6)
  })

  it('keeps the entries and offers « Charger plus » again when the pages read on fail midway', async () => {
    const b = '2026-10-08T17:30:00+00:00'
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([
      entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { years_experience: { before: 2, after: 3 } }),
      motif(8, b, IDS.anxiete),
    ])
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(7, b, IDS.psychose), motif(6, b, IDS.deuil)])
    mocks.fetchProfessionalHistory.mockRejectedValueOnce(new Error('boom'))
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([motif(5, b, IDS.orphan)])
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: t(`${H}.loadMore`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${H}.loadMoreError`))
    expect(screen.getByText(/a modifié les années d'expérience : 2 → 3/)).toBeInTheDocument()
    expect(mocks.fetchProfessionalHistory).toHaveBeenCalledTimes(3)
    const loadMore = screen.getByRole('button', { name: t(`${H}.loadMore`) })
    expect(loadMore).not.toHaveAttribute('aria-disabled')
    await userEvent.click(loadMore)
    expect(await screen.findByRole('button', { name: 'Admin Local a ajouté 4 motifs' })).toBeInTheDocument()
    expect(mocks.fetchProfessionalHistory).toHaveBeenLastCalledWith(P, 6)
  })

  it('prints no UUID and no redaction marker anywhere in the tab, details included', async () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const other = '00000000-0000-4000-8000-00000000f000'
    const at = (minute: number) => `2026-10-08T18:${String(minute).padStart(2, '0')}:00+00:00`
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([
      entry(20, at(50), 'professionals', 'update', { city: '[redacted]', gender: '[redacted]', referred_by: { before: other, after: '[redacted]' }, extra: { before: {}, after: [other] } }),
      entry(19, at(49), 'professionals', 'update', { status: { before: 'active', after: 'inactive' }, deactivation_reason_id: { before: null, after: other }, status_changed_by: { before: null, after: other } }),
      entry(18, at(48), 'professionals', 'update', { profile_id: { before: null, after: other }, updated_by: { before: null, after: other } }),
      entry(17, at(47), 'professional_professions', 'update', { licence_number: { before: '1', after: '2' } }, `${P}:${other}`),
      entry(16, at(46), 'professional_documents', 'insert', { id: other, stored_file_id: other }, `${P}:${other}`),
      entry(15, at(45), 'professional_documents', 'read', { fields: [other] }, `${P}:${other}`),
      entry(14, at(44), 'professional_private', 'read', { fields: [other] }),
      entry(13, at(43), 'professional_private', 'update', { sin: '[redacted]', bank_account: '[redacted]' }),
      entry(12, at(42), 'professional_payer_numbers', 'insert', { payer_type: other, number: '[redacted]' }, `${P}:${other}`),
      motif(11, at(41), other),
      entry(10, at(40), 'professionals', 'insert', { id: P, org_id: other, first_name: 'Marie', last_name: 'Roy', city: '[redacted]', profile_id: other, created_by: other }),
    ])
    renderTab()
    await screen.findByText(/a créé le dossier/)
    // Every disclosure open: the panels are mounted anyway, but this is what a reader sees.
    for (const toggle of screen.queryAllByRole('button', { expanded: false })) await userEvent.click(toggle)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(uuid)
    expect(text).not.toContain('[redacted]')
    expect(text).not.toMatch(/professional_documents|stored_file_id/)
  })

  it('reloads only the first page on a refresh or a remount', async () => {
    const page1 = [
      entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { years_experience: { before: 2, after: 3 } }),
      entry(8, '2026-10-08T17:30:00+00:00', 'professionals', 'update', { years_experience: { before: 1, after: 2 } }),
    ]
    const page2 = [
      entry(7, '2026-10-08T16:30:00+00:00', 'professionals', 'update', { years_experience: { before: 0, after: 1 } }),
      entry(6, '2026-10-08T15:30:00+00:00', 'professionals', 'update', { years_experience: { before: 5, after: 0 } }),
    ]
    mocks.fetchProfessionalHistory.mockImplementation((_id: string, before?: number) => Promise.resolve(before === undefined ? page1 : page2))
    const { queryClient } = setupQueryClient()
    const { unmount } = renderTab(CATALOG_VIEW, queryClient)
    await userEvent.click(await screen.findByRole('button', { name: t(`${H}.loadMore`) }))
    expect(await screen.findByText(/a modifié les années d'expérience : 1 → 2/)).toBeInTheDocument()
    expect(mocks.fetchProfessionalHistory.mock.calls).toEqual([[P, undefined], [P, 8]])

    // A record change: one request, the first page.
    mocks.fetchProfessionalHistory.mockClear()
    await refreshProfessionalHistory(queryClient, P)
    expect(mocks.fetchProfessionalHistory.mock.calls).toEqual([[P, undefined]])

    // Read on again, leave the tab, come back to stale data: one request again.
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.loadMore`) }))
    await screen.findByText(/a modifié les années d'expérience : 1 → 2/)
    unmount()
    await queryClient.invalidateQueries({ queryKey: ['professionals', 'history', P] })
    mocks.fetchProfessionalHistory.mockClear()
    renderTab(CATALOG_VIEW, queryClient)
    await waitFor(() => expect(mocks.fetchProfessionalHistory).toHaveBeenCalled())
    expect(await screen.findByText(/a modifié les années d'expérience : 2 → 3/)).toBeInTheDocument()
    expect(mocks.fetchProfessionalHistory.mock.calls).toEqual([[P, undefined]])
  })

  it('shows the empty state', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([])
    renderTab()
    expect(await screen.findByText(t(`${H}.empty.title`))).toBeInTheDocument()
  })

  it('shows a load error with a retry', async () => {
    mocks.fetchProfessionalHistory.mockRejectedValueOnce(new Error('boom'))
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([])
    renderTab()
    expect(await screen.findByText(t(`${H}.loadError`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByText(t(`${H}.empty.title`))).toBeInTheDocument()
  })
})

describe('HistoryTab — Courriels (Task 4b.3)', () => {
  const email = (id: string, createdAt: string, over: Partial<SubjectEmail> = {}): SubjectEmail => ({
    id,
    templateKey: 'professionals.invite',
    templateLabel: "Invitation d'un professionnel",
    status: 'delivered',
    toEmail: 'marie.t@exemple.ca',
    sentBy: IDS.admin,
    sentByName: 'Admin Local',
    createdAt,
    errorCode: null,
    ...over,
  })
  const live: Onboarding = {
    invitation: { state: 'sent', sentAt: '2026-10-08T17:00:00Z', expiresAt: '2026-10-15T17:00:00Z', openedAt: null, usedAt: null },
    submission: null,
    onboardingApproved: false,
  }

  it('merges the emails with the changes by time, each with who sent it and its outcome', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { city: '[redacted]' })])
    mocks.fetchProfessionalEmails.mockResolvedValue([email('m1', '2026-10-08T19:00:00+00:00'), email('m0', '2026-10-08T17:00:00+00:00', { sentBy: null, sentByName: null, templateKey: 'professionals.invite_reminder', templateLabel: "Rappel d'invitation d'un professionnel", status: 'sent' })])
    renderTab()
    const today = await screen.findByRole('region', { name: 'Jeudi 8 octobre 2026' })
    const items = within(today).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    const [first, second, third] = items as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText('15:00')).toBeInTheDocument()
    expect(first).toHaveTextContent("Admin Local a envoyé « Invitation d'un professionnel » à marie.t@exemple.ca")
    expect(within(first).getByText(t('email.status.delivered'))).toBeInTheDocument()
    expect(second).toHaveTextContent('Admin Local a modifié la ville')
    expect(within(third).getByText('13:00')).toBeInTheDocument()
    expect(third).toHaveTextContent("Le système a envoyé « Rappel d'invitation d'un professionnel » à marie.t@exemple.ca")
    expect(within(third).getByText(t('email.status.sent'))).toBeInTheDocument()
    expect(mocks.fetchProfessionalEmails).toHaveBeenCalledWith(P)
  })

  it('« Courriels » shows the emails only; empty, it says what will show', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValue([entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { city: '[redacted]' })])
    renderTab()
    await screen.findByRole('region', { name: 'Jeudi 8 octobre 2026' })
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.filter.emails`) }))
    expect(await screen.findByText(t(`${H}.emptyEmails.title`))).toBeInTheDocument()
    expect(screen.getByText(t(`${H}.emptyEmails.body`, { firstName: 'Marie' }))).toBeInTheDocument()
  })

  it('a failed invitation email offers « Renvoyer l’invitation » to an inviter, on the newest one only', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValue([])
    mocks.fetchProfessionalEmails.mockResolvedValue([
      email('m2', '2026-10-08T19:00:00+00:00', { status: 'failed', errorCode: 'provider_rejected' }),
      email('m1', '2026-10-07T19:00:00+00:00', { status: 'failed', errorCode: 'provider_rejected' }),
    ])
    renderTab(CATALOG_VIEW, setupQueryClient().queryClient, 'admin', live)
    await screen.findByRole('region', { name: 'Jeudi 8 octobre 2026' })
    expect(screen.getAllByText(t('email.failure.rejected'))).toHaveLength(2)
    const resend = screen.getAllByRole('button', { name: "Renvoyer l'invitation" })
    expect(resend).toHaveLength(1)
    await userEvent.click(resend[0] as HTMLElement)
    expect(await screen.findByRole('alertdialog', { name: "Renvoyer l'invitation à Marie Tremblay ?" })).toBeInTheDocument()
  })

  it('a refused address: no « Renvoyer », where to correct it instead', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValue([])
    mocks.fetchProfessionalEmails.mockResolvedValue([email('m1', '2026-10-08T19:00:00+00:00', { status: 'bounced' })])
    renderTab(CATALOG_VIEW, setupQueryClient().queryClient, 'admin', live)
    await screen.findByText(t('email.status.bounced'))
    expect(screen.queryByRole('button', { name: "Renvoyer l'invitation" })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${H}.email.identityTab`) })).toHaveAttribute('href', `/professionnels/${P}/identite`)
  })

  it('no « Renvoyer » for a counselor, nor for an update request (P4-267)', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValue([])
    mocks.fetchProfessionalEmails.mockResolvedValue([email('m1', '2026-10-08T19:00:00+00:00', { status: 'failed', errorCode: 'provider_rejected', templateKey: 'professionals.profile_update' })])
    renderTab(CATALOG_VIEW, setupQueryClient().queryClient, 'admin', live)
    await screen.findByText(t('email.failure.rejected'))
    expect(screen.queryByRole('button', { name: "Renvoyer l'invitation" })).not.toBeInTheDocument()
  })

  it('emails that cannot load: the changes still show, with « Réessayer » for the emails', async () => {
    mocks.fetchProfessionalHistory.mockResolvedValue([entry(9, '2026-10-08T18:30:00+00:00', 'professionals', 'update', { city: '[redacted]' })])
    mocks.fetchProfessionalEmails.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }))
    renderTab()
    expect(await screen.findByText(t(`${H}.emailsLoadError`))).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Jeudi 8 octobre 2026' })).toHaveTextContent('Admin Local a modifié la ville')
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(screen.queryByText(t(`${H}.emailsLoadError`))).not.toBeInTheDocument())
  })
})
