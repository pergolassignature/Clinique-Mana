import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { ProfessionalRecord } from '../../../api/parse'
import type { CatalogView } from '../../../lib/catalog-view'
import { CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../../../test/fixtures-domain'
import { IDS } from '../../../test/fixtures'
import { setupQueryClient } from '../../../test/query-client'
import { RecordContext } from '../record-context'
import { MatchingTab } from './MatchingTab'

const mocks = vi.hoisted(() => ({
  api: {
    setClienteles: vi.fn(),
    setSpecialties: vi.fn(),
    setMotifs: vi.fn(),
    setLanguages: vi.fn(),
    updateMatchingProfile: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../api/record', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

const M = 'modules.professionals.record.matching'
const P = `${M}.picker`

function renderTab({
  change = (r) => r,
  role = 'counselor',
  permissions,
  catalog = CATALOG_VIEW,
}: { change?: (r: ProfessionalRecord) => ProfessionalRecord; role?: FixtureRole; permissions?: string[]; catalog?: CatalogView } = {}) {
  const { wrapper: Wrapper } = setupQueryClient()
  const access = accessForRole(role, permissions ? { permissions } : {})
  render(
    <Wrapper>
      {renderWithContexts(
        <RecordContext.Provider value={{ record: change(recordFixture()), catalog }}>
          <MatchingTab />
        </RecordContext.Provider>,
        { access: { access } },
      )}
    </Wrapper>,
  )
}

const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('section, form') as HTMLElement
const openPicker = async (list: 'clienteles' | 'approaches' | 'motifs' | 'languages') => {
  await userEvent.click(screen.getByRole('button', { name: t(`${M}.${list}.edit`) }))
  return screen.getByRole('dialog', { name: t(`${M}.${list}.title`) })
}
const unfold = (dialog: HTMLElement, group: string) => userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${group}`) }))
const regulatedNo = (r: ProfessionalRecord): ProfessionalRecord => ({ ...r, professions: [{ ...r.professions[0]!, titleId: IDS.naturopathe, licenceNumber: null }] })

describe('MatchingTab — what is held', () => {
  it('shows the sets as chips (★ first), the motifs summarised, and « Modifier » on each list', () => {
    renderTab({ change: (r) => ({ ...r, clienteles: [{ id: IDS.children, specialized: false }, { id: IDS.couples, specialized: true }], languageIds: [IDS.fr, IDS.en] }) })
    const chips = within(card(t(`${M}.clienteles.title`))).getAllByRole('listitem').map((li) => li.textContent)
    expect(chips).toEqual([`★ Couples ${t(`${M}.specialized`)}`, 'Enfants (0 à 12 ans)'])
    expect(within(card(t(`${M}.approaches.title`))).getByText(t(`${M}.approaches.empty`))).toBeInTheDocument()
    expect(within(card(t(`${M}.motifs.title`))).getByText('Anxiété', { exact: false })).toBeInTheDocument()
    expect(within(card(t(`${M}.languages.title`))).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Français', 'Anglais'])
    for (const list of ['clienteles', 'approaches', 'motifs', 'languages'] as const) {
      expect(screen.getByRole('button', { name: t(`${M}.${list}.edit`) })).toBeInTheDocument()
    }
    expect(screen.queryByText(t(`${M}.readOnly`))).not.toBeInTheDocument()
  })

  it('keeps 72 held motifs to one line that unfolds, and the picker to eight folded categories', async () => {
    const big = seventyTwoMotifsCatalog()
    renderTab({ catalog: big, change: (r) => ({ ...r, motifIds: big.motifs.filter((m) => m.isActive).map((m) => m.id) }) })
    const motifs = card(t(`${M}.motifs.title`))
    const line = within(motifs).getByRole('button', { name: t('modules.professionals.record.overview.matching.motifSummary.allOverall', { count: '72' }) })
    expect(line).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(line)
    expect(within(motifs).getByText('Motif 8.9', { exact: false })).toBeVisible()
    const dialog = await openPicker('motifs')
    expect(within(dialog).getByText(t(`${P}.count`, { selected: '72', total: '72' }))).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { expanded: false })).toHaveLength(8)
    expect(within(dialog).queryAllByRole('checkbox')).toEqual([])
  })

  it('is read-only without professionals.matching: no « Modifier », no footer, the notice', () => {
    renderTab({ permissions: ['professionals.view'] })
    expect(screen.getByText(t(`${M}.readOnly`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(within(card(t(`${M}.clienteles.title`))).getByText('Couples', { exact: false })).toBeInTheDocument()
  })
})

describe('MatchingTab — pickers', () => {
  it('saves the motifs once, the whole set, only on « Enregistrer »', async () => {
    mocks.api.setMotifs.mockResolvedValue([IDS.anxiete, IDS.psychose])
    renderTab()
    const dialog = await openPicker('motifs')
    await unfold(dialog, 'Vie intérieure')
    // Psychologue: the restricted motif can be added.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Psychose/ }))
    expect(mocks.api.setMotifs).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.setMotifs).toHaveBeenCalledTimes(1)
    expect(mocks.api.setMotifs).toHaveBeenCalledWith(IDS.professional, [IDS.anxiete, IDS.psychose])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved'))
  })

  it('disables a restricted motif with its reason without a regulated title', async () => {
    renderTab({ change: regulatedNo })
    const dialog = await openPicker('motifs')
    await unfold(dialog, 'Vie intérieure')
    const psychose = within(dialog).getByRole('checkbox', { name: /Psychose/ })
    expect(psychose).toBeDisabled()
    expect(psychose).toHaveAccessibleDescription(t(`${M}.motifs.blocked`))
  })

  it('refuses a held restricted motif without a regulated title before calling the database (P4-55)', async () => {
    renderTab({ change: (r) => ({ ...regulatedNo(r), motifIds: [IDS.psychose] }) })
    const dialog = await openPicker('motifs')
    await unfold(dialog, 'Autres')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sans catégorie' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('modules.professionals.validation.motifRestricted', { name: 'Psychose' }))
    expect(mocks.api.setMotifs).not.toHaveBeenCalled()
  })

  it('shows the database’s refusal in the sheet, which stays open, without a toast', async () => {
    mocks.api.setMotifs.mockRejectedValue(Object.assign(new Error('Le motif « Sans catégorie » est archivé.'), { code: 'P0001' }))
    renderTab()
    const dialog = await openPicker('motifs')
    await unfold(dialog, 'Autres')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sans catégorie' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Le motif « Sans catégorie » est archivé.')
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('saves clientèles with their stars', async () => {
    mocks.api.setClienteles.mockResolvedValue([])
    renderTab()
    const dialog = await openPicker('clienteles')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Enfants (0 à 12 ans)' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.star.add'), description: 'Enfants (0 à 12 ans)' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.setClienteles).toHaveBeenCalledTimes(1))
    expect(mocks.api.setClienteles).toHaveBeenCalledWith(IDS.professional, [
      { id: IDS.couples, specialized: true },
      { id: IDS.children, specialized: true },
    ])
  })

  it('keeps French while it is the only language', async () => {
    renderTab()
    const dialog = await openPicker('languages')
    const french = within(dialog).getByRole('checkbox', { name: 'Français' })
    expect(french).toBeDisabled()
    expect(french).toHaveAccessibleDescription(t('modules.professionals.validation.languagesRequired'))
  })
})
