import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { HistoryEntry } from '../../../api/parse'
import { setupQueryClient } from '../../../test/query-client'
import { CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../../../test/fixtures-domain'
import { IDS } from '../../../test/fixtures'
import type { CatalogView } from '../../../lib/catalog-view'
import { RecordContext } from '../record-context'
import { HistoryTab } from './HistoryTab'

const mocks = vi.hoisted(() => ({ fetchProfessionalHistory: vi.fn() }))
// Two rows per page, so paging is easy to drive.
vi.mock('../../../api/history', () => ({ fetchProfessionalHistory: mocks.fetchProfessionalHistory, PROFESSIONAL_HISTORY_PAGE_SIZE: 2 }))

afterEach(() => {
  cleanup()
  mocks.fetchProfessionalHistory.mockReset()
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

function renderTab(catalog: CatalogView = CATALOG_VIEW) {
  const { queryClient } = setupQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <RecordContext.Provider value={{ record: recordFixture(), catalog }}>
          <HistoryTab />
        </RecordContext.Provider>,
        { access: { access: accessForRole('counselor') } },
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
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Catégorie 1\u00a0: Motif 1.1',
      'Catégorie 2\u00a0: Motif 2.1 · Motif 2.2 · Motif 2.3',
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
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([entry(9, '2026-10-08T18:30:00+00:00', 'professional_private', 'read', null)])
    renderTab()
    expect(await screen.findByText(/a affiché le numéro de compte/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.filter.changes`) }))
    expect(screen.queryByText(/a affiché le numéro de compte/)).not.toBeInTheDocument()
    expect(screen.getByText(t(`${H}.emptyFiltered.title`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${H}.filter.all`) }))
    expect(screen.getByText(/a affiché le numéro de compte/)).toBeInTheDocument()
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
